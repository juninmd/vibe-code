import { readFileSync } from "node:fs";
import type { AgentRunnerMode, AgentRunnerSettings } from "@vibe-code/shared";

export type { AgentRunnerMode };

export const RUNNER_SETTINGS_KEY = "agent_runner";

export interface K8sRunnerConfig {
  namespace: string;
  image: string;
  /** PVC that holds VIBE_CODE_DATA_DIR; runner pods mount only their task's paths from it. */
  claimName: string;
  dataDir: string;
  /** Node the server runs on; pins runner pods there so a ReadWriteOnce PVC can be shared. */
  nodeName?: string;
  /** Pull secret for a private runner image (e.g. GHCR). */
  imagePullSecret?: string;
  /** Skills PVC mounted read-only at `skillsDir`, so OpenCode sees the same skills as locally. */
  skillsClaimName?: string;
  skillsDir: string;
  idleMs: number;
  forwardGitHubToken: boolean;
  maxLifetimeSeconds: number;
  startTimeoutMs: number;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

type Env = Record<string, string | undefined>;
interface SettingsStore {
  get(key: string): string | null;
}

const SA_NAMESPACE = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

function positive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function inClusterNamespace(): string | undefined {
  try {
    return readFileSync(SA_NAMESPACE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

export function isInCluster(env: Env = process.env): boolean {
  return !!env.KUBERNETES_SERVICE_HOST;
}

/** Defaults before an operator saves anything; the deployment can pre-fill them via env. */
export function defaultRunnerSettings(env: Env = process.env): AgentRunnerSettings {
  return {
    runner: env.VIBE_AGENT_RUNNER === "k8s" ? "k8s" : "local",
    image: env.VIBE_K8S_RUNNER_IMAGE ?? "",
    pvc: env.VIBE_K8S_PVC ?? "",
    skillsPvc: env.VIBE_K8S_SKILLS_PVC ?? "",
    imagePullSecret: env.VIBE_K8S_IMAGE_PULL_SECRET ?? "",
    idleMinutes: positive(env.VIBE_K8S_IDLE_MINUTES, 15),
    maxLifetimeHours: positive(env.VIBE_K8S_MAX_LIFETIME_HOURS, 6),
    startTimeoutSeconds: positive(env.VIBE_K8S_START_TIMEOUT_SECONDS, 180),
    forwardGitHubToken: env.VIBE_K8S_FORWARD_GITHUB_TOKEN !== "false",
    cpuRequest: env.VIBE_K8S_CPU_REQUEST || "250m",
    cpuLimit: env.VIBE_K8S_CPU_LIMIT || "2",
    memoryRequest: env.VIBE_K8S_MEMORY_REQUEST || "512Mi",
    memoryLimit: env.VIBE_K8S_MEMORY_LIMIT || "4Gi",
  };
}

/** Saved settings over the defaults; a corrupt row falls back to the defaults. */
export function readRunnerSettings(
  store: SettingsStore,
  env: Env = process.env
): AgentRunnerSettings {
  const defaults = defaultRunnerSettings(env);
  const raw = store.get(RUNNER_SETTINGS_KEY);
  if (!raw) return defaults;
  try {
    return { ...defaults, ...(JSON.parse(raw) as Partial<AgentRunnerSettings>) };
  } catch {
    return defaults;
  }
}

/** What stops `k8s` from working with these settings, in words for the operator. */
export function k8sProblems(
  settings: AgentRunnerSettings,
  env: Env = process.env,
  readNamespace: () => string | undefined = inClusterNamespace
): string[] {
  const problems: string[] = [];
  if (!isInCluster(env))
    problems.push("o servidor não está rodando dentro de um cluster Kubernetes");
  if (!(env.VIBE_K8S_NAMESPACE || readNamespace()))
    problems.push("namespace do pod não encontrado");
  if (!settings.image.trim()) problems.push("informe a imagem do runner");
  if (!settings.pvc.trim()) problems.push("informe o PVC de dados");
  return problems;
}

export function toK8sConfig(
  settings: AgentRunnerSettings,
  dataDir: string,
  env: Env = process.env,
  readNamespace: () => string | undefined = inClusterNamespace
): K8sRunnerConfig {
  const problems = k8sProblems(settings, env, readNamespace);
  if (problems.length > 0)
    throw new Error(`Runner Kubernetes indisponível: ${problems.join("; ")}`);
  return {
    namespace: (env.VIBE_K8S_NAMESPACE || readNamespace()) as string,
    image: settings.image.trim(),
    claimName: settings.pvc.trim(),
    dataDir,
    nodeName: env.VIBE_K8S_NODE_NAME || undefined,
    imagePullSecret: settings.imagePullSecret.trim() || undefined,
    skillsClaimName: settings.skillsPvc.trim() || undefined,
    skillsDir: env.VIBE_K8S_SKILLS_DIR || "/home/vibe/.agents",
    idleMs: Math.round(settings.idleMinutes * 60_000),
    forwardGitHubToken: settings.forwardGitHubToken,
    maxLifetimeSeconds: Math.round(settings.maxLifetimeHours * 3600),
    startTimeoutMs: Math.round(settings.startTimeoutSeconds * 1000),
    cpuRequest: settings.cpuRequest,
    cpuLimit: settings.cpuLimit,
    memoryRequest: settings.memoryRequest,
    memoryLimit: settings.memoryLimit,
  };
}
