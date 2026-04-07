import type { StatsResponse } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";

interface StatsDialogProps {
  open: boolean;
  onClose: () => void;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div
      className="px-4 py-3 rounded-xl border"
      style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
    >
      <p className="text-2xl font-bold tracking-tight" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
      <p className="text-xs font-medium mt-0.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      {sub && (
        <p className="text-[10px] mt-0.5" style={{ color: "var(--text-dimmed)" }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      className="w-full h-2 rounded-full overflow-hidden"
      style={{ background: "var(--border-default)" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

export function StatsDialog({ open, onClose }: StatsDialogProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.stats
      .get()
      .then(setStats)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open]);

  const o = stats?.overview;
  const maxTasksByRepo = Math.max(...(stats?.tasksByRepo?.map((r) => r.total) ?? [1]));
  const maxRunsByEngine = Math.max(...(stats?.runsByEngine?.map((e) => e.runs) ?? [1]));
  const maxRunsByModel = Math.max(...(stats?.runsByModel?.map((m) => m.runs) ?? [1]));

  return (
    <Dialog open={open} onClose={onClose} title="Statistics">
      {loading ? (
        <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          Loading statistics...
        </div>
      ) : !stats ? (
        <div className="py-12 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          No data available
        </div>
      ) : (
        <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1 custom-scrollbar">
          {/* Overview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Repositories" value={o?.totalRepos ?? 0} />
            <StatCard label="Tasks" value={o?.totalTasks ?? 0} />
            <StatCard label="Agent Runs" value={o?.totalRuns ?? 0} />
            <StatCard label="Success Rate" value={`${o?.successRate ?? 0}%`} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Avg Duration" value={formatDuration(o?.avgRunDurationSecs ?? 0)} />
            <StatCard
              label="PRs Created"
              value={o?.totalPRsCreated ?? 0}
              sub={`${o?.totalPRsMerged ?? 0} merged`}
            />
            <StatCard label="Favorite Engine" value={stats.favoriteEngine ?? "—"} />
          </div>

          {/* Tasks by Status */}
          {stats.tasksByStatus.length > 0 && (
            <div>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Tasks by Status
              </h3>
              <div className="flex flex-wrap gap-2">
                {stats.tasksByStatus.map((s) => (
                  <div
                    key={s.status}
                    className="px-3 py-1.5 rounded-lg border text-xs"
                    style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
                  >
                    <span
                      className="font-medium capitalize"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {s.count}
                    </span>{" "}
                    <span style={{ color: "var(--text-muted)" }}>{s.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasks per Repo */}
          {stats.tasksByRepo.length > 0 && (
            <div>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Tasks per Repository
              </h3>
              <div className="space-y-2">
                {stats.tasksByRepo.slice(0, 10).map((r) => (
                  <div key={r.repoId}>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-xs truncate flex-1 pr-2"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {r.repoName}
                      </span>
                      <span
                        className="text-xs tabular-nums shrink-0"
                        style={{ color: "var(--text-muted)" }}
                      >
                        {r.done}/{r.total}
                        {r.failed > 0 && (
                          <span style={{ color: "var(--danger)" }}> ({r.failed} failed)</span>
                        )}
                      </span>
                    </div>
                    <MiniBar value={r.done} max={maxTasksByRepo} color="var(--success)" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Engine Usage */}
          {stats.runsByEngine.length > 0 && (
            <div>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Engine Usage
              </h3>
              <div className="space-y-2">
                {stats.runsByEngine.map((e) => (
                  <div key={e.engine}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                        {e.engine}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {e.runs} runs · {formatDuration(e.avgDurationSecs)} avg
                      </span>
                    </div>
                    <MiniBar value={e.runs} max={maxRunsByEngine} color="var(--accent)" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Model Popularity */}
          {stats.runsByModel.length > 0 && (
            <div>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Model Usage
              </h3>
              <div className="space-y-2">
                {stats.runsByModel.slice(0, 8).map((m) => (
                  <div key={m.model}>
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className="text-xs truncate flex-1 pr-2"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {m.model}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {m.runs} runs
                      </span>
                    </div>
                    <MiniBar value={m.runs} max={maxRunsByModel} color="var(--info)" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Daily Activity (simple text-based viz) */}
          {stats.dailyActivity.length > 0 && (
            <div>
              <h3
                className="text-xs font-semibold uppercase tracking-wider mb-3"
                style={{ color: "var(--text-muted)" }}
              >
                Activity (Last 30 Days)
              </h3>
              <div className="flex items-end gap-px h-16">
                {stats.dailyActivity.map((d) => {
                  const maxDay = Math.max(...stats.dailyActivity.map((x) => x.runs));
                  const pct = maxDay > 0 ? (d.runs / maxDay) * 100 : 0;
                  return (
                    <div
                      key={d.date}
                      className="flex-1 rounded-t-sm transition-all hover:opacity-80"
                      style={{
                        height: `${Math.max(pct, 4)}%`,
                        background: d.failed > d.completed ? "var(--danger)" : "var(--accent)",
                        opacity: 0.7 + (pct / 100) * 0.3,
                      }}
                      title={`${d.date}: ${d.runs} runs (${d.completed} ok, ${d.failed} failed)`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between mt-1">
                <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
                  {stats.dailyActivity[0]?.date}
                </span>
                <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
                  {stats.dailyActivity[stats.dailyActivity.length - 1]?.date}
                </span>
              </div>
            </div>
          )}

          {/* Favorite Model */}
          {stats.favoriteModel && (
            <div
              className="text-xs pt-2 border-t"
              style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
            >
              Favorite model:{" "}
              <span style={{ color: "var(--accent-text)" }}>{stats.favoriteModel}</span>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
