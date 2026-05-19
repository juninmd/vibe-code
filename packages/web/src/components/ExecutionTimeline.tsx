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
      <header className="space-y-3 border-b border-white/5 bg-black/20 px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-wider text-primary">
            EXECUTION TIMELINE
          </h3>
          <span
            className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
              isRunning
                ? "border-info/25 bg-info/10 text-info"
                : "border-white/10 bg-white/[0.03] text-dimmed"
            }`}
          >
            {isRunning ? "Running" : "Run history"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-dimmed">Phase</div>
            <div className="mt-1 truncate text-xs font-semibold text-primary">
              {currentStatus ?? "No phase recorded"}
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-dimmed">Run</div>
            <div className="mt-1 truncate text-xs font-semibold text-primary">
              {runId ? runId.slice(0, 8) : "No run"}
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-dimmed">Tokens</div>
            <div className="mt-1 truncate text-xs font-semibold text-primary">
              {costStats ? formatTokens(costStats.total_tokens) : "Not recorded"}
            </div>
          </div>
          <div className="rounded-lg border border-white/5 bg-white/[0.025] px-3 py-2">
            <div className="text-[9px] uppercase tracking-[0.14em] text-dimmed">Cost</div>
            <div className="mt-1 truncate text-xs font-semibold text-primary">
              {formatMicros(costStats?.total ?? costStats?.input)}
            </div>
          </div>
        </div>
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
