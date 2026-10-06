/**
 * Tiny pub/sub that carries raw terminal traffic from the WebSocket handler to
 * the xterm instance of a task. Terminal output is a high-frequency byte stream,
 * so it deliberately bypasses React state.
 */
export type TerminalBusEvent =
  | { kind: "opened"; runId: string | null; cols: number; rows: number }
  | { kind: "output"; chunk: string; replay: boolean }
  | { kind: "closed"; exitCode: number | null; reason: "exit" | "closed" };

type Listener = (event: TerminalBusEvent) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishTerminalEvent(taskId: string, event: TerminalBusEvent): void {
  const set = listeners.get(taskId);
  if (!set) return;
  for (const listener of [...set]) listener(event);
}

export function subscribeTerminal(taskId: string, listener: Listener): () => void {
  let set = listeners.get(taskId);
  if (!set) {
    set = new Set();
    listeners.set(taskId, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set?.size === 0) listeners.delete(taskId);
  };
}
