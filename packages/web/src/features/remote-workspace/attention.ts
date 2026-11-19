// Presence-aware attention policy (idea from Paseo's agent-attention-policy, Apache-2.0).
import type { SessionStatus } from "./model";

export interface AttentionEvent {
  sessionId: string;
  status: Exclude<SessionStatus, "working">;
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

export function attentionMessage(status: AttentionEvent["status"]): string {
  if (status === "failed") return "precisa de atenção";
  if (status === "review") return "terminou e está pronta para revisão";
  return "terminou e aguarda sua mensagem";
}
