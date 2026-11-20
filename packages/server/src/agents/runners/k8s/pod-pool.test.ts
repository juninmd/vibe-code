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
};
const WORKDIR = "/data/workspaces/app/run-1";

function setup() {
  const kube = new FakeKube();
  let clock = 1_000_000;
  const dirs: string[] = [];
  const pool = new PodPool({
    api: kube,
    namespace: config.namespace,
    config: () => config,
    idleMs: () => config.idleMs,
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
  const start = (env: Record<string, string> = { OPENCODE_API_KEY: "k" }) =>
    pool.start({ binary: "opencode", cwd: WORKDIR, env });
  return { kube, pool, start, dirs, tick: (ms: number) => (clock += ms) };
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
});
