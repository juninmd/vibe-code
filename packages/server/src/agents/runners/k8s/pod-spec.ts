import { createHash } from "node:crypto";
import { isAbsolute, join, relative } from "node:path";
import type { K8sRunnerConfig } from "./config";

export const SERVE_PORT = 4096;
export const MANAGED_SELECTOR =
  "app.kubernetes.io/managed-by=vibe-code,app.kubernetes.io/component=agent-runner";
const OPENCODE_DATA = "/home/vibe/.local/share/opencode";

// Host-specific or meaningless inside the runner pod. GIT_ASKPASS points at a server path.
const DROPPED = new Set(["PATH", "HOME", "HOSTNAME", "USER", "SHELL", "PORT", "GIT_ASKPASS"]);
const DROPPED_PREFIX = /^(KUBERNETES_|VIBE_K8S_|VIBE_AGENT_RUNNER|XDG_)/;
// The signed-in user's GitHub token: GH_TOKEN for `gh`, GIT_CONFIG_* for git's auth header.
const GITHUB_CREDENTIAL = /^(GH_TOKEN|GITHUB_TOKEN|GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+))$/;
const SERVICE_LINK = /_SERVICE_(HOST|PORT)(_|$)|_PORT_\d+_(TCP|UDP|SCTP)/;
const SECRET_KEY = /^[-._a-zA-Z0-9]+$/;

/** Environment the runner pod receives; everything else is the image's own. */
export function podEnv(
  env: Record<string, string | undefined>,
  options: { forwardGitHubToken: boolean }
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || DROPPED.has(name) || DROPPED_PREFIX.test(name)) continue;
    if (!options.forwardGitHubToken && GITHUB_CREDENTIAL.test(name)) continue;
    if (SERVICE_LINK.test(name) || (name.endsWith("_PORT") && value.startsWith("tcp://"))) continue;
    if (!SECRET_KEY.test(name)) continue;
    out[name] = value;
  }
  return out;
}

export function workspaceKey(workdir: string): string {
  return createHash("sha256").update(workdir).digest("hex").slice(0, 12);
}

/** Path of `absolute` inside the data volume; refuses anything outside it. */
export function subPathOf(dataDir: string, absolute: string): string {
  const rel = relative(dataDir, absolute);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`${absolute} is outside VIBE_CODE_DATA_DIR (${dataDir})`);
  }
  return rel.split("\\").join("/");
}

export function opencodeDataSubPath(workdir: string): string {
  return `runner/opencode/${workspaceKey(workdir)}`;
}

/** Where a task's pod keeps its OpenCode sessions; removed together with the worktree. */
export function runnerDataDir(dataDir: string, workdir: string): string {
  return join(dataDir, opencodeDataSubPath(workdir));
}

/** Label-safe id of the user (workspace) that owns a task; never the raw name. */
export function ownerKey(owner: string): string {
  return createHash("sha256").update(owner).digest("hex").slice(0, 12);
}

export interface PodInput {
  name: string;
  workdir: string;
  /** Bare repository the worktree's `.git` file points at. */
  gitCommonDir: string;
  env: Record<string, string>;
  password: string;
  /** User (workspace) the task belongs to. */
  owner: string;
}

interface VolumeMount {
  name: string;
  mountPath: string;
  subPath?: string;
  readOnly?: boolean;
}

function labels(input: PodInput) {
  return {
    "app.kubernetes.io/managed-by": "vibe-code",
    "app.kubernetes.io/component": "agent-runner",
    "vibe-code/workspace": workspaceKey(input.workdir),
    "vibe-code/owner": ownerKey(input.owner),
  };
}

// RWO data PVC: land on the server's node, but through the scheduler so a full node
// leaves the pod Pending (and fails the start in words) instead of OutOfcpu.
function sameNode(nodeName: string) {
  return {
    nodeAffinity: {
      requiredDuringSchedulingIgnoredDuringExecution: {
        nodeSelectorTerms: [
          {
            matchExpressions: [
              { key: "kubernetes.io/hostname", operator: "In", values: [nodeName] },
            ],
          },
        ],
      },
    },
  };
}

export function secretManifest(config: K8sRunnerConfig, input: PodInput) {
  return {
    apiVersion: "v1",
    kind: "Secret",
    type: "Opaque",
    metadata: {
      name: `${input.name}-env`,
      namespace: config.namespace,
      labels: labels(input),
    },
    stringData: { ...input.env, OPENCODE_SERVER_PASSWORD: input.password } as Record<
      string,
      string
    >,
  };
}

/** One `opencode serve` per task, seeing only that task's worktree, its bare repo and its sessions. */
export function podManifest(config: K8sRunnerConfig, input: PodInput) {
  const mount = (mountPath: string, subPath: string): VolumeMount => ({
    name: "data",
    mountPath,
    subPath,
  });
  const skills = config.skillsClaimName
    ? {
        mounts: [{ name: "skills", mountPath: config.skillsDir, readOnly: true } as VolumeMount],
        volumes: [
          {
            name: "skills",
            persistentVolumeClaim: { claimName: config.skillsClaimName, readOnly: true },
          },
        ],
      }
    : { mounts: [] as VolumeMount[], volumes: [] };
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: input.name, namespace: config.namespace, labels: labels(input) },
    spec: {
      restartPolicy: "Never",
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      activeDeadlineSeconds: config.maxLifetimeSeconds,
      ...(config.nodeName ? { affinity: sameNode(config.nodeName) } : {}),
      ...(config.imagePullSecret ? { imagePullSecrets: [{ name: config.imagePullSecret }] } : {}),
      securityContext: {
        runAsUser: 10001,
        runAsGroup: 10001,
        runAsNonRoot: true,
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [
        {
          name: "opencode",
          image: config.image,
          // Same node and tag as the server: reuse its cached (multi-GB) image instead of
          // re-pulling `:latest` on every pod.
          imagePullPolicy: "IfNotPresent",
          command: ["opencode", "serve", "--hostname", "0.0.0.0", "--port", String(SERVE_PORT)],
          workingDir: input.workdir,
          envFrom: [{ secretRef: { name: `${input.name}-env` } }],
          ports: [{ name: "serve", containerPort: SERVE_PORT }],
          readinessProbe: { tcpSocket: { port: SERVE_PORT }, periodSeconds: 2 },
          resources: {
            // No ephemeral-storage request: it defaults to the limit, which stays valid at any size.
            requests: { cpu: config.cpuRequest, memory: config.memoryRequest },
            limits: {
              cpu: config.cpuLimit,
              memory: config.memoryLimit,
              "ephemeral-storage": config.ephemeralStorageLimit,
            },
          },
          securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          volumeMounts: [
            mount(input.workdir, subPathOf(config.dataDir, input.workdir)),
            mount(input.gitCommonDir, subPathOf(config.dataDir, input.gitCommonDir)),
            mount(OPENCODE_DATA, opencodeDataSubPath(input.workdir)),
            ...skills.mounts,
          ],
        },
      ],
      volumes: [
        { name: "data", persistentVolumeClaim: { claimName: config.claimName } },
        ...skills.volumes,
      ],
    },
  };
}
