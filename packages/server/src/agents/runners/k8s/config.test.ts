import { describe, expect, it } from "bun:test";
import { agentRunner, k8sRunnerConfig } from "./config";

describe("agentRunner", () => {
  it("defaults to local and only switches on an explicit k8s", () => {
    expect(agentRunner({})).toBe("local");
    expect(agentRunner({ VIBE_AGENT_RUNNER: "pod" })).toBe("local");
    expect(agentRunner({ VIBE_AGENT_RUNNER: "k8s" })).toBe("k8s");
  });
});

describe("k8sRunnerConfig", () => {
  it("names every missing variable at once", () => {
    expect(() => k8sRunnerConfig({}, () => undefined)).toThrow(
      "VIBE_K8S_NAMESPACE, VIBE_K8S_RUNNER_IMAGE, VIBE_K8S_PVC"
    );
  });

  it("uses the pod's own namespace and sane defaults", () => {
    const config = k8sRunnerConfig(
      { VIBE_K8S_RUNNER_IMAGE: "img", VIBE_K8S_PVC: "data", VIBE_K8S_IDLE_MS: "abc" },
      () => "harness-remote"
    );
    expect(config.namespace).toBe("harness-remote");
    expect(config.idleMs).toBe(15 * 60_000);
    expect(config.dataDir).toBe("/data");
  });
});
