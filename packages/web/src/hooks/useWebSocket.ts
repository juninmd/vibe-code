import type { WsClientMessage, WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";

type MessageHandler = (msg: WsServerMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  /** Active task subscriptions that must be replayed after reconnect */
  const activeSubsRef = useRef<Set<string>>(new Set());
  /** Outbound queue for messages sent while disconnected */
  const queueRef = useRef<WsClientMessage[]>([]);

  /** Drain the outbound queue once the socket is open */
  function drainQueue(ws: WebSocket) {
    while (queueRef.current.length > 0) {
      const msg = queueRef.current.shift();
      if (msg) ws.send(JSON.stringify(msg));
    }
  }

  /** Replay all active subscriptions after reconnect */
  function replaySubscriptions(ws: WebSocket) {
    for (const taskId of activeSubsRef.current) {
      ws.send(JSON.stringify({ type: "subscribe", taskId }));
    }
  }

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let destroyed = false;
    // Track whether a heartbeat ack is pending
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let missedPongs = 0;

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
        missedPongs = 0;
        // Replay subscriptions so live logs resume transparently
        replaySubscriptions(ws);
        // Drain any messages queued while disconnected
        drainQueue(ws);
        // Start liveness heartbeat
        pingTimer = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          missedPongs++;
          if (missedPongs > 2) {
            // Half-open socket — force reconnect
            ws.close();
            return;
          }
          try {
            ws.send(JSON.stringify({ type: "ping" }));
          } catch {
            /* ignore */
          }
        }, 25000);
      };

      ws.onmessage = (evt) => {
        try {
          const msg: WsServerMessage = JSON.parse(evt.data);
          // Reset pong counter on any server-to-client message
          missedPongs = 0;
          onMessageRef.current(msg);
        } catch {
          // Malformed frame — ignore
        }
      };

      ws.onclose = (_evt) => {
        setConnected(false);
        wsRef.current = null;
        if (pingTimer) {
          clearInterval(pingTimer);
          pingTimer = null;
        }
        if (destroyed) return;
        // Exponential back-off: 1s, 2s, 4s … 30s
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
      if (pingTimer) clearInterval(pingTimer);
      wsRef.current?.close();
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: replaySubscriptions and drainQueue are stable functions defined once
  }, [replaySubscriptions, drainQueue]);

  const send = useCallback((msg: WsClientMessage) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      // Queue until reconnected (cap at 50 to avoid unbounded growth)
      if (queueRef.current.length < 50) queueRef.current.push(msg);
    }
  }, []);

  const subscribe = useCallback(
    (taskId: string) => {
      activeSubsRef.current.add(taskId);
      send({ type: "subscribe", taskId });
    },
    [send]
  );

  const unsubscribe = useCallback(
    (taskId: string) => {
      activeSubsRef.current.delete(taskId);
      send({ type: "unsubscribe", taskId });
    },
    [send]
  );

  return { connected, send, subscribe, unsubscribe };
}
