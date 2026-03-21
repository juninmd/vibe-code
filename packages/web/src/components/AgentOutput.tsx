import { useEffect, useRef, useState } from "react";
import type { AgentLog } from "@vibe-code/shared";
import { api } from "../api/client";

interface AgentOutputProps {
  runId: string | null;
  liveLogs: AgentLog[];
  isRunning: boolean;
  onSendInput?: (input: string) => void;
}

export function AgentOutput({ runId, liveLogs, isRunning, onSendInput }: AgentOutputProps) {
  const [historicLogs, setHistoricLogs] = useState<AgentLog[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!runId) return;
    api.runs.logs(runId).then(setHistoricLogs).catch(console.error);
  }, [runId]);

  const allLogs = [...historicLogs, ...liveLogs];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allLogs.length]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !onSendInput) return;
    onSendInput(input);
    setInput("");
    inputRef.current?.focus();
  };

  if (!runId && liveLogs.length === 0) {
    return (
      <div className="text-center text-zinc-600 py-8 text-sm">
        No agent output yet
      </div>
    );
  }

  const streamColor = (stream: string) => {
    switch (stream) {
      case "stderr": return "text-red-400";
      case "system": return "text-zinc-500";
      case "stdin": return "text-emerald-400";
      default: return "text-zinc-300";
    }
  };

  const streamPrefix = (stream: string) => {
    if (stream === "stdin") return "$ ";
    return "";
  };

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 overflow-hidden">
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        className="bg-zinc-950 p-3 font-mono text-xs overflow-y-auto max-h-[400px] min-h-[120px] space-y-0.5 cursor-text"
      >
        {allLogs.map((log, i) => (
          <div key={log.id ?? `live-${i}`} className={streamColor(log.stream)}>
            <span className="text-zinc-700 select-none">
              {new Date(log.timestamp).toLocaleTimeString()}{" "}
            </span>
            {streamPrefix(log.stream)}
            {log.content}
          </div>
        ))}
        {allLogs.length === 0 && (
          <div className="text-zinc-700">Waiting for output...</div>
        )}
        {isRunning && (
          <div className="flex items-center gap-1 text-blue-400 mt-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span>Agent is running...</span>
          </div>
        )}
      </div>

      {isRunning && onSendInput && (
        <form onSubmit={handleSubmit} className="flex border-t border-zinc-800 bg-zinc-900">
          <span className="pl-3 py-2 text-xs font-mono text-emerald-500 select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type to send input to the agent..."
            className="flex-1 bg-transparent px-2 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
