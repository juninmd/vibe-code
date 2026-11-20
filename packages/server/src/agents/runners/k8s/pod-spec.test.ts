import { describe, expect, it } from "bun:test";
import type { K8sRunnerConfig } from "./config";
import { podEnv, podManifest, secretManifest, subPathOf } from "./pod-spec";

const config = {
  namespace: "ns",
  image: "img",
  claimName: "data",
  dataDir: "/data",
  nodeName: "node-a",
  imagePullSecret: "ghcr-pull-secret",
  skillsClaimName: "skills",
  skillsDir: "/home/vibe/.agents",
  idleMs: 1,
  maxLifetimeSeconds: 600,
  startTimeoutMs: 1,
  cpuRequest: "1",
  cpuLimit: "2",
  memoryRequest: "1Gi",
  memoryLimit: "2Gi",
  forwardGitHubToken: false,
} satisfies K8sRunnerConfig;
const input = {
  name: "vibe-agent-x",
  workdir: "/data/workspaces/app/run-1",
  gitCommonDir: "/data/repos/app.git",
  env: { OPENCODE_API_KEY: "k" },
  password: "pw",
};

describe("podEnv", () => {
  const raw = {
    OPENCODE_API_KEY: "k",
    OPENCODE_CONFIG_CONTENT: "{}",
    PWD: "/data/workspaces/app/run-1",
    GITHUB_TOKEN: "ghp",
    GH_TOKEN: "ghp",
    GIT_ASKPASS: "/tmp/askpass",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: "AUTHORIZATION: basic Z2hw",
    PATH: "/usr/bin",
    HOME: "/home/vibe",
    KUBERNETES_SERVICE_HOST: "10.0.0.1",
    HARNESS_REMOTE_SERVICE_PORT: "80",
    HARNESS_REMOTE_PORT: "tcp://10.0.0.2:80",
    HARNESS_REMOTE_PORT_80_TCP_ADDR: "10.0.0.2",
    VIBE_K8S_PVC: "data",
    XDG_DATA_HOME: "/x",
    "BAD NAME": "x",
  };

  it("gives the agent the user's GitHub token so `gh` and `git push` work in the pod", () => {
    expect(Object.keys(podEnv(raw, { forwardGitHubToken: true })).sort()).toEqual([
      "GH_TOKEN",
      "GITHUB_TOKEN",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_0",
      "GIT_CONFIG_VALUE_0",
      "OPENCODE_API_KEY",
      "OPENCODE_CONFIG_CONTENT",
      "PWD",
    ]);
  });

  it("keeps every GitHub credential on the server when forwarding is off", () => {
    expect(Object.keys(podEnv(raw, { forwardGitHubToken: false })).sort()).toEqual([
      "OPENCODE_API_KEY",
      "OPENCODE_CONFIG_CONTENT",
      "PWD",
    ]);
  });
});

describe("subPathOf", () => {
  it("maps paths inside the data dir and refuses anything outside it", () => {
    expect(subPathOf("/data", "/data/workspaces/app/run-1")).toBe("workspaces/app/run-1");
    expect(() => subPathOf("/data", "/etc")).toThrow("outside");
    expect(() => subPathOf("/data", "/data")).toThrow("outside");
    expect(() => subPathOf("/data", "/data/../etc")).toThrow("outside");
  });
});

describe("podManifest", () => {
  const pod = podManifest(config, input);
  const container = pod.spec.containers[0];

  it("mounts only the task worktree, its bare repo, its OpenCode sessions and the skills (read-only) at the server's paths", () => {
    expect(container.volumeMounts.map((m) => [m.mountPath, m.subPath])).toEqual([
      ["/data/workspaces/app/run-1", "workspaces/app/run-1"],
      ["/data/repos/app.git", "repos/app.git"],
      [
        "/home/vibe/.local/share/opencode",
        expect.stringMatching(/^runner\/opencode\/[0-9a-f]{12}$/),
      ],
      ["/home/vibe/.agents", undefined],
    ]);
    expect(container.volumeMounts[3].readOnly).toBe(true);
    expect(pod.spec.imagePullSecrets).toEqual([{ name: "ghcr-pull-secret" }]);
    expect(container.workingDir).toBe(input.workdir);
  });

  it("is locked down: no API token, non-root, no privilege escalation, hard lifetime cap", () => {
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(pod.spec.securityContext.runAsNonRoot).toBe(true);
    expect(container.securityContext.allowPrivilegeEscalation).toBe(false);
    expect(pod.spec.activeDeadlineSeconds).toBe(600);
    expect(pod.spec.restartPolicy).toBe("Never");
    expect(pod.spec.nodeName).toBe("node-a");
  });

  it("keeps secrets out of the pod spec and in the per-pod Secret", () => {
    expect(JSON.stringify(pod)).not.toContain("pw");
    expect(container.envFrom[0].secretRef.name).toBe("vibe-agent-x-env");
    const secret = secretManifest(config, input);
    expect(secret.stringData).toEqual({ OPENCODE_API_KEY: "k", OPENCODE_SERVER_PASSWORD: "pw" });
  });
});
