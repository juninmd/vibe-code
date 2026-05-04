import type { WsClientMessage } from "@vibe-code/shared";
import { useCallback, useEffect, useRef } from "react";

interface UseTerminalSessionOptions {
  taskId: string;
  runId: string | null;
  onWsSend?: (message: WsClientMessage) => void;
}

export function useTerminalSession({ taskId, runId, onWsSend }: UseTerminalSessionOptions) {
  const reconnectAttemptRef = useRef(0);

  useEffect(() => {
    if (!onWsSend) return;

    reconnectAttemptRef.current += 1;
    console.info("[terminal] INFO: terminal session reconnect attempt", {
      taskId,
      runId,
      attempt: reconnectAttemptRef.current,
    });

    onWsSend({
      type: "terminal_open",
      taskId,
      runId: runId ?? undefined,
      version: "v2",
    });

    return () => {
      onWsSend({ type: "terminal_close", taskId, version: "v2" });
    };
  }, [onWsSend, runId, taskId]);

  const sendInput = useCallback(
    (input: string) => {
      onWsSend?.({ type: "terminal_input", taskId, input, version: "v2" });
    },
    [onWsSend, taskId]
  );

  const sendSignal = useCallback(
    (signal: "sigint" | "sigterm" | "sighup") => {
      onWsSend?.({ type: "terminal_signal", taskId, signal, version: "v2" });
    },
    [onWsSend, taskId]
  );

  const close = useCallback(() => {
    onWsSend?.({ type: "terminal_close", taskId, version: "v2" });
  }, [onWsSend, taskId]);

  return {
    sendInput,
    sendSignal,
    close,
  };
}
