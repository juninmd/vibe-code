import { useCallback, useEffect, useRef } from "react";

export function useBrowserNotifications() {
  const permitted = useRef(false);

  useEffect(() => {
    if (!("Notification" in window)) return;
    if (Notification.permission === "granted") {
      permitted.current = true;
    } else if (Notification.permission !== "denied") {
      // Request silently on first use — browser may block until user gesture
      Notification.requestPermission().then((p) => {
        permitted.current = p === "granted";
      });
    }
  }, []);

  const notify = useCallback((title: string, body?: string) => {
    if (!("Notification" in window) || !permitted.current) return;
    if (document.visibilityState === "visible") return; // only when tab is hidden
    try {
      const n = new Notification(title, {
        body,
        icon: "/favicon.ico",
        tag: "vibe-code",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // ignore — some browsers block in certain contexts
    }
  }, []);

  return { notify };
}
