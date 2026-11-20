import { readFileSync } from "node:fs";

/** Where agent turns execute: in this server's own process tree, or one pod per task. */
export type AgentRunner = "local" | "k8s";

export function agentRunner(env: Record<string, string | undefined> = process.env): AgentRunner {
  return env.VIBE_AGENT_RUNNER === "k8s" ? "k8s" : "local";
}

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
  maxLifetimeSeconds: number;
  startTimeoutMs: number;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
}

const SA_NAMESPACE = "/var/run/secrets/kubernetes.io/serviceaccount/namespace";

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function inClusterNamespace(): string | undefined {
  try {
    return readFileSync(SA_NAMESPACE, "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Reads the k8s runner settings; throws with every missing variable named at once. */
export function k8sRunnerConfig(
  env: Record<string, string | undefined> = process.env,
  readNamespace: () => string | undefined = inClusterNamespace
): K8sRunnerConfig {
  const namespace = env.VIBE_K8S_NAMESPACE || readNamespace();
  const missing = [
    !namespace && "VIBE_K8S_NAMESPACE",
    !env.VIBE_K8S_RUNNER_IMAGE && "VIBE_K8S_RUNNER_IMAGE",
    !env.VIBE_K8S_PVC && "VIBE_K8S_PVC",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`VIBE_AGENT_RUNNER=k8s needs ${missing.join(", ")}`);
  }
  return {
    namespace: namespace as string,
    image: env.VIBE_K8S_RUNNER_IMAGE as string,
    claimName: env.VIBE_K8S_PVC as string,
    dataDir: env.VIBE_CODE_DATA_DIR || "/data",
    nodeName: env.VIBE_K8S_NODE_NAME || undefined,
    imagePullSecret: env.VIBE_K8S_IMAGE_PULL_SECRET || undefined,
    skillsClaimName: env.VIBE_K8S_SKILLS_PVC || undefined,
    skillsDir: env.VIBE_K8S_SKILLS_DIR || "/home/vibe/.agents",
    idleMs: positive(env.VIBE_K8S_IDLE_MS, 15 * 60_000),
    maxLifetimeSeconds: positive(env.VIBE_K8S_MAX_LIFETIME_S, 6 * 3600),
    startTimeoutMs: positive(env.VIBE_K8S_START_TIMEOUT_MS, 180_000),
    cpuRequest: env.VIBE_K8S_CPU_REQUEST || "250m",
    cpuLimit: env.VIBE_K8S_CPU_LIMIT || "2",
    memoryRequest: env.VIBE_K8S_MEMORY_REQUEST || "512Mi",
    memoryLimit: env.VIBE_K8S_MEMORY_LIMIT || "4Gi",
  };
}
