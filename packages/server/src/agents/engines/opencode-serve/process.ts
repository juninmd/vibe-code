import { randomBytes } from "node:crypto";
import type { Subprocess } from "bun";

export interface ServeHandle {
  url: string;
  /** Basic auth header for the per-run password; nothing else on the host can drive the server. */
  authorization: string;
  exited: Promise<number>;
  close(): void;
}

export interface StartServeOptions {
  binary: string;
  cwd: string;
  env: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Test seam: spawn a fake server. */
  spawn?: (args: string[], cwd: string, env: Record<string, string | undefined>) => Subprocess;
}

/** Starts the server a turn talks to: a local process, or a runner pod. */
export type ServeStarter = (options: StartServeOptions) => Promise<ServeHandle>;

const LISTENING = /listening on (https?:\/\/\S+)/;

/** Asks the OS for a free port; `opencode serve --port 0` falls back to 4096 instead. */
export function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = probe.port;
  probe.stop(true);
  return port;
}

export function basicAuth(password: string): string {
  return `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
}

/** Starts `opencode serve` bound to loopback with a random password and waits until it listens. */
export async function startOpencodeServe(options: StartServeOptions): Promise<ServeHandle> {
  const password = randomBytes(24).toString("base64url");
  const args = [options.binary, "serve", "--hostname", "127.0.0.1", "--port", String(freePort())];
  const env = { ...options.env, OPENCODE_SERVER_PASSWORD: password };
  const proc = options.spawn
    ? options.spawn(args, options.cwd, env)
    : Bun.spawn(args, { cwd: options.cwd, env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const close = () => {
    try {
      proc.kill();
    } catch {
      // Already gone.
    }
  };
  try {
    const stderr = drainTail(proc.stderr as ReadableStream<Uint8Array> | undefined);
    const url = await waitForUrl(proc, options.timeoutMs ?? 30_000, stderr);
    return { url, authorization: basicAuth(password), exited: proc.exited, close };
  } catch (error) {
    close();
    throw error;
  }
}

/** Keeps the last few KB of stderr so a failed start can say why. */
function drainTail(stream: ReadableStream<Uint8Array> | undefined): () => string {
  let tail = "";
  if (stream) {
    void (async () => {
      const decoder = new TextDecoder();
      try {
        for await (const chunk of stream) tail = (tail + decoder.decode(chunk)).slice(-2000);
      } catch {
        // Closed with the process.
      }
    })();
  }
  return () => tail.trim();
}

async function waitForUrl(
  proc: Subprocess,
  timeoutMs: number,
  stderr: () => string
): Promise<string> {
  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`opencode serve did not start within ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  const read = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done)
        throw new Error(
          `opencode serve exited before listening: ${(stderr() || seen).slice(-300)}`
        );
      seen += decoder.decode(value, { stream: true });
      const match = LISTENING.exec(seen);
      if (match) return match[1];
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
    // Keep draining so a chatty server never blocks on a full pipe.
    void (async () => {
      try {
        for (;;) if ((await reader.read()).done) break;
      } catch {
        // Closed with the process.
      }
    })();
  }
}
