import type { RuntimeOverview } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";

interface RuntimeDashboardProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_META: Record<
  RuntimeOverview["status"],
  { label: string; color: string; background: string; border: string }
> = {
  healthy: {
    label: "saudavel",
    color: "text-emerald-300",
    background: "bg-emerald-950/25",
    border: "border-emerald-800/40",
  },
  degraded: {
    label: "degradado",
    color: "text-amber-300",
    background: "bg-amber-950/25",
    border: "border-amber-800/40",
  },
  saturated: {
    label: "saturado",
    color: "text-blue-300",
    background: "bg-blue-950/25",
    border: "border-blue-800/40",
  },
};

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

function formatLastSeen(value: string | null): string {
  if (!value) return "sem execucoes";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atras`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atras`;
  return `${Math.floor(diff / 86_400_000)}d atras`;
}

function Metric({
  label,
  value,
  tone = "text-zinc-100",
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/50 px-3 py-2.5">
      <p className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-zinc-600 mt-0.5">{label}</p>
    </div>
  );
}

function RuntimeCard({ runtime }: { runtime: RuntimeOverview }) {
  const meta = STATUS_META[runtime.status];
  const capacityPct =
    runtime.capacity.maxAgents > 0
      ? Math.round((runtime.capacity.activeAgents / runtime.capacity.maxAgents) * 100)
      : 0;
  const successRate =
    runtime.workload.totalRuns > 0
      ? Math.round((runtime.workload.completedRuns / runtime.workload.totalRuns) * 100)
      : 0;

  return (
    <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 overflow-hidden">
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800/70 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <h3 className="text-sm font-semibold text-zinc-100 truncate">{runtime.name}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.background} ${meta.border} ${meta.color}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 truncate">
            {runtime.platform} · {runtime.cpuCount} CPUs · uptime{" "}
            {formatDuration(runtime.uptimeSecs)}
          </p>
        </div>
        <div className="text-right text-[10px] text-zinc-600 shrink-0">
          <p>visto {formatLastSeen(runtime.lastSeenAt)}</p>
          <p className="mt-0.5">id {runtime.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-4">
        <Metric
          label="capacidade"
          value={`${runtime.capacity.activeAgents}/${runtime.capacity.maxAgents}`}
          tone={capacityPct >= 100 ? "text-blue-300" : "text-zinc-100"}
        />
        <Metric
          label="engines"
          value={`${runtime.capacity.availableEngines}/${runtime.capacity.totalEngines}`}
          tone={runtime.capacity.availableEngines > 0 ? "text-emerald-300" : "text-amber-300"}
        />
        <Metric
          label="sucesso"
          value={`${successRate}%`}
          tone={
            successRate >= 70 || runtime.workload.totalRuns === 0
              ? "text-emerald-300"
              : "text-amber-300"
          }
        />
        <Metric
          label="falhas"
          value={runtime.workload.failedTasks}
          tone={runtime.workload.failedTasks > 0 ? "text-red-300" : "text-zinc-100"}
        />
      </div>

      <div className="px-4 pb-4">
        <div className="mb-3">
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-zinc-600">
            <span>slots de execucao</span>
            <span>{capacityPct}%</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-blue-400 transition-all"
              style={{ width: `${Math.min(capacityPct, 100)}%` }}
            />
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2">
          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">
              Engines no runtime
            </p>
            <div className="space-y-1.5">
              {runtime.engines.map((engine) => (
                <div
                  key={engine.name}
                  className="flex items-center justify-between gap-2 text-xs text-zinc-400"
                >
                  <span className="truncate">{engine.displayName}</span>
                  <span
                    className={`shrink-0 ${engine.available ? "text-emerald-300" : "text-zinc-600"}`}
                  >
                    {engine.available ? "online" : "ausente"}
                    {engine.activeRuns > 0 ? ` · ${engine.activeRuns}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">Workload</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-zinc-600">tarefas</dt>
              <dd className="text-right text-zinc-300">{runtime.workload.totalTasks}</dd>
              <dt className="text-zinc-600">rodando</dt>
              <dd className="text-right text-zinc-300">{runtime.workload.runningTasks}</dd>
              <dt className="text-zinc-600">execucoes</dt>
              <dd className="text-right text-zinc-300">{runtime.workload.totalRuns}</dd>
              <dt className="text-zinc-600">ultima run</dt>
              <dd className="text-right text-zinc-300">
                {formatLastSeen(runtime.workload.lastRunAt)}
              </dd>
            </dl>
            <p className="mt-2 truncate text-[10px] text-zinc-700" title={runtime.dataDir}>
              dados: {runtime.dataDir}
            </p>
          </div>
        </div>

        {((runtime.activeRunDetails?.length ?? 0) > 0 || (runtime.retryQueue?.length ?? 0) > 0) && (
          <div className="grid gap-2 md:grid-cols-2 mt-2 px-4 pb-4">
            {(runtime.activeRunDetails?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-zinc-800/70 bg-zinc-900/40 p-3">
                <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-2">
                  Runs ativos
                </p>
                <div className="space-y-1.5">
                  {runtime.activeRunDetails.map((r) => (
                    <div
                      key={r.runId}
                      className="flex items-center justify-between gap-2 text-xs text-zinc-400"
                    >
                      <span className="font-mono text-zinc-600">{r.taskId.slice(0, 8)}</span>
                      <span className="truncate">{r.engineName}</span>
                      {r.phase && (
                        <span className="shrink-0 text-cyan-400 text-[10px]">{r.phase}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(runtime.retryQueue?.length ?? 0) > 0 && (
              <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-3">
                <p className="text-[10px] uppercase tracking-wider text-amber-700 mb-2">
                  Fila de retry
                </p>
                <div className="space-y-1.5">
                  {runtime.retryQueue.map((r) => (
                    <div
                      key={r.taskId}
                      className="flex items-center justify-between gap-2 text-xs text-zinc-400"
                    >
                      <span className="font-mono text-zinc-600">{r.taskId.slice(0, 8)}</span>
                      <span className="text-amber-400 text-[10px]">tentativa #{r.attempt}</span>
                      <span className="shrink-0 text-zinc-500 text-[10px]">
                        em {Math.ceil(r.dueInMs / 1000)}s
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function RuntimeDashboard({ open, onClose }: RuntimeDashboardProps) {
  const [runtimes, setRuntimes] = useState<RuntimeOverview[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuntimes = useCallback(() => {
    setLoading(true);
    setError(null);
    api.runtimes
      .list()
      .then(setRuntimes)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadRuntimes();
  }, [open, loadRuntimes]);

  return (
    <Dialog open={open} onClose={onClose} title="Runtimes" size="5xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Compute local inspirado no Multica: capacidade, engines, workload e sinais de saude.
          </p>
          <button
            type="button"
            onClick={loadRuntimes}
            disabled={loading}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading && runtimes.length === 0 ? (
          <div className="space-y-3">
            <div className="h-36 rounded-xl bg-zinc-900/60 animate-pulse" />
            <div className="h-36 rounded-xl bg-zinc-900/60 animate-pulse" />
          </div>
        ) : runtimes.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 py-12 text-center text-sm text-zinc-600">
            Nenhum runtime registrado.
          </div>
        ) : (
          <div className="max-h-[68vh] overflow-y-auto pr-1 space-y-3">
            {runtimes.map((runtime) => (
              <RuntimeCard key={runtime.id} runtime={runtime} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
