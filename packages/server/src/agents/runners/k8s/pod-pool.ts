import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  basicAuth,
  type ServeHandle,
  type StartServeOptions,
} from "../../engines/opencode-serve/process";
import type { KubeApi, KubePod } from "./api";
import type { K8sRunnerConfig } from "./config";
import {
  MANAGED_SELECTOR,
  podEnv,
  podManifest,
  runnerDataDir,
  SERVE_PORT,
  secretManifest,
  workspaceKey,
} from "./pod-spec";

interface Entry {
  name: string;
  url: string;
  authorization: string;
  envHash: string;
  owner: string;
  busy: number;
  lastActive: number;
  exited: Promise<number>;
  finish: (code: number) => void;
}

export interface PodPoolDeps {
  api: KubeApi;
  namespace: string;
  /** Read per pod start, so Settings changes apply to the next pod without a restart. */
  config: () => K8sRunnerConfig;
  /** Read on every sweep, so a new idle time applies to running pods too. */
  idleMs: () => number;
  /** When false and no pods are tracked, the reaper skips Kubernetes API sweeps. */
  enabled?: () => boolean;
  /** Absolute path of the bare repository behind a worktree. */
  gitCommonDir?: (workdir: string) => Promise<string>;
  /** User (workspace) a task belongs to, for the per-user pod cap and label. */
  ownerOf?: (workdir: string) => string;
  ensureDir?: (path: string) => Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
}

// Waiting reasons that never resolve on their own; fail fast instead of hitting the timeout.
const STUCK = new Set([
  "ErrImagePull",
  "ImagePullBackOff",
  "InvalidImageName",
  "CreateContainerConfigError",
  "CreateContainerError",
]);

async function bareRepoOf(workdir: string): Promise<string> {
  const proc = Bun.spawn(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    cwd: workdir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  if (code !== 0) throw new Error(`${workdir} is not a git worktree`);
  return out.trim();
}

function isReady(pod: KubePod): boolean {
  return !!pod.status?.conditions?.some((c) => c.type === "Ready" && c.status === "True");
}

/** Why the scheduler has not placed the pod yet (e.g. "0/1 nodes are available: Insufficient cpu"). */
function unscheduledReason(pod: KubePod): string | undefined {
  const scheduled = pod.status?.conditions?.find((c) => c.type === "PodScheduled");
  return scheduled?.status === "False" ? scheduled.message || scheduled.reason : undefined;
}

function hashEnv(env: Record<string, string>): string {
  const sorted = Object.keys(env)
    .sort()
    .map((k) => `${k}=${env[k]}`)
    .join("\n");
  return createHash("sha256").update(sorted).digest("hex");
}

/**
 * Keeps one `opencode serve` pod per task workspace. A turn borrows the pod; between turns
 * it idles until the reaper deletes it after `idleMs`. The next turn starts a fresh pod that
 * resumes the same OpenCode session from the task's volume.
 */
export class PodPool {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<Entry>>();
  /** Pods created but not yet Ready; never orphans. */
  private readonly starting = new Set<string>();
  /** Pods being created per owner, counted against the per-user cap before they exist. */
  private readonly reserved = new Map<string, number>();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: (message: string) => void;

  constructor(private readonly deps: PodPoolDeps) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => Bun.sleep(ms));
    this.log = deps.log ?? ((message) => console.log(`[k8s-runner] ${message}`));
  }

  /** Same contract as `startOpencodeServe`: `close()` ends the turn, not the pod. */
  readonly start = async (options: StartServeOptions): Promise<ServeHandle> => {
    const { forwardGitHubToken } = this.deps.config();
    const entry = await this.acquire(options.cwd, podEnv(options.env, { forwardGitHubToken }));
    entry.busy++;
    let closed = false;
    return {
      url: entry.url,
      authorization: entry.authorization,
      exited: entry.exited,
      close: () => {
        if (closed) return;
        closed = true;
        entry.busy--;
        entry.lastActive = this.now();
      },
    };
  };

  get size(): number {
    return this.entries.size;
  }

  private async acquire(workdir: string, env: Record<string, string>): Promise<Entry> {
    const inFlight = this.pending.get(workdir);
    if (inFlight) return inFlight;
    const promise = this.reuseOrCreate(workdir, env).finally(() => this.pending.delete(workdir));
    this.pending.set(workdir, promise);
    return promise;
  }

  private async reuseOrCreate(workdir: string, env: Record<string, string>): Promise<Entry> {
    const envHash = hashEnv(env);
    const current = this.entries.get(workdir);
    if (current) {
      // Hold the entry so the reaper cannot delete the pod while we check it.
      current.busy++;
      const pod = await this.deps.api
        .getPod(this.deps.namespace, current.name)
        .finally(() => current.busy--);
      const healthy = pod && pod.status?.phase === "Running" && isReady(pod);
      // A changed key or model provider needs a new Secret, so a new pod (unless mid-turn).
      if (healthy && (current.envHash === envHash || current.busy > 0)) return current;
      await this.remove(workdir, current, healthy ? "settings changed" : "pod gone");
    }
    const owner = this.deps.ownerOf?.(workdir) ?? "default";
    // Reserve first so concurrent starts of one user see each other.
    this.reserved.set(owner, (this.reserved.get(owner) ?? 0) + 1);
    try {
      await this.makeRoom(owner, this.deps.config().maxPodsPerUser);
      const entry = await this.createWithinQuota(workdir, env, envHash, owner);
      this.entries.set(workdir, entry);
      return entry;
    } finally {
      const left = (this.reserved.get(owner) ?? 1) - 1;
      if (left > 0) this.reserved.set(owner, left);
      else this.reserved.delete(owner);
    }
  }

  /** Frees the owner's oldest idle pods until the new one fits under the cap. */
  private async makeRoom(owner: string, cap: number) {
    for (;;) {
      const mine = [...this.entries.values()].filter((e) => e.owner === owner).length;
      if (mine + (this.reserved.get(owner) ?? 0) <= cap) return;
      // Picked fresh each round: a pod may have started a turn while we deleted another.
      if (!(await this.removeOldestIdle((e) => e.owner === owner, "user pod limit"))) {
        throw new Error(
          `Limite de ${cap} pod(s) de agente por usuário atingido: espere um turno terminar ou aumente o limite em Configurações → Execução`
        );
      }
    }
  }

  /** Deletes the least recently used idle pod matching `which`; false when there is none. */
  private async removeOldestIdle(which: (e: Entry) => boolean, why: string): Promise<boolean> {
    let oldest: [string, Entry] | undefined;
    for (const pair of this.entries) {
      if (pair[1].busy > 0 || !which(pair[1])) continue;
      if (!oldest || pair[1].lastActive < oldest[1].lastActive) oldest = pair;
    }
    if (!oldest) return false;
    await this.remove(oldest[0], oldest[1], why);
    return true;
  }

  /** The namespace quota is shared by every user: over it, any user's idle pod makes room once. */
  private async createWithinQuota(
    workdir: string,
    env: Record<string, string>,
    envHash: string,
    owner: string
  ): Promise<Entry> {
    try {
      return await this.create(workdir, env, envHash, owner);
    } catch (error) {
      if (!/exceeded quota/i.test((error as Error).message)) throw error;
      if (!(await this.removeOldestIdle(() => true, "namespace quota"))) throw error;
      return this.create(workdir, env, envHash, owner);
    }
  }

  private async create(
    workdir: string,
    env: Record<string, string>,
    envHash: string,
    owner: string
  ) {
    const { api } = this.deps;
    const config = this.deps.config();
    const name = `vibe-agent-${workspaceKey(workdir)}-${randomBytes(3).toString("hex")}`;
    const gitCommonDir = await (this.deps.gitCommonDir ?? bareRepoOf)(workdir);
    // The server creates it so it is owned by the runtime user, not by kubelet's root.
    await (this.deps.ensureDir ?? ((p) => mkdir(p, { recursive: true }).then(() => {})))(
      runnerDataDir(config.dataDir, workdir)
    );
    const password = randomBytes(24).toString("base64url");
    const input = { name, workdir, gitCommonDir, env, password, owner };
    this.starting.add(name);
    await api.createSecret(config.namespace, secretManifest(config, input));
    try {
      const created = await api.createPod(config.namespace, podManifest(config, input));
      if (created.metadata.uid) {
        // Garbage-collect the Secret together with its pod.
        await api.patchSecretOwner(config.namespace, `${name}-env`, {
          apiVersion: "v1",
          kind: "Pod",
          name,
          uid: created.metadata.uid,
        });
      }
      const ip = await this.waitReady(name, config);
      this.log(`pod ${name} ready for ${workdir}`);
      let finish: (code: number) => void = () => {};
      const exited = new Promise<number>((resolve) => {
        finish = resolve;
      });
      const host = ip.includes(":") ? `[${ip}]` : ip;
      return {
        name,
        url: `http://${host}:${SERVE_PORT}`,
        authorization: basicAuth(password),
        envHash,
        owner,
        busy: 0,
        lastActive: this.now(),
        exited,
        finish,
      };
    } catch (error) {
      await api.deletePod(config.namespace, name).catch(() => {});
      await api.deleteSecret(config.namespace, `${name}-env`).catch(() => {});
      throw error;
    } finally {
      this.starting.delete(name);
    }
  }

  private async waitReady(name: string, config: K8sRunnerConfig): Promise<string> {
    const { api } = this.deps;
    const deadline = this.now() + config.startTimeoutMs;
    for (;;) {
      const pod = await api.getPod(config.namespace, name);
      if (!pod) throw new Error(`runner pod ${name} disappeared while starting`);
      const phase = pod.status?.phase;
      if (phase === "Failed" || phase === "Succeeded") {
        throw new Error(`runner pod ${name} ended while starting (${phase})`);
      }
      const waiting = pod.status?.containerStatuses?.[0]?.state?.waiting;
      if (waiting?.reason && STUCK.has(waiting.reason)) {
        throw new Error(`runner pod ${name}: ${waiting.reason} ${waiting.message ?? ""}`.trim());
      }
      if (phase === "Running" && isReady(pod) && pod.status?.podIP) return pod.status.podIP;
      if (this.now() >= deadline) {
        const pending = unscheduledReason(pod);
        throw new Error(
          `runner pod ${name} not ready within ${config.startTimeoutMs}ms${pending ? ` (not scheduled: ${pending})` : ""}`
        );
      }
      await this.sleep(1000);
    }
  }

  private async remove(workdir: string, entry: Entry, why: string) {
    this.entries.delete(workdir);
    entry.finish(0);
    this.log(`deleting pod ${entry.name} (${why})`);
    const { api, namespace } = this.deps;
    await api.deletePod(namespace, entry.name);
    await api.deleteSecret(namespace, `${entry.name}-env`).catch(() => {});
  }

  /** Deletes pods that have been idle for `idleMs`. Returns how many were deleted. */
  async reap(): Promise<number> {
    const cutoff = this.now() - this.deps.idleMs();
    let removed = 0;
    for (const [workdir, entry] of [...this.entries]) {
      if (entry.busy > 0 || entry.lastActive > cutoff) continue;
      try {
        await this.remove(workdir, entry, "idle");
        removed++;
      } catch (error) {
        this.log(`failed to delete ${entry.name}: ${(error as Error).message}`);
      }
    }
    return removed;
  }

  /**
   * Deletes runner pods this process does not track: left over from a restart, or whose
   * earlier delete failed. Pods still starting are tracked.
   */
  async cleanupOrphans(): Promise<number> {
    const { api, namespace } = this.deps;
    const known = new Set([...this.entries.values()].map((e) => e.name));
    for (const name of this.starting) known.add(name);
    const pods = await api.listPods(namespace, MANAGED_SELECTOR);
    let removed = 0;
    for (const pod of pods) {
      if (known.has(pod.metadata.name)) continue;
      await api.deletePod(namespace, pod.metadata.name);
      await api.deleteSecret(namespace, `${pod.metadata.name}-env`).catch(() => {});
      removed++;
    }
    return removed;
  }

  /** Runs the reaper on an interval; returns a stop function. */
  startReaper(intervalMs = 30_000): () => void {
    const timer = setInterval(() => {
      if (this.deps.enabled && !this.deps.enabled() && this.entries.size === 0) return;
      // The orphan sweep retries pods whose delete failed after they left the pool.
      void this.reap()
        .then(() => this.cleanupOrphans())
        .catch((error) => this.log(`sweep failed: ${(error as Error).message}`));
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
  }
}
