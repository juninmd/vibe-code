import type { WsClientMessage, WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type MessageHandler = (msg: WsServerMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = import.meta.env.DEV
        ? `${protocol}//${window.location.hostname}:3000/ws`
        : `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        attempts = 0;
      };

      ws.onmessage = (evt) => {
        try {
          const msg: WsServerMessage = JSON.parse(evt.data);
          onMessageRef.current(msg);
        } catch {
          // Invalid message
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (destroyed) return; // Explicit close — do not reconnect
        // Exponential backoff reconnect
        const delay = Math.min(1000 * 2 ** attempts, 30000);
        attempts++;
        reconnectTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      destroyed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: WsClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const subscribe = useCallback((taskId: string) => send({ type: "subscribe", taskId }), [send]);

  const unsubscribe = useCallback(
    (taskId: string) => send({ type: "unsubscribe", taskId }),
    [send]
  );

  return { connected, send, subscribe, unsubscribe };
}
