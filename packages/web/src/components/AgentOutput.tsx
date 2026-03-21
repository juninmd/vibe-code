import { useEffect, useRef, useState } from "react";
import type { AgentLog } from "@vibe-code/shared";
import { api } from "../api/client";

interface AgentOutputProps {
  runId: string | null;
  liveLogs: AgentLog[];
}

export function AgentOutput({ runId, liveLogs }: AgentOutputProps) {
  const [historicLogs, setHistoricLogs] = useState<AgentLog[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
      default: return "text-zinc-300";
    }
  };

  return (
    <div
      ref={scrollRef}
      className="bg-zinc-950 rounded-lg border border-zinc-800 p-3 font-mono text-xs overflow-y-auto max-h-[400px] space-y-0.5"
    >
      {allLogs.map((log, i) => (
        <div key={log.id ?? `live-${i}`} className={streamColor(log.stream)}>
          <span className="text-zinc-700 select-none">
            {new Date(log.timestamp).toLocaleTimeString()}{" "}
          </span>
          {log.content}
        </div>
      ))}
      {allLogs.length === 0 && (
        <div className="text-zinc-700">Waiting for output...</div>
      )}
    </div>
  );
}
