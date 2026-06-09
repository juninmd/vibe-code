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
    output?: number;
    total?: number;
  } | null;
  onSendInput: (taskId: string, input: string) => void;
}

function formatTokens(value: number | undefined) {
  return (value ?? 0).toLocaleString();
}

function formatMicros(value: number | undefined) {
  return value === undefined ? "Not reported" : `$${(value / 1_000_000).toFixed(6)}`;
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
      <header className="border-b border-white/5 bg-black/20 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[10px] font-semibold tracking-wider text-primary">AGENT OUTPUT</h3>
            <p className="mt-0.5 truncate text-[11px] text-dimmed">
              {currentStatus ?? (isRunning ? "Agent running" : "Run history")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                isRunning
                  ? "border-info/25 bg-info/10 text-info"
                  : "border-white/10 bg-white/[0.03] text-dimmed"
              }`}
            >
              {isRunning ? "Running" : "History"}
            </span>
            <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-dimmed">
              Run {runId ? runId.slice(0, 8) : "none"}
            </span>
            {costStats && (
              <span className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10px] text-dimmed">
                {formatTokens(costStats.total_tokens)} tokens /{" "}
                {formatMicros(costStats.total ?? costStats.input)}
              </span>
            )}
          </div>
        </div>
      </header>
      <div className="flex-1 min-h-0 p-2">
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
