/** Where agent turns execute: inside the server, or one Kubernetes pod per task. */
export type AgentRunnerMode = "local" | "k8s";

/** Runner options an operator edits in Settings; deployment env vars only seed the defaults. */
export interface AgentRunnerSettings {
  runner: AgentRunnerMode;
  /** Image with `opencode` and `git`. */
  image: string;
  /** PVC holding the server's data dir. */
  pvc: string;
  /** Skills PVC mounted read-only; empty = none. */
  skillsPvc: string;
  imagePullSecret: string;
  /** Minutes without a turn before the task's pod is deleted. */
  idleMinutes: number;
  /** Hard cap on a pod's life (activeDeadlineSeconds), in hours. */
  maxLifetimeHours: number;
  startTimeoutSeconds: number;
  /**
   * Give the agent in the pod the signed-in user's GitHub token (GH_TOKEN and a git auth
   * header), so it can push and run `gh pr create` itself.
   */
  forwardGitHubToken: boolean;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  /** Cap on the pod's scratch disk (image layer, /tmp, caches); the worktree lives on the PVC. */
  ephemeralStorageLimit: string;
  /** Runner pods one user (workspace) may hold at once; their oldest idle pod makes room. */
  maxPodsPerUser: number;
}

export interface AgentRunnerStatus {
  settings: AgentRunnerSettings;
  /** The server runs inside a pod and can reach the Kubernetes API. */
  inCluster: boolean;
  namespace?: string;
  nodeName?: string;
  /** Runner pods this server is tracking right now. */
  activePods: number;
}
