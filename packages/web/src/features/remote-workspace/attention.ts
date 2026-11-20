// Presence-aware attention policy (idea from Paseo's agent-attention-policy, Apache-2.0).
import type { SessionStatus } from "./model";

export interface AttentionEvent {
  sessionId: string;
  /** "approval": a supervised session paused for the operator. */
  status: Exclude<SessionStatus, "working"> | "approval";
}
export type AttentionChannel = "none" | "in-app" | "system";

/** Sessions that left "working" since the last snapshot: the agent finished or needs you. */
export function finishedSessions(
  previous: ReadonlyMap<string, SessionStatus>,
  sessions: ReadonlyArray<{ id: string; status: SessionStatus }>
): AttentionEvent[] {
  return sessions.flatMap((session) =>
    previous.get(session.id) === "working" && session.status !== "working"
      ? [{ sessionId: session.id, status: session.status }]
      : []
  );
}

/**
 * Looking at the session already: nothing. App in front but elsewhere: in-app notice.
 * App hidden or unfocused: a system notification, when the browser allows it.
 */
export function attentionChannel(input: {
  sessionId: string;
  viewingSessionId: string | null;
  visible: boolean;
  focused: boolean;
  systemAllowed: boolean;
}): AttentionChannel {
  const present = input.visible && input.focused;
  if (present && input.viewingSessionId === input.sessionId) return "none";
  if (present || !input.systemAllowed) return "in-app";
  return "system";
}

/** Sessions that started waiting for an approval since the last snapshot. */
export function newlyAwaiting(
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>
): AttentionEvent[] {
  return [...current]
    .filter((id) => !previous.has(id))
    .map((sessionId) => ({ sessionId, status: "approval" }));
}

export function attentionMessage(status: AttentionEvent["status"]): string {
  if (status === "approval") return "precisa da sua aprovação para continuar";
  if (status === "failed") return "precisa de atenção";
  if (status === "review") return "terminou e está pronta para revisão";
  return "terminou e aguarda sua mensagem";
}

/** Drops ids of sessions that left the list (archived or deleted); same set when nothing left. */
export function keepKnown(
  ids: ReadonlySet<string>,
  sessions: { id: string }[]
): ReadonlySet<string> {
  const known = new Set(sessions.map((s) => s.id));
  const kept = [...ids].filter((id) => known.has(id));
  return kept.length === ids.size ? ids : new Set(kept);
}
