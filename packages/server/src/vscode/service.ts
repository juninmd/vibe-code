/**
 * VS Code in the browser, one code-server per session worktree.
 *
 * code-server listens on loopback only with `--auth none`; the only way in is
 * the authenticated reverse proxy under /vscode/<taskId>/ (see proxy.ts).
 * Idle instances are stopped, and at most VIBE_VSCODE_MAX run at once.
 */
import { mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { VsCodeStatus } from "@vibe-code/shared";
import { agentProcessEnv } from "../utils/agent-env";
import { killProcessTree } from "../utils/process-tree";

interface Instance {
  port: number;
  folder: string;
  pid: number;
  lastUsed: number;
  sockets: number;
  exited: Promise<unknown>;
}

export interface VsCodeServiceOptions {
  dataDir: string;
  binary?: string | null;
  maxInstances?: number;
  idleMs?: number;
  readyTimeoutMs?: number;
  now?: () => number;
}

export function resolveVsCodeBinary(env: Record<string, string | undefined> = process.env) {
  return env.VIBE_VSCODE_BIN || Bun.which("code-server") || null;
}

export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolvePort(port));
    });
  });
}

export function codeServerArgs(
  binary: string,
  port: number,
  dataDir: string,
  folder: string,
  session = "default"
) {
  return [
    binary,
    "--bind-addr",
    `127.0.0.1:${port}`,
    "--auth",
    "none",
    "--disable-telemetry",
    "--disable-update-check",
    "--disable-workspace-trust",
    "--user-data-dir",
    // One profile per session: a shared one makes a second code-server hand its
    // folder to the first instance over IPC and exit.
    join(dataDir, "vscode", "sessions", session),
    "--extensions-dir",
    join(dataDir, "vscode", "extensions"),
    folder,
  ];
}

/** Drain a stream and keep only its last 4 KB (code-server logs for as long as it runs). */
function tailOf(stream: ReadableStream<Uint8Array>): () => string {
  let tail = "";
  const decoder = new TextDecoder();
  void (async () => {
    for await (const chunk of stream) tail = (tail + decoder.decode(chunk)).slice(-4096);
  })().catch(() => {});
  return () => tail;
}

/** code-server reads $PORT before --bind-addr: the server's own PORT must not reach it. */
export function codeServerEnv(
  base: Record<string, string>,
  folder: string
): Record<string, string> {
  const { PORT: _port, ...env } = base;
  return { ...env, PWD: folder };
}

export class VsCodeService {
  private instances = new Map<string, Instance>();
  private starting = new Map<string, Promise<number>>();
  private reaper: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private options: VsCodeServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  get binary(): string | null {
    return this.options.binary === undefined ? resolveVsCodeBinary() : this.options.binary;
  }

  status(): VsCodeStatus {
    const binary = this.binary;
    return {
      available: Boolean(binary),
      binary: binary ?? undefined,
      running: this.instances.size,
    };
  }

  /** Port of a running instance; marks it used. */
  target(taskId: string): number | null {
    const instance = this.instances.get(taskId);
    if (!instance) return null;
    instance.lastUsed = this.now();
    return instance.port;
  }

  socketOpened(taskId: string): void {
    const instance = this.instances.get(taskId);
    if (instance) instance.sockets++;
  }

  socketClosed(taskId: string): void {
    const instance = this.instances.get(taskId);
    if (instance) {
      instance.sockets = Math.max(0, instance.sockets - 1);
      instance.lastUsed = this.now();
    }
  }

  /** Start (or reuse) the instance for a session and wait until it answers. */
  ensure(taskId: string, folder: string): Promise<number> {
    const running = this.instances.get(taskId);
    if (running && running.folder === folder) {
      running.lastUsed = this.now();
      return Promise.resolve(running.port);
    }
    const pending = this.starting.get(taskId);
    if (pending) return pending;
    const start = this.start(taskId, folder).finally(() => this.starting.delete(taskId));
    this.starting.set(taskId, start);
    return start;
  }

  private async start(taskId: string, folder: string): Promise<number> {
    const binary = this.binary;
    if (!binary) throw new Error("code-server não está instalado no servidor.");
    if (this.instances.has(taskId)) this.stop(taskId);
    this.evictForRoom();
    mkdirSync(join(this.options.dataDir, "vscode"), { recursive: true });
    const port = await freePort();
    const child = Bun.spawn(codeServerArgs(binary, port, this.options.dataDir, folder, taskId), {
      cwd: folder,
      env: codeServerEnv(agentProcessEnv(), folder),
      stdout: "ignore",
      stderr: "pipe",
    });
    const instance: Instance = {
      port,
      folder,
      pid: child.pid,
      lastUsed: this.now(),
      sockets: 0,
      exited: child.exited.then(() => {
        if (this.instances.get(taskId) === instance) this.instances.delete(taskId);
      }),
    };
    this.instances.set(taskId, instance);
    this.startReaper();
    const stderr = tailOf(child.stderr);
    try {
      await this.waitReady(port, child.exited);
    } catch (err) {
      this.stop(taskId);
      await Bun.sleep(200);
      const tail = stderr().trim();
      if (tail) console.warn(`[vscode] ${taskId}: ${tail.split("\n").slice(-3).join(" | ")}`);
      throw err;
    }
    return port;
  }

  private async waitReady(port: number, exited: Promise<number>): Promise<void> {
    const deadline = this.now() + (this.options.readyTimeoutMs ?? 30_000);
    let dead = false;
    void exited.then(() => {
      dead = true;
    });
    while (this.now() < deadline && !dead) {
      const ok = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(1_000),
      })
        .then((res) => res.ok)
        .catch(() => false);
      if (ok) return;
      await Bun.sleep(250);
    }
    throw new Error(
      dead ? "code-server encerrou ao iniciar." : "code-server não respondeu a tempo."
    );
  }

  private evictForRoom(): void {
    const max = this.options.maxInstances ?? 3;
    while (this.instances.size >= max) {
      const [oldest] = [...this.instances.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
      if (!oldest) return;
      this.stop(oldest[0]);
    }
  }

  stop(taskId: string): void {
    const instance = this.instances.get(taskId);
    if (!instance) return;
    this.instances.delete(taskId);
    void killProcessTree(instance.pid);
  }

  /** Stop instances nobody used for `idleMs` and that have no open socket. */
  reapIdle(): void {
    const idleMs = this.options.idleMs ?? 30 * 60_000;
    for (const [taskId, instance] of this.instances) {
      if (instance.sockets === 0 && this.now() - instance.lastUsed > idleMs) this.stop(taskId);
    }
  }

  private startReaper(): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.reapIdle(), 60_000);
    this.reaper.unref?.();
  }

  stopAll(): void {
    for (const taskId of [...this.instances.keys()]) this.stop(taskId);
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }
}
