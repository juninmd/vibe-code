import type { WsServerMessage } from "@vibe-code/shared";
import { useCallback, useEffect } from "react";
import { publishTerminalEvent } from "./terminalBus";
import { useWebSocket } from "./useWebSocket";

/** Relays a terminal's WebSocket frames to the terminal bus and keeps it subscribed. */
export function useTerminalSocket(terminalId: string) {
  const onMessage = useCallback((message: WsServerMessage) => {
    if (message.type === "terminal_opened")
      publishTerminalEvent(message.taskId, {
        kind: "opened",
        runId: message.runId,
        cols: message.cols,
        rows: message.rows,
      });
    if (message.type === "terminal_output")
      publishTerminalEvent(message.taskId, {
        kind: "output",
        chunk: message.chunk,
        replay: message.replay === true,
      });
    if (message.type === "terminal_closed")
      publishTerminalEvent(message.taskId, {
        kind: "closed",
        exitCode: message.exitCode,
        reason: message.reason ?? "exit",
      });
  }, []);
  const socket = useWebSocket(onMessage);
  useEffect(() => {
    if (!terminalId) return;
    socket.subscribe(terminalId);
    return () => socket.unsubscribe(terminalId);
  }, [terminalId, socket.subscribe, socket.unsubscribe]);
  return socket;
}
