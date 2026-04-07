import type { Subprocess } from "bun";
import type { AgentEvent } from "./engine";

type SpawnedProc = Subprocess<"pipe", "pipe", "pipe">;

function splitBufferedLines(buffer: string): { lines: string[]; rest: string } {
  // Progress renderers (npm/pnpm) often update the same line using \r.
  // Treat both \n and \r as line breaks so UI receives live progress events.
  const normalized = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const parts = normalized.split("\n");
  return {
    lines: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? "",
  };
}

/**
 * Streams stdout and stderr from a subprocess in parallel,
 * yielding AgentEvents as they arrive. Handles abort signals properly.
 */
export async function* streamProcess(
  proc: SpawnedProc,
  parseLine: (line: string) => AgentEvent[],
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const eventQueue: AgentEvent[] = [];
  const waiting: { resolve: (() => void) | null } = { resolve: null };
  let stdoutDone = false;
  let stderrDone = false;
  let aborted = false;

  const wake = () => {
    if (waiting.resolve) {
      waiting.resolve();
      waiting.resolve = null;
    }
  };

  const push = (event: AgentEvent) => {
    eventQueue.push(event);
    wake();
  };

  if (signal) {
    signal.addEventListener("abort", () => {
      aborted = true;
      proc.kill();
      wake();
    });
  }

  // Stream stderr in parallel
  const stderrTask = (async () => {
    const reader = proc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = splitBufferedLines(buffer);
        buffer = rest;
        for (const line of lines) {
          if (line.trim()) {
            push({ type: "log", stream: "stderr", content: line });
          }
        }
      }
      if (buffer.trim()) {
        push({ type: "log", stream: "stderr", content: buffer });
      }
    } finally {
      reader.releaseLock();
      stderrDone = true;
      wake();
    }
  })();

  // Stream stdout in parallel
  const stdoutTask = (async () => {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { lines, rest } = splitBufferedLines(buffer);
        buffer = rest;
        for (const line of lines) {
          if (!line.trim()) continue;
          for (const event of parseLine(line)) {
            push(event);
          }
        }
      }
      if (buffer.trim()) {
        for (const event of parseLine(buffer)) {
          push(event);
        }
      }
    } finally {
      reader.releaseLock();
      stdoutDone = true;
      wake();
    }
  })();

  // Yield events as they arrive from either stream
  while (true) {
    while (eventQueue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      yield eventQueue.shift()!;
    }
    if (stdoutDone && stderrDone && eventQueue.length === 0) break;
    if (aborted) break;

    await new Promise<void>((r) => {
      waiting.resolve = r;
    });
  }

  await Promise.all([stdoutTask, stderrTask]);
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    yield { type: "log", stream: "stderr", content: `[process] Exited with code ${exitCode}` };
  }
  yield { type: "complete", exitCode: exitCode ?? 0 };
}
