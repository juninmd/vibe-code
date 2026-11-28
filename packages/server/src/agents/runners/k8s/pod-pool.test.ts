import { describe, expect, it } from "bun:test";
import type { K8sRunnerConfig } from "./config";
import { FakeKube } from "./fake-kube";
import { PodPool } from "./pod-pool";

const config: K8sRunnerConfig = {
  namespace: "harness-remote",
  image: "ghcr.io/juninmd/vibe-code:test",
  claimName: "harness-remote-data",
  dataDir: "/data",
  skillsDir: "/home/vibe/.agents",
  idleMs: 60_000,
  maxLifetimeSeconds: 3600,
  startTimeoutMs: 10_000,
  cpuRequest: "250m",
  cpuLimit: "2",
  memoryRequest: "512Mi",
  memoryLimit: "4Gi",
  forwardGitHubToken: true,
  ephemeralStorageLimit: "10Gi",
  maxPodsPerUser: 2,
};
const WORKDIR = "/data/workspaces/app/run-1";

// Task worktrees and the user (workspace) each belongs to.
const OWNERS: Record<string, string> = {
  [WORKDIR]: "ws-ana",
  "/data/workspaces/app/run-2": "ws-ana",
  "/data/workspaces/app/run-3": "ws-ana",
  "/data/workspaces/app/run-4": "ws-ana",
  "/data/workspaces/app/run-9": "ws-bia",
};

function setup(overrides: Partial<K8sRunnerConfig> = {}) {
  const kube = new FakeKube();
  const cfg = { ...config, ...overrides };
  let clock = 1_000_000;
  const dirs: string[] = [];
  const pool = new PodPool({
    api: kube,
    namespace: config.namespace,
    config: () => cfg,
    idleMs: () => cfg.idleMs,
    ownerOf: (workdir) => OWNERS[workdir] ?? "default",
    gitCommonDir: async () => "/data/repos/app.git",
    ensureDir: async (p) => {
      dirs.push(p);
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    log: () => {},
  });
  const start = (env: Record<string, string> = { OPENCODE_API_KEY: "k" }, cwd = WORKDIR) =>
    pool.start({ binary: "opencode", cwd, env });
  return { kube, pool, start, dirs, cfg, tick: (ms: number) => (clock += ms) };
}

describe("PodPool", () => {
  it("starts a pod for the task and returns its serve URL with the pod's password", async () => {
    const { kube, start, dirs } = setup();
    const handle = await start();
    expect(handle.url).toBe("http://10.0.0.1:4096");
    expect(handle.authorization).toStartWith("Basic ");
    expect(kube.pods.size).toBe(1);
    const [secret] = [...kube.secrets.values()];
    expect(secret.manifest.stringData.OPENCODE_API_KEY).toBe("k");
    expect(secret.owner?.kind).toBe("Pod");
    expect(dirs[0]).toStartWith("/data/runner/opencode/");
  });

  it("puts the user's GitHub token in the pod's Secret, never in the pod spec", async () => {
    const { kube, start } = setup();
    await start({ OPENCODE_API_KEY: "k", GH_TOKEN: "gho_user" });
    const [secret] = [...kube.secrets.values()];
    expect(secret.manifest.stringData.GH_TOKEN).toBe("gho_user");
    const [pod] = [...kube.pods.values()];
    expect(JSON.stringify(pod.manifest)).not.toContain("gho_user");
  });

  it("reuses the same pod for the next turn instead of starting another", async () => {
    const { kube, start } = setup();
    (await start()).close();
    const second = await start();
    expect(kube.pods.size).toBe(1);
    expect(second.url).toBe("http://10.0.0.1:4096");
  });

  it("deletes the pod only after it has been idle for idleMs", async () => {
    const { kube, pool, start, tick } = setup();
    const handle = await start();
    tick(120_000);
    expect(await pool.reap()).toBe(0); // mid-turn: never reaped
    handle.close();
    tick(59_000);
    expect(await pool.reap()).toBe(0);
    tick(1_000);
    expect(await pool.reap()).toBe(1);
    expect(kube.pods.size).toBe(0);
    expect(kube.secrets.size).toBe(0);
    expect(await handle.exited).toBe(0);
  });

  it("starts a fresh pod when the previous one was reaped or died", async () => {
    const { kube, pool, start, tick } = setup();
    (await start()).close();
    tick(60_000);
    await pool.reap();
    expect((await start()).url).toBe("http://10.0.0.2:4096");
    kube.pods.clear();
    expect((await start()).url).toBe("http://10.0.0.3:4096");
  });

  it("replaces an idle pod when the provider settings change", async () => {
    const { kube, start } = setup();
    (await start({ OPENCODE_API_KEY: "old" })).close();
    await start({ OPENCODE_API_KEY: "new" });
    expect(kube.pods.size).toBe(1);
    const [secret] = [...kube.secrets.values()];
    expect(secret.manifest.stringData.OPENCODE_API_KEY).toBe("new");
  });

  it("shares one pod between concurrent starts for the same task", async () => {
    const { kube, start } = setup();
    const [a, b] = await Promise.all([start(), start()]);
    expect(a.url).toBe(b.url);
    expect(kube.pods.size).toBe(1);
  });

  it("fails fast on an image pull error and cleans up what it created", async () => {
    const { kube, start } = setup();
    kube.failWith = { reason: "ImagePullBackOff", message: "not found" };
    await expect(start()).rejects.toThrow("ImagePullBackOff");
    expect(kube.pods.size).toBe(0);
    expect(kube.secrets.size).toBe(0);
  });

  it("gives up when the pod is not ready before the start timeout", async () => {
    const { kube, start } = setup();
    kube.readyAfter = 1_000;
    await expect(start()).rejects.toThrow("not ready within");
    expect(kube.pods.size).toBe(0);
  });

  it("deletes runner pods left over from a previous server process", async () => {
    const { kube, pool, start } = setup();
    await kube.createPod("ns", { metadata: { name: "vibe-agent-old" } });
    await start();
    expect(await pool.cleanupOrphans()).toBe(1);
    expect([...kube.pods.keys()]).toHaveLength(1);
    expect(kube.pods.has("vibe-agent-old")).toBe(false);
  });

  it("never treats a pod that is still starting as an orphan", async () => {
    const { kube, pool, start } = setup();
    kube.onGetPod = async () => {
      expect(await pool.cleanupOrphans()).toBe(0);
    };
    await start();
    expect(kube.pods.size).toBe(1);
  });

  it("does not reap a pod while a new turn is checking it out", async () => {
    const { kube, pool, start, tick } = setup();
    (await start()).close();
    tick(60_000);
    kube.onGetPod = async () => {
      expect(await pool.reap()).toBe(0);
    };
    const handle = await start();
    expect(handle.url).toBe("http://10.0.0.1:4096");
    expect(kube.pods.size).toBe(1);
  });

  it("retries a failed delete through the orphan sweep", async () => {
    const { kube, pool, start, tick } = setup();
    (await start()).close();
    tick(60_000);
    kube.failDeletes = 1;
    expect(await pool.reap()).toBe(0);
    expect(kube.pods.size).toBe(1);
    expect(await pool.cleanupOrphans()).toBe(1);
    expect(kube.pods.size).toBe(0);
  });

  describe("per-user pod cap", () => {
    const key = { OPENCODE_API_KEY: "k" };
    const run = (n: number) => `/data/workspaces/app/run-${n}`;

    it("frees the user's oldest idle pod to start a new task", async () => {
      const { kube, start, tick } = setup();
      (await start(key, run(1))).close();
      tick(1_000);
      (await start(key, run(2))).close();
      await start(key, run(3));
      expect(kube.pods.size).toBe(2);
      const workspaces = [...kube.pods.values()].map(
        (p) => p.manifest.spec.containers[0].workingDir
      );
      expect(workspaces).toEqual([run(2), run(3)]);
    });

    it("refuses a new task when every pod of the user is mid-turn", async () => {
      const { kube, start } = setup({ maxPodsPerUser: 1 });
      await start(key, run(1));
      await expect(start(key, run(2))).rejects.toThrow("por usuário");
      expect(kube.pods.size).toBe(1);
    });

    it("does not let one user's pods count against another's", async () => {
      const { kube, start } = setup({ maxPodsPerUser: 1 });
      await start(key, run(1));
      await start(key, run(9));
      expect(kube.pods.size).toBe(2);
      const owners = new Set(
        [...kube.pods.values()].map((p) => p.manifest.metadata.labels["vibe-code/owner"])
      );
      expect(owners.size).toBe(2);
    });

    it("counts pods still starting, so concurrent tasks cannot overshoot the cap", async () => {
      const { kube, start } = setup({ maxPodsPerUser: 1 });
      const results = await Promise.allSettled([start(key, run(1)), start(key, run(2))]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(kube.pods.size).toBe(1);
    });
  });

  it("over the namespace quota, frees another user's idle pod instead of failing", async () => {
    const { kube, start } = setup();
    kube.quotaPods = 1;
    (await start({ OPENCODE_API_KEY: "k" }, "/data/workspaces/app/run-1")).close();
    await start({ OPENCODE_API_KEY: "k" }, "/data/workspaces/app/run-9");
    expect(kube.pods.size).toBe(1);
    const [pod] = [...kube.pods.values()];
    expect(pod.manifest.spec.containers[0].workingDir).toBe("/data/workspaces/app/run-9");
  });

  it("surfaces the quota error when every pod in the namespace is mid-turn", async () => {
    const { kube, start } = setup();
    kube.quotaPods = 1;
    await start({ OPENCODE_API_KEY: "k" }, "/data/workspaces/app/run-1");
    await expect(start({ OPENCODE_API_KEY: "k" }, "/data/workspaces/app/run-9")).rejects.toThrow(
      "exceeded quota"
    );
  });

  it("never frees a pod that started a turn while another was being deleted", async () => {
    const { kube, start, cfg } = setup({ maxPodsPerUser: 3 });
    const key = { OPENCODE_API_KEY: "k" };
    const run = (n: number) => `/data/workspaces/app/run-${n}`;
    for (const n of [1, 2, 3]) (await start(key, run(n))).close();
    cfg.maxPodsPerUser = 1;
    // run-2 starts a turn while run-1 (the oldest) is being deleted to make room.
    let midTurn: Promise<unknown> | undefined;
    kube.onDeletePod = async () => {
      midTurn = start(key, run(2));
      await midTurn;
    };
    const newTask = start(key, run(4));
    await expect(newTask).rejects.toThrow("por usuário");
    await midTurn;
    const live = [...kube.pods.values()].map((p) => p.manifest.spec.containers[0].workingDir);
    expect(live).toContain(run(2));
  });

  it("says why the scheduler left the pod Pending when the start times out", async () => {
    const { kube, start } = setup();
    kube.readyAfter = 1_000;
    kube.pendingCondition = { type: "PodScheduled", status: "False", message: "Insufficient cpu" };
    await expect(start()).rejects.toThrow("not scheduled: Insufficient cpu");
  });
});
