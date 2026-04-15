import type { AgentEvent } from "../engine";

/**
 * Wraps an AgentEvent generator with periodic "still running" heartbeat events.
 *
 * A heartbeat is emitted whenever no events arrive within `intervalMs` milliseconds.
 * This keeps the executor's inactivity monitor alive for engines that have silent
 * periods (e.g., waiting on a long LLM call) while genuinely still running.
 *
 * Extracts the pattern originally implemented only in OpenCodeEngine so that
 * Aider, ClaudeCode, and Gemini benefit from the same behaviour.
 */
export async function* withHeartbeat(
  source: AsyncGenerator<AgentEvent>,
  intervalMs: number,
  signal?: AbortSignal
): AsyncGenerator<AgentEvent> {
  const startedAt = Date.now();

  // Events produced by the source are pushed into this queue so that the
  // main yield loop can drain them while still emitting heartbeats.
  const pending: Array<AgentEvent | null> = []; // null = end-of-stream sentinel
  let resolveWaiting: (() => void) | null = null;

  const notify = () => {
    const r = resolveWaiting;
    resolveWaiting = null;
    r?.();
  };

  // Background: drain source → queue
  const drainTask = (async () => {
    try {
      for await (const event of source) {
        if (signal?.aborted) break;
        pending.push(event);
        notify();
      }
    } finally {
      pending.push(null); // sentinel
      notify();
    }
  })();

  let done = false;

  while (!done && !signal?.aborted) {
    // Drain any events that arrived since last iteration
    while (pending.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: length checked above
      const item = pending.shift()!;
      if (item === null) {
        done = true;
        break;
      }
      yield item;
    }

    if (done || signal?.aborted) break;

    // Wait up to intervalMs for the next event to arrive
    await new Promise<void>((resolve) => {
      resolveWaiting = resolve;
      const timer = setTimeout(() => {
        if (resolveWaiting === resolve) {
          resolveWaiting = null;
          resolve();
        }
      }, intervalMs);

      // If signal fires, wake up immediately
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        if (resolveWaiting === resolve) {
          resolveWaiting = null;
          resolve();
        }
      });
    });

    // If we woke up because of a timeout (not a new event), emit heartbeat
    if (pending.length === 0 && !done && !signal?.aborted) {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      const mins = Math.floor(secs / 60);
      const s = secs % 60;
      const elapsed = mins > 0 ? `${mins}m ${s}s` : `${s}s`;
      yield { type: "log", stream: "system", content: `  Still running... ${elapsed}` };
    }
  }

  await drainTask.catch(() => {});
}

/** Read `VIBE_CODE_HEARTBEAT_MS` with default 30 s. */
export function getHeartbeatIntervalMs(): number {
  const raw = Number(process.env.VIBE_CODE_HEARTBEAT_MS);
  return raw > 0 ? raw : 30_000;
}
