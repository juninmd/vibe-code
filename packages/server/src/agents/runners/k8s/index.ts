import type { AgentRunnerSettings, AgentRunnerStatus } from "@vibe-code/shared";
import { type ServeStarter, startOpencodeServe } from "../../engines/opencode-serve/process";
import { InClusterKubeApi, type KubeApi } from "./api";
import { inClusterNamespace, isInCluster, k8sProblems, toK8sConfig } from "./config";
import { PodPool, type PodPoolDeps } from "./pod-pool";

type Env = Record<string, string | undefined>;

export interface AgentRunnerDeps {
  /** Current Settings (saved over env defaults); read on every turn. */
  settings: () => AgentRunnerSettings;
  dataDir: string;
  /** User (workspace) behind a task worktree; all tasks share one owner when absent. */
  ownerOf?: (workdir: string) => string;
  env?: Env;
  /** Test seams. */
  api?: KubeApi;
  readNamespace?: () => string | undefined;
  localStart?: ServeStarter;
  pool?: Pick<PodPoolDeps, "gitCommonDir" | "ensureDir" | "sleep" | "log">;
}

/**
 * Picks where each OpenCode turn runs from the Settings in force at that moment, so
 * switching between local and k8s needs no restart. Pods already running keep being
 * reaped after the switch.
 */
export class AgentRunner {
  private readonly pool?: PodPool;
  private readonly env: Env;
  private readonly readNamespace: () => string | undefined;
  readonly namespace?: string;

  constructor(private readonly deps: AgentRunnerDeps) {
    this.env = deps.env ?? process.env;
    this.readNamespace = deps.readNamespace ?? inClusterNamespace;
    this.namespace = this.env.VIBE_K8S_NAMESPACE || this.readNamespace();
    if (!isInCluster(this.env) || !this.namespace) return;
    try {
      const api = deps.api ?? InClusterKubeApi.fromEnvironment(this.env);
      this.pool = new PodPool({
        ...deps.pool,
        api,
        ownerOf: deps.ownerOf,
        namespace: this.namespace,
        config: () => toK8sConfig(deps.settings(), deps.dataDir, this.env, this.readNamespace),
        idleMs: () => deps.settings().idleMinutes * 60_000,
      });
    } catch (error) {
      console.warn(`[k8s-runner] Kubernetes API unavailable: ${(error as Error).message}`);
    }
  }

  readonly start: ServeStarter = async (options) => {
    const settings = this.deps.settings();
    if (settings.runner !== "k8s") return (this.deps.localStart ?? startOpencodeServe)(options);
    if (!this.pool) {
      const problems = k8sProblems(settings, this.env, this.readNamespace);
      throw new Error(
        `Runner Kubernetes indisponível: ${problems.join("; ") || "API inacessível"}`
      );
    }
    return this.pool.start(options);
  };

  /** Cluster facts for Settings; the editable part comes from the settings store. */
  clusterStatus(): Omit<AgentRunnerStatus, "settings"> {
    return {
      inCluster: !!this.pool,
      namespace: this.namespace,
      nodeName: this.env.VIBE_K8S_NODE_NAME || undefined,
      activePods: this.pool?.size ?? 0,
    };
  }

  /** Clears pods left by a previous process and starts the idle reaper (in-cluster only). */
  startBackground(): void {
    if (!this.pool) return;
    this.pool
      .cleanupOrphans()
      .then((n) => console.log(`[startup] k8s runner: deleted ${n} leftover runner pods`))
      .catch((err) => console.warn("[startup] k8s runner orphan cleanup failed:", err));
    this.pool.startReaper();
  }
}

export { PodPool } from "./pod-pool";
