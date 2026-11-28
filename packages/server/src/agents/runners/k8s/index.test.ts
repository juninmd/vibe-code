import { describe, expect, it } from "bun:test";
import type { AgentRunnerSettings } from "@vibe-code/shared";
import { defaultRunnerSettings } from "./config";
import { FakeKube } from "./fake-kube";
import { AgentRunner } from "./index";

const cluster = { KUBERNETES_SERVICE_HOST: "10.0.0.1" };
const local = async () => ({
  url: "http://127.0.0.1:1",
  authorization: "local",
  exited: Promise.resolve(0),
  close() {},
});

function runner(env: Record<string, string>, initial: Partial<AgentRunnerSettings>) {
  let settings = { ...defaultRunnerSettings({}), image: "img", pvc: "data", ...initial };
  const kube = new FakeKube();
  kube.readyAfter = 0;
  const agent = new AgentRunner({
    settings: () => settings,
    dataDir: "/data",
    env,
    api: kube,
    readNamespace: () => "harness-remote",
    localStart: local,
    pool: {
      gitCommonDir: async () => "/data/repos/app.git",
      ensureDir: async () => {},
      log: () => {},
    },
  });
  const turn = () => agent.start({ binary: "opencode", cwd: "/data/workspaces/app/r", env: {} });
  return {
    agent,
    kube,
    turn,
    set: (next: Partial<AgentRunnerSettings>) => (settings = { ...settings, ...next }),
  };
}

describe("AgentRunner", () => {
  it("switches between local and pod per turn, following Settings without a restart", async () => {
    const { kube, turn, set } = runner(cluster, { runner: "local" });
    expect((await turn()).authorization).toBe("local");
    set({ runner: "k8s" });
    const pod = await turn();
    expect(pod.url).toStartWith("http://10.0.0.");
    expect(kube.pods.size).toBe(1);
    set({ runner: "local" });
    expect((await turn()).authorization).toBe("local");
  });

  it("fails the turn with the reason when k8s is chosen outside a cluster", async () => {
    const { agent, turn } = runner({}, { runner: "k8s" });
    await expect(turn()).rejects.toThrow("não está rodando dentro de um cluster");
    expect(agent.clusterStatus().inCluster).toBe(false);
  });

  it("reports the cluster and how many pods it tracks", async () => {
    const { agent, turn } = runner({ ...cluster, VIBE_K8S_NODE_NAME: "node-a" }, { runner: "k8s" });
    (await turn()).close();
    expect(agent.clusterStatus()).toEqual({
      inCluster: true,
      namespace: "harness-remote",
      nodeName: "node-a",
      activePods: 1,
    });
  });

  it("skips orphan pod cleanup on startup when runner is local", async () => {
    const { agent, kube } = runner(cluster, { runner: "local" });
    let listed = 0;
    kube.listPods = async () => {
      listed++;
      return [];
    };
    agent.startBackground();
    await Promise.resolve();
    expect(listed).toBe(0);
  });
});
