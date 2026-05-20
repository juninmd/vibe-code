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

function MetricCard({
  label,
  value,
  tone = "text-zinc-100",
  extra,
}: {
  label: string;
  value: string | number;
  tone?: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-zinc-800/60 bg-zinc-900/30 p-3.5 transition-all duration-300 hover:border-zinc-700/50 hover:bg-zinc-900/55 hover:shadow-[0_4px_16px_rgba(0,0,0,0.3)]">
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <p className={`text-lg font-bold font-mono tracking-tight tabular-nums ${tone}`}>
            {value}
          </p>
          <p className="text-[9px] uppercase font-bold tracking-widest text-zinc-500 mt-1 truncate">
            {label}
          </p>
        </div>
        {extra && <div className="shrink-0">{extra}</div>}
      </div>
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

  // LED compute slots
  const maxSlots = runtime.capacity.maxAgents || 4;
  const activeSlots = runtime.capacity.activeAgents || 0;
  const slots = Array.from({ length: maxSlots }, (_, i) => i < activeSlots);
  const capacityExtra = (
    <div className="grid grid-cols-4 gap-1 self-center">
      {slots.slice(0, 12).map((isActive, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: slot indicators are purely positional
          key={`slot-${index}`}
          className={`h-2 w-2 rounded-full transition-all duration-500 ${
            isActive
              ? "bg-gradient-to-tr from-cyan-400 to-emerald-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] animate-pulse"
              : "bg-zinc-800 border border-zinc-700/30"
          }`}
          title={isActive ? "Slot de agente ativo" : "Slot ocioso"}
        />
      ))}
    </div>
  );

  // Engines pulse
  const enginesExtra = (
    <div className="h-6 w-6 flex items-center justify-center rounded-full bg-emerald-950/20 border border-emerald-800/30 text-emerald-400">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
    </div>
  );

  // Radial success rate gauge
  const radius = 15;
  const strokeWidth = 3;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (successRate / 100) * circumference;
  const successExtra = (
    <div className="relative h-9 w-9 shrink-0">
      <svg className="h-full w-full transform -rotate-90" role="img" aria-label="Taxa de sucesso">
        <title>Taxa de sucesso</title>
        <circle
          cx="18"
          cy="18"
          r={radius}
          className="stroke-zinc-800/80"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx="18"
          cy="18"
          r={radius}
          className={`transition-all duration-1000 ${
            successRate >= 80
              ? "stroke-emerald-400"
              : successRate >= 50
                ? "stroke-amber-400"
                : "stroke-red-400"
          }`}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="transparent"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-zinc-300 font-mono">
        {successRate}%
      </div>
    </div>
  );

  // Failed alert extra
  const failedExtra = (
    <div
      className={`h-6 w-6 flex items-center justify-center rounded-full text-[10px] ${
        runtime.workload.failedTasks > 0
          ? "bg-red-950/40 border border-red-800/40 text-red-400 animate-bounce"
          : "bg-zinc-800/40 border border-zinc-700/40 text-zinc-500"
      }`}
    >
      ⚠️
    </div>
  );

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-zinc-950/30 backdrop-blur-sm shadow-2xl transition-all duration-300 hover:border-zinc-700/60 hover:shadow-[0_8px_30px_rgba(0,0,0,0.4)] ${
        runtime.status === "healthy"
          ? "border-l-4 border-l-emerald-500/80"
          : runtime.status === "degraded"
            ? "border-l-4 border-l-amber-500/80"
            : "border-l-4 border-l-blue-500/80"
      }`}
    >
      {/* Background glow card hover */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-zinc-900/10 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800/70 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              <span
                className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  runtime.status === "healthy"
                    ? "bg-emerald-400"
                    : runtime.status === "degraded"
                      ? "bg-amber-400"
                      : "bg-blue-400"
                }`}
              />
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  runtime.status === "healthy"
                    ? "bg-emerald-500"
                    : runtime.status === "degraded"
                      ? "bg-amber-500"
                      : "bg-blue-500"
                }`}
              />
            </span>
            <h3 className="text-sm font-semibold text-zinc-100 tracking-tight">{runtime.name}</h3>
            <span
              className={`rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${meta.background} ${meta.border} ${meta.color}`}
            >
              {meta.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-zinc-500 font-medium">
            {runtime.platform} · {runtime.cpuCount} CPUs · uptime{" "}
            <span className="text-zinc-400">{formatDuration(runtime.uptimeSecs)}</span>
          </p>
        </div>
        <div className="text-right text-[10px] font-mono text-zinc-500 shrink-0 space-y-0.5">
          <p className="text-zinc-400">
            visto:{" "}
            <span className="font-semibold text-zinc-300">
              {formatLastSeen(runtime.lastSeenAt)}
            </span>
          </p>
          <p className="text-[9px] text-zinc-600">ID: {runtime.id}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 p-5">
        <MetricCard
          label="capacidade"
          value={`${runtime.capacity.activeAgents}/${runtime.capacity.maxAgents}`}
          tone={capacityPct >= 100 ? "text-blue-400" : "text-zinc-100"}
          extra={capacityExtra}
        />
        <MetricCard
          label="engines online"
          value={`${runtime.capacity.availableEngines}/${runtime.capacity.totalEngines}`}
          tone={runtime.capacity.availableEngines > 0 ? "text-emerald-400" : "text-amber-400"}
          extra={enginesExtra}
        />
        <MetricCard
          label="taxa de sucesso"
          value={`${successRate}%`}
          tone={
            successRate >= 70 || runtime.workload.totalRuns === 0
              ? "text-emerald-400"
              : "text-amber-400"
          }
          extra={successExtra}
        />
        <MetricCard
          label="falhas registradas"
          value={runtime.workload.failedTasks}
          tone={runtime.workload.failedTasks > 0 ? "text-red-400" : "text-zinc-400"}
          extra={failedExtra}
        />
      </div>

      <div className="px-5 pb-5">
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs font-semibold text-zinc-500">
            <span className="uppercase tracking-widest text-[9px]">Uso de Slots de Execução</span>
            <span className="font-mono text-zinc-300">{capacityPct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-zinc-900 border border-zinc-800/50 overflow-hidden p-[1px]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-blue-500 transition-all duration-700 shadow-[0_0_12px_rgba(52,211,153,0.4)]"
              style={{ width: `${Math.min(capacityPct, 100)}%` }}
            />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 p-4 transition-all hover:bg-zinc-900/30">
            <p className="text-[9px] uppercase font-bold tracking-widest text-zinc-500 mb-3">
              Engines Disponíveis
            </p>
            <div className="space-y-2">
              {runtime.engines.map((engine) => (
                <div
                  key={engine.name}
                  className="flex items-center justify-between gap-3 text-xs border-b border-zinc-900/40 pb-1.5 last:border-0 last:pb-0"
                >
                  <span className="font-medium text-zinc-300 truncate">{engine.displayName}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {engine.activeRuns > 0 && (
                      <span className="bg-cyan-950/40 border border-cyan-800/40 px-1.5 py-0.5 rounded text-[9px] text-cyan-400 font-mono font-semibold animate-pulse">
                        {engine.activeRuns} active
                      </span>
                    )}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        engine.available
                          ? "bg-emerald-950/20 text-emerald-400 border border-emerald-800/30"
                          : "bg-zinc-900 text-zinc-600 border border-zinc-800/35"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${engine.available ? "bg-emerald-400 animate-pulse" : "bg-zinc-700"}`}
                      />
                      {engine.available ? "online" : "ausente"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/20 p-4 transition-all hover:bg-zinc-900/30">
            <p className="text-[9px] uppercase font-bold tracking-widest text-zinc-500 mb-3">
              Métricas Operacionais
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
              <dt className="text-zinc-500 font-medium">Tarefas Ativas</dt>
              <dd className="text-right font-semibold text-zinc-300 font-mono">
                {runtime.workload.totalTasks}
              </dd>
              <dt className="text-zinc-500 font-medium">Em Execução</dt>
              <dd className="text-right font-semibold text-zinc-300 font-mono flex items-center justify-end gap-1.5">
                {runtime.workload.runningTasks > 0 && (
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-ping" />
                )}
                {runtime.workload.runningTasks}
              </dd>
              <dt className="text-zinc-500 font-medium">Total de Execuções</dt>
              <dd className="text-right font-semibold text-zinc-300 font-mono">
                {runtime.workload.totalRuns}
              </dd>
              <dt className="text-zinc-500 font-medium">Última Execução</dt>
              <dd className="text-right font-semibold text-zinc-400">
                {formatLastSeen(runtime.workload.lastRunAt)}
              </dd>
            </dl>
            <div className="mt-3.5 border-t border-zinc-900/60 pt-2.5 flex items-center justify-between text-[9px] text-zinc-600">
              <span className="uppercase font-semibold tracking-wider">Diretório:</span>
              <span className="truncate font-mono max-w-[200px]" title={runtime.dataDir}>
                {runtime.dataDir}
              </span>
            </div>
          </div>
        </div>

        {((runtime.activeRunDetails?.length ?? 0) > 0 || (runtime.retryQueue?.length ?? 0) > 0) && (
          <div className="grid gap-3 md:grid-cols-2 mt-3.5">
            {(runtime.activeRunDetails?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-cyan-950 bg-cyan-950/10 p-4 transition-all">
                <p className="text-[9px] uppercase font-bold tracking-widest text-cyan-400/80 mb-3 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-500"></span>
                  </span>
                  Execuções em Andamento
                </p>
                <div className="space-y-2">
                  {runtime.activeRunDetails.map((r) => (
                    <div
                      key={r.runId}
                      className="flex items-center justify-between gap-3 text-xs bg-cyan-950/20 border border-cyan-900/30 px-3 py-2 rounded-lg"
                    >
                      <span className="font-mono text-zinc-400 font-semibold">
                        {r.taskId.slice(0, 8)}
                      </span>
                      <span className="text-zinc-300 font-medium">{r.engineName}</span>
                      {r.phase && (
                        <span className="shrink-0 font-bold bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded text-[9px] uppercase tracking-wider">
                          {r.phase}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(runtime.retryQueue?.length ?? 0) > 0 && (
              <div className="rounded-xl border border-amber-950 bg-amber-950/10 p-4 transition-all">
                <p className="text-[9px] uppercase font-bold tracking-widest text-amber-500/80 mb-3 flex items-center gap-1.5">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
                  </span>
                  Fila de Retentativas
                </p>
                <div className="space-y-2">
                  {runtime.retryQueue.map((r) => (
                    <div
                      key={r.taskId}
                      className="flex items-center justify-between gap-3 text-xs bg-amber-950/20 border border-amber-900/30 px-3 py-2 rounded-lg"
                    >
                      <span className="font-mono text-zinc-400 font-semibold">
                        {r.taskId.slice(0, 8)}
                      </span>
                      <span className="bg-amber-900/40 text-amber-300 border border-amber-800/40 px-1.5 py-0.5 rounded text-[9px] font-bold">
                        tentativa #{r.attempt}
                      </span>
                      <span className="shrink-0 text-zinc-500 font-mono text-[9px]">
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
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshCountdown, setRefreshCountdown] = useState(10);

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
    if (open) {
      loadRuntimes();
      setRefreshCountdown(10);
    }
  }, [open, loadRuntimes]);

  useEffect(() => {
    if (!open || !autoRefresh) return;
    const interval = setInterval(() => {
      setRefreshCountdown((prev) => {
        if (prev <= 1) {
          loadRuntimes();
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [open, autoRefresh, loadRuntimes]);

  return (
    <Dialog open={open} onClose={onClose} title="Runtimes de Computação" size="5xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-zinc-900/20 border border-zinc-800/50 rounded-xl p-4">
          <div>
            <h4 className="text-xs font-semibold text-zinc-300 uppercase tracking-wider">
              Compute Local
            </h4>
            <p className="text-[11px] text-zinc-500 mt-1">
              Capacidade de agentes paralelos, motores ativos de execução e telemetria de workloads
              em tempo real.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-8 h-4 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-emerald-600 peer-checked:after:bg-emerald-100 peer-checked:after:border-emerald-500" />
              </div>
              <span className="text-xs text-zinc-400 font-medium">
                Auto-refresh {autoRefresh && `(${refreshCountdown}s)`}
              </span>
            </label>

            <button
              type="button"
              onClick={loadRuntimes}
              disabled={loading}
              className="rounded-lg border border-zinc-700 bg-zinc-800/40 px-3.5 py-1.5 text-xs font-medium text-zinc-300 transition-all hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-800/40 bg-red-950/20 px-4 py-3 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading && runtimes.length === 0 ? (
          <div className="space-y-4">
            <div className="h-44 rounded-2xl bg-zinc-900/40 border border-zinc-850/50 animate-pulse" />
            <div className="h-44 rounded-2xl bg-zinc-900/40 border border-zinc-850/50 animate-pulse" />
          </div>
        ) : runtimes.length === 0 ? (
          <div className="rounded-2xl border border-zinc-800/60 bg-zinc-950/20 py-16 text-center text-sm text-zinc-500 font-medium">
            Nenhum runtime registrado ou ativo no painel.
          </div>
        ) : (
          <div className="max-h-[64vh] overflow-y-auto pr-1 space-y-4">
            {runtimes.map((runtime) => (
              <RuntimeCard key={runtime.id} runtime={runtime} />
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
