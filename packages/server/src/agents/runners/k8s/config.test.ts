import { describe, expect, it } from "bun:test";
import {
  defaultRunnerSettings,
  k8sProblems,
  RUNNER_SETTINGS_KEY,
  readRunnerSettings,
  toK8sConfig,
} from "./config";

const store = (value: string | null) => ({
  get: (key: string) => (key === RUNNER_SETTINGS_KEY ? value : null),
});
const cluster = { KUBERNETES_SERVICE_HOST: "10.0.0.1" };

describe("runner settings", () => {
  it("starts local, with env vars only as defaults", () => {
    expect(defaultRunnerSettings({}).runner).toBe("local");
    const seeded = defaultRunnerSettings({
      VIBE_K8S_RUNNER_IMAGE: "img",
      VIBE_K8S_IDLE_MINUTES: "abc",
    });
    expect(seeded.image).toBe("img");
    expect(seeded.idleMinutes).toBe(15);
    expect(seeded.forwardGitHubToken).toBe(true);
    expect(
      defaultRunnerSettings({ VIBE_K8S_FORWARD_GITHUB_TOKEN: "false" }).forwardGitHubToken
    ).toBe(false);
  });

  it("lets what the operator saved win over the env defaults", () => {
    const saved = JSON.stringify({ runner: "k8s", idleMinutes: 5 });
    const settings = readRunnerSettings(store(saved), { VIBE_K8S_RUNNER_IMAGE: "img" });
    expect(settings).toMatchObject({ runner: "k8s", idleMinutes: 5, image: "img" });
  });

  it("falls back to the defaults when the saved row is corrupt", () => {
    expect(readRunnerSettings(store("{oops"), {}).runner).toBe("local");
  });
});

describe("k8s readiness", () => {
  const settings = { ...defaultRunnerSettings({}), runner: "k8s" as const };

  it("explains every reason k8s cannot run", () => {
    expect(k8sProblems(settings, {}, () => undefined)).toEqual([
      "o servidor não está rodando dentro de um cluster Kubernetes",
      "namespace do pod não encontrado",
      "informe a imagem do runner",
      "informe o PVC de dados",
    ]);
    expect(() => toK8sConfig(settings, "/data", {}, () => undefined)).toThrow("indisponível");
  });

  it("converts minutes and hours to the pod's units", () => {
    const config = toK8sConfig(
      { ...settings, image: "img", pvc: "data", idleMinutes: 2, maxLifetimeHours: 1.5 },
      "/data",
      { ...cluster, VIBE_K8S_NODE_NAME: "node-a" },
      () => "harness-remote"
    );
    expect(config).toMatchObject({
      namespace: "harness-remote",
      idleMs: 120_000,
      maxLifetimeSeconds: 5400,
      nodeName: "node-a",
      skillsClaimName: undefined,
    });
  });
});
