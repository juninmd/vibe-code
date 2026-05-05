import type { AgentLog } from "@vibe-code/shared";
import { AgentOutput } from "./AgentOutput";

interface ExecutionTimelineProps {
  taskId: string;
  runId: string | null;
  logs: AgentLog[];
  isRunning: boolean;
  currentStatus: string | null;
  costStats: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cached?: number;
    input?: number;
  } | null;
  onSendInput: (taskId: string, input: string) => void;
}

export function ExecutionTimeline({
  taskId,
  runId,
  logs,
  isRunning,
  currentStatus,
  costStats,
  onSendInput,
}: ExecutionTimelineProps) {
  return (
    <section className="flex flex-col h-full min-h-0">
      <header className="px-3 py-2 border-b border-white/5 bg-black/20">
        <h3 className="text-[10px] font-semibold tracking-wider text-primary">
          EXECUTION TIMELINE
        </h3>
      </header>
      <div className="flex-1 min-h-0 p-3">
        <AgentOutput
          runId={runId}
          liveLogs={logs}
          isRunning={isRunning}
          onSendInput={(input) => onSendInput(taskId, input)}
          fullHeight
          currentStatus={currentStatus}
          costStats={costStats}
        />
      </div>
    </section>
  );
}
