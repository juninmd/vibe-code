import { opencodeTransport } from "../../engines/opencode";
import { InClusterKubeApi } from "./api";
import { k8sRunnerConfig } from "./config";
import { PodPool } from "./pod-pool";

/** Builds the pod pool for VIBE_AGENT_RUNNER=k8s; throws when the deployment is misconfigured. */
export function createK8sPodPool(dataDir: string, env = process.env): PodPool {
  const config = k8sRunnerConfig({ ...env, VIBE_CODE_DATA_DIR: dataDir });
  if (opencodeTransport(env) !== "serve") {
    console.warn("[k8s-runner] VIBE_OPENCODE_TRANSPORT=cli keeps OpenCode turns in this pod");
  }
  return new PodPool({ api: InClusterKubeApi.fromEnvironment(env), config });
}

export { agentRunner } from "./config";
export { PodPool } from "./pod-pool";
