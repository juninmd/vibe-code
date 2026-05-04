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

  useEffect(() => {
    const output = outputRef.current;
    if (!output) return;
    output.scrollTop = output.scrollHeight;
  });

  return (
    <section className="flex flex-col h-full min-h-0">
      <header className="px-3 py-2 border-b border-white/5 flex items-center justify-between bg-black/20">
        <h3 className="text-[10px] font-semibold tracking-wider text-primary">TERMINAL SESSION</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] text-dimmed hover:text-secondary"
            onClick={() => {
              sendSignal("sigint");
            }}
          >
            Ctrl+C
          </button>
          <button
            type="button"
            className="text-[10px] text-dimmed hover:text-secondary"
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
        className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-[11px] bg-black text-green-300 whitespace-pre-wrap break-words"
      >
        {mergedOutput || "Terminal aguardando sessao..."}
      </div>

      <form
        className="border-t border-white/5 bg-black/80 p-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = input;
          if (!value.trim()) return;
          sendInput(`${value}\n`);
          setInput("");
        }}
      >
        <label className="flex items-center gap-2 text-green-300 font-mono text-[11px]">
          <span>$</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="flex-1 bg-transparent text-green-200 placeholder:text-green-800/70 outline-none"
            placeholder="Digite comando ou resposta..."
          />
        </label>
      </form>
    </section>
  );
}
