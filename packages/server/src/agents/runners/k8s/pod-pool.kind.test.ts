/**
 * PodPool against a real API server (kind), authenticated as the server's own
 * ServiceAccount with the manifest's Role, under its Pod Security, quota and
 * limit range. Skipped unless VIBE_K8S_E2E_API is set; see .github/workflows/k8s-runner-e2e.yml.
 */
import { describe, expect, it } from "bun:test";
import { InClusterKubeApi } from "./api";
import type { K8sRunnerConfig } from "./config";
import { PodPool } from "./pod-pool";
import { MANAGED_SELECTOR } from "./pod-spec";

const env = process.env;
const enabled = !!env.VIBE_K8S_E2E_API;
const namespace = env.VIBE_K8S_E2E_NAMESPACE || "harness-remote";

const config: K8sRunnerConfig = {
  namespace,
  image: env.VIBE_K8S_E2E_IMAGE || "vibe-fake-runner:e2e",
  claimName: env.VIBE_K8S_E2E_PVC || "e2e-data",
  dataDir: "/data",
  skillsDir: "/home/vibe/.agents",
  idleMs: 0,
  maxLifetimeSeconds: 600,
  startTimeoutMs: 120_000,
  forwardGitHubToken: false,
  cpuRequest: "50m",
  cpuLimit: "500m",
  memoryRequest: "64Mi",
  memoryLimit: "256Mi",
  ephemeralStorageLimit: "1Gi",
  maxPodsPerUser: 1,
};

function setup() {
  const api = new InClusterKubeApi(
    env.VIBE_K8S_E2E_API as string,
    () => env.VIBE_K8S_E2E_TOKEN as string,
    env.VIBE_K8S_E2E_CA
  );
  const owners: Record<string, string> = {
    "/data/workspaces/app/run-1": "ws-ana",
    "/data/workspaces/app/run-2": "ws-ana",
  };
  const pool = new PodPool({
    api,
    namespace,
    config: () => config,
    idleMs: () => 0,
    ownerOf: (workdir) => owners[workdir] ?? "ws-bia",
    gitCommonDir: async () => "/data/repos/app.git",
    ensureDir: async () => {},
  });
  const start = (n: number) =>
    pool.start({ binary: "opencode", cwd: `/data/workspaces/app/run-${n}`, env: { E2E: "1" } });
  return { api, pool, start };
}

describe.skipIf(!enabled)("PodPool on a real cluster", () => {
  it("creates a restricted, bounded pod, caps one user and cleans everything up", async () => {
    const { api, pool, start } = setup();
    const first = await start(1);
    expect(first.url).toMatch(/^http:\/\/[\d.:[\]a-f]+:4096$/);
    const pods = await api.listPods(namespace, MANAGED_SELECTOR);
    expect(pods).toHaveLength(1);

    // Same user, cap 1, first pod mid-turn: refused without creating anything.
    await expect(start(2)).rejects.toThrow("por usuário");
    // Another user is not affected by that cap.
    const other = await start(9);
    expect(await api.listPods(namespace, MANAGED_SELECTOR)).toHaveLength(2);

    first.close();
    other.close();
    expect(await pool.reap()).toBe(2);
    for (let i = 0; i < 60; i++) {
      if ((await api.listPods(namespace, MANAGED_SELECTOR)).length === 0) break;
      await Bun.sleep(1000);
    }
    expect(await api.listPods(namespace, MANAGED_SELECTOR)).toHaveLength(0);
  }, 300_000);
});
