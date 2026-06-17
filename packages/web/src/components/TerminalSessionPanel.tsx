import type { WsClientMessage } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTerminalSession } from "../hooks/useTerminalSession";

interface TerminalChunk {
  id: number;
  runId: string | null;
  stream: "stdout" | "stderr";
  chunk: string;
  timestamp: string;
}

interface TerminalSessionPanelProps {
  taskId: string;
  runId: string | null;
  chunks: TerminalChunk[];
  onWsSend?: (message: WsClientMessage) => void;
}

export function TerminalSessionPanel({
  taskId,
  runId,
  chunks,
  onWsSend,
}: TerminalSessionPanelProps) {
  const [input, setInput] = useState("");
  const outputRef = useRef<HTMLDivElement>(null);
  const { close, sendInput, sendSignal } = useTerminalSession({ taskId, runId, onWsSend });
  const mergedOutput = useMemo(() => chunks.map((chunk) => chunk.chunk).join(""), [chunks]);
  const hasOutput = mergedOutput.trim().length > 0;
  const sessionState = runId ? (hasOutput ? "Live session" : "Waiting") : "No session";

  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    output.scrollTop = output.scrollHeight;
  });

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/5 bg-black/25">
      <header className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-[10px] font-semibold tracking-[0.18em] text-primary">
            TERMINAL SESSION
          </h3>
          <p className="mt-0.5 truncate text-[11px] text-dimmed">
            {runId ? `Run ${runId.slice(0, 8)}` : "No active run"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
              hasOutput
                ? "border-success/25 bg-success/10 text-success"
                : runId
                  ? "border-warning/25 bg-warning/10 text-warning"
                  : "border-white/10 bg-white/[0.03] text-dimmed"
            }`}
          >
            {sessionState}
          </span>
          <button
            type="button"
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-dimmed transition-colors hover:bg-white/10 hover:text-secondary"
            onClick={() => {
              sendSignal("sigint");
            }}
          >
            Ctrl+C
          </button>
          <button
            type="button"
            className="rounded-md border border-white/10 px-2 py-1 text-[10px] text-dimmed transition-colors hover:bg-white/10 hover:text-secondary"
            onClick={() => {
              close();
            }}
          >
            Close
          </button>
        </div>
      </header>

      <div
        ref={outputRef}
        className="flex-1 min-h-0 overflow-y-auto bg-[#070b08] px-4 py-3 font-mono text-[11px] text-green-300 whitespace-pre-wrap break-words"
      >
        {hasOutput ? (
          mergedOutput
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-sm rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-green-400/80">
                Terminal idle
              </div>
              <div className="mt-1 text-[11px] text-green-700/80">No output yet.</div>
            </div>
          </div>
        )}
      </div>

      <form
        className="border-t border-white/5 bg-black/80 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          const value = input;
          if (!value.trim()) return;
          sendInput(`${value}\n`);
          setInput("");
        }}
      >
        <label className="flex items-center gap-2 font-mono text-[11px] text-green-300">
          <span className="shrink-0 text-green-700">$</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="flex-1 bg-transparent text-green-200 outline-none placeholder:text-green-800/70"
            placeholder="Digite comando ou resposta..."
          />
        </label>
      </form>
    </section>
  );
}
