import { useEffect, useRef, useState } from "react";
import {
  type AttentionEvent,
  attentionChannel,
  attentionMessage,
  finishedSessions,
  keepKnown,
  newlyAwaiting,
} from "./attention";
import type { Session, SessionStatus } from "./model";

export interface AttentionNotice {
  sessionId: string;
  title: string;
  text: string;
}

const NOTICE_MS = 8_000;
const supported = () => typeof window !== "undefined" && "Notification" in window;

export function useAttention(
  sessions: Session[],
  viewingSessionId: string | null,
  openSession: (id: string) => void,
  awaiting: ReadonlySet<string> = new Set()
) {
  const previous = useRef(new Map<string, SessionStatus>());
  const open = useRef(openSession);
  open.current = openSession;
  const viewing = useRef(viewingSessionId);
  viewing.current = viewingSessionId;
  const [unseen, setUnseen] = useState<ReadonlySet<string>>(new Set());
  const [notices, setNotices] = useState<AttentionNotice[]>([]);
  const [permission, setPermission] = useState(() =>
    supported() ? Notification.permission : "denied"
  );

  const latest = useRef(sessions);
  latest.current = sessions;
  const alert = useRef((events: AttentionEvent[]) => {
    for (const event of events) {
      const session = latest.current.find((s) => s.id === event.sessionId);
      if (!session) continue;
      const channel = attentionChannel({
        sessionId: event.sessionId,
        viewingSessionId: viewing.current,
        visible: document.visibilityState === "visible",
        focused: document.hasFocus(),
        systemAllowed: supported() && Notification.permission === "granted",
      });
      if (channel === "none") continue;
      setUnseen((all) => new Set(all).add(event.sessionId));
      const text = `A sessão ${attentionMessage(event.status)}.`;
      if (channel === "in-app") {
        setNotices((all) => [
          ...all.filter((n) => n.sessionId !== event.sessionId),
          { sessionId: event.sessionId, title: session.title, text },
        ]);
        continue;
      }
      try {
        const notification = new Notification(session.title, { body: text, tag: session.id });
        notification.onclick = () => {
          window.focus();
          open.current(event.sessionId);
          notification.close();
        };
      } catch {
        // Some mobile browsers only notify from a service worker; the unseen dot still shows.
      }
    }
  });

  useEffect(() => {
    const events = finishedSessions(previous.current, sessions);
    previous.current = new Map(sessions.map((s) => [s.id, s.status]));
    alert.current(events);
  }, [sessions]);

  const previousAwaiting = useRef<ReadonlySet<string>>(new Set());
  const awaitingKey = [...awaiting].sort().join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the set's contents.
  useEffect(() => {
    alert.current(newlyAwaiting(previousAwaiting.current, awaiting));
    previousAwaiting.current = new Set(awaiting);
  }, [awaitingKey]);

  // Archived or deleted sessions must not keep the dot, the notice or the title counter.
  useEffect(() => {
    setUnseen((all) => keepKnown(all, sessions));
    setNotices((all) => {
      const kept = keepKnown(new Set(all.map((n) => n.sessionId)), sessions);
      return kept.size === all.length ? all : all.filter((n) => kept.has(n.sessionId));
    });
  }, [sessions]);

  useEffect(() => {
    if (!viewingSessionId) return;
    setUnseen((all) => {
      if (!all.has(viewingSessionId)) return all;
      const next = new Set(all);
      next.delete(viewingSessionId);
      return next;
    });
    setNotices((all) => all.filter((n) => n.sessionId !== viewingSessionId));
  }, [viewingSessionId]);

  useEffect(() => {
    if (!notices.length) return;
    const timer = window.setTimeout(() => setNotices((all) => all.slice(1)), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notices]);

  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unseen.size ? `(${unseen.size}) ${base}` : base;
  }, [unseen]);

  const enableSystem = async () => {
    if (!supported()) return;
    setPermission(await Notification.requestPermission());
  };
  const dismiss = (sessionId: string) =>
    setNotices((all) => all.filter((n) => n.sessionId !== sessionId));

  return { unseen, notices, dismiss, permission, enableSystem };
}
