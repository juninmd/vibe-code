import type { EngineEffectiveness, SkillEffectiveness, StatsResponse } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

interface StatsDialogProps {
  open: boolean;
  onClose: () => void;
}

type NavSection = "overview" | "engines" | "tasks" | "activity" | "skills";

const NAV_ITEMS: { id: NavSection; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "◈" },
  { id: "engines", label: "AI Engines", icon: "⚙" },
  { id: "tasks", label: "Task Metrics", icon: "☰" },
  { id: "activity", label: "Activity", icon: "▦" },
  { id: "skills", label: "Skill ROI", icon: "⚡" },
];

function useCountUp(target: number, enabled: boolean, duration = 800): number {
  const [value, setValue] = useState(0);
  const frameRef = useRef<number>(0);
  useEffect(() => {
    if (!enabled) {
      setValue(0);
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - progress) ** 4;
      setValue(Math.round(eased * target));
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, enabled, duration]);
  return value;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] mb-4 text-accent/80 ml-1">
      {children}
    </h3>
  );
}

function StatCard({
  label,
  value,
  sub,
  highlight,
  color,
  animated = false,
}: {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  color?: string;
  animated?: boolean;
}) {
  const numericValue = typeof value === "number" ? value : 0;
  const counted = useCountUp(numericValue, animated && typeof value === "number", 1000);
  const display = animated && typeof value === "number" ? counted : value;

  return (
    <div
      className={`p-5 rounded-3xl border transition-all duration-300 ${
        highlight
          ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
          : "bg-surface/30 border-white/5 hover:border-white/10"
      }`}
    >
      <p
        className="text-3xl font-black tracking-tighter tabular-nums text-primary"
        style={{ color }}
      >
        {display}
      </p>
      <p className="text-[10px] font-black uppercase tracking-widest mt-1 text-muted">{label}</p>
      {sub && (
        <p className="text-[10px] font-bold mt-2 text-dimmed bg-white/5 inline-block px-2 py-0.5 rounded-full">
          {sub}
        </p>
      )}
    </div>
  );
}

function ProgressBar({
  value,
  max,
  color,
  secondaryValue,
  secondaryColor,
}: {
  value: number;
  max: number;
  color: string;
  secondaryValue?: number;
  secondaryColor?: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const secPct = max > 0 && secondaryValue ? Math.min((secondaryValue / max) * 100, 100) : 0;
  return (
    <div className="w-full h-2 rounded-full overflow-hidden bg-white/5">
      {secondaryValue !== undefined ? (
        <div className="flex h-full">
          <div
            className="h-full transition-all duration-700 ease-out shadow-[0_0_8px_currentColor]"
            style={{ width: `${pct}%`, background: color, color }}
          />
          <div
            className="h-full transition-all duration-700 ease-out"
            style={{ width: `${secPct}%`, background: secondaryColor ?? "#f87171" }}
          />
        </div>
      ) : (
        <div
          className="h-full rounded-full transition-all duration-700 ease-out shadow-[0_0_8px_currentColor]"
          style={{ width: `${pct}%`, background: color, color }}
        />
      )}
    </div>
  );
}

function formatDuration(secs: number): string {
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
}

function OverviewSection({ stats, ready }: { stats: StatsResponse; ready: boolean }) {
  const o = stats.overview;
  const failRate = o.totalRuns > 0 ? Math.round((o.failedRuns / o.totalRuns) * 100) : 0;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <SectionTitle>Global Summary</SectionTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Repositories" value={o.totalRepos} animated={ready} />
          <StatCard label="Active Tasks" value={o.totalTasks} animated={ready} />
          <StatCard
            label="Total Executions"
            value={o.totalRuns}
            animated={ready}
            sub={`${o.failedRuns} issues`}
          />
          <StatCard
            label="Success Rate"
            value={`${o.successRate}%`}
            color="var(--success)"
            animated={ready}
            highlight
          />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <SectionTitle>Engine Performance</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Avg Duration" value={formatDuration(o.avgRunDurationSecs)} />
            <StatCard
              label="Pull Requests"
              value={o.totalPRsCreated}
              animated={ready}
              sub={`${o.totalPRsMerged} merged`}
            />
          </div>
        </div>

        <div className="space-y-6">
          <SectionTitle>Success vs Failure</SectionTitle>
          <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5">
            <div className="flex justify-between items-end mb-4">
              <div className="space-y-1">
                <p className="text-2xl font-black text-primary tracking-tighter">
                  {o.totalRuns - o.failedRuns}
                </p>
                <p className="text-[10px] font-black uppercase tracking-widest text-success">
                  Successful
                </p>
              </div>
              <div className="text-right space-y-1">
                <p className="text-2xl font-black text-primary tracking-tighter">{o.failedRuns}</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-danger">
                  Failed
                </p>
              </div>
            </div>
            <div className="h-4 rounded-full overflow-hidden flex bg-white/5 p-1">
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out shadow-[0_0_15px_rgba(34,211,238,0.4)]"
                style={{
                  width: `${100 - failRate}%`,
                  background: "linear-gradient(90deg, #4ade80, #22d3ee)",
                }}
              />
              <div
                className="h-full rounded-full transition-all duration-1000 ease-out ml-1"
                style={{ width: `${failRate}%`, background: "#f87171" }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div>
          <SectionTitle>Top Engine</SectionTitle>
          <div className="p-5 rounded-3xl bg-accent/5 border border-accent/20 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center text-2xl shadow-xl shadow-accent/20">
              ◈
            </div>
            <div>
              <p className="text-lg font-black text-primary tracking-tight leading-none">
                {stats.favoriteEngine ?? "None"}
              </p>
              <p className="text-[10px] font-black uppercase tracking-widest text-accent mt-1 opacity-70">
                Most Effective Agent
              </p>
            </div>
          </div>
        </div>
        <div>
          <SectionTitle>Top Model</SectionTitle>
          <div className="p-5 rounded-3xl bg-blue-500/5 border border-blue-500/20 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center text-2xl shadow-xl shadow-blue-500/20">
              ◇
            </div>
            <div className="min-w-0">
              <p className="text-lg font-black text-primary tracking-tight leading-none truncate">
                {stats.favoriteModel?.split("/").pop() ?? "None"}
              </p>
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 mt-1 opacity-70">
                Highest Success Rate
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EnginesSection({
  stats,
  engineStats,
}: {
  stats: StatsResponse;
  engineStats: EngineEffectiveness[];
}) {
  const maxRuns = Math.max(...stats.runsByEngine.map((e) => e.runs), 1);
  const maxModel = Math.max(...stats.runsByModel.map((m) => m.runs), 1);

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-6">
          <SectionTitle>Engine Distribution</SectionTitle>
          <div className="space-y-4">
            {stats.runsByEngine.map((e) => {
              const successPct = e.runs > 0 ? Math.round((e.completed / e.runs) * 100) : 0;
              const successColor =
                successPct >= 70
                  ? "var(--success)"
                  : successPct >= 40
                    ? "var(--warning)"
                    : "var(--danger)";

              return (
                <div
                  key={e.engine}
                  className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black tracking-tight text-primary">
                      {e.engine}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted tabular-nums">
                      {e.runs} runs · {formatDuration(e.avgDurationSecs)} avg
                    </span>
                  </div>
                  <ProgressBar value={e.runs} max={maxRuns} color="var(--accent)" />
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar
                        value={e.completed}
                        max={e.runs}
                        color="var(--success)"
                        secondaryValue={e.failed}
                        secondaryColor="var(--danger)"
                      />
                    </div>
                    <span
                      className="text-[10px] font-black uppercase tracking-widest shrink-0"
                      style={{ color: successColor }}
                    >
                      {successPct}% ok
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-6">
          <SectionTitle>Model Popularity</SectionTitle>
          <div className="p-6 rounded-3xl bg-white/[0.02] border border-white/5 space-y-5">
            {stats.runsByModel.length === 0 ? (
              <p className="text-[10px] font-black uppercase tracking-widest text-dimmed text-center py-4">
                No data
              </p>
            ) : (
              stats.runsByModel.slice(0, 8).map((m) => (
                <div key={m.model} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-secondary truncate pr-4">
                      {m.model.split("/").pop()}
                    </span>
                    <span className="text-[10px] font-black tracking-widest text-muted">
                      {m.runs}
                    </span>
                  </div>
                  <ProgressBar value={m.runs} max={maxModel} color="var(--info)" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {engineStats.length > 0 && (
        <div className="space-y-4">
          <SectionTitle>Effectiveness Ranking</SectionTitle>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {engineStats.map((e) => (
              <div key={e.engine} className="p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <span className="text-xs font-black uppercase tracking-widest text-primary block mb-3">
                  {e.engine}
                </span>
                <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                  <div className="p-2 rounded-xl bg-black/20 border border-white/5">
                    <span className="text-muted block mb-1">Success</span>
                    <span className="text-success">{e.successRate}%</span>
                  </div>
                  <div className="p-2 rounded-xl bg-black/20 border border-white/5">
                    <span className="text-muted block mb-1">Avg Time</span>
                    <span className="text-primary">{formatDuration(e.avgDurationSecs)}</span>
                  </div>
                  <div className="col-span-2 p-2 rounded-xl bg-black/20 border border-info/20">
                    <span className="text-info/70 block mb-1">PR Creation Rate</span>
                    <span className="text-info text-xs">{Math.round(e.prRate * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TasksSection({ stats }: { stats: StatsResponse }) {
  const STATUS_COLORS: Record<string, string> = {
    done: "var(--success)",
    in_progress: "var(--info)",
    review: "#a78bfa",
    failed: "var(--danger)",
    backlog: "var(--text-muted)",
    scheduled: "var(--warning)",
  };

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {stats.tasksByStatus.length > 0 && (
        <div className="space-y-4">
          <SectionTitle>Pipeline Distribution</SectionTitle>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {stats.tasksByStatus.map((s) => (
              <div
                key={s.status}
                className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 flex items-center justify-between"
              >
                <span
                  className="text-[10px] font-black uppercase tracking-widest"
                  style={{ color: STATUS_COLORS[s.status] ?? "var(--text-muted)" }}
                >
                  {s.status.replace("_", " ")}
                </span>
                <span className="text-lg font-black tabular-nums text-primary">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {stats.tasksByRepo.length > 0 && (
        <div className="space-y-4">
          <SectionTitle>Repository Completion Rates</SectionTitle>
          <div className="grid md:grid-cols-2 gap-4">
            {stats.tasksByRepo.slice(0, 10).map((r) => {
              const completionPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
              const failedPct = r.total > 0 ? Math.round((r.failed / r.total) * 100) : 0;

              return (
                <div
                  key={r.repoId}
                  className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-black tracking-tight text-primary truncate flex-1">
                      {r.repoName}
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                      {r.done}/{r.total} <span className="text-success">({completionPct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden flex bg-white/5">
                    <div
                      className="h-full transition-all duration-500 bg-success shadow-[0_0_8px_var(--success)]"
                      style={{ width: `${completionPct}%` }}
                    />
                    <div
                      className="h-full transition-all duration-500 bg-danger"
                      style={{ width: `${failedPct}%` }}
                    />
                  </div>
                  {r.failed > 0 && (
                    <p className="text-[9px] font-bold text-danger text-right">
                      {r.failed} failures
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivitySection({ stats }: { stats: StatsResponse }) {
  const maxDay = useMemo(
    () => Math.max(...stats.dailyActivity.map((d) => d.runs), 1),
    [stats.dailyActivity]
  );

  if (stats.dailyActivity.length === 0) {
    return (
      <div className="py-20 text-center opacity-30 space-y-3">
        <p className="text-5xl">▦</p>
        <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
          No activity in the last 30 days
        </p>
      </div>
    );
  }

  const totalInPeriod = stats.dailyActivity.reduce((a, d) => a + d.runs, 0);
  const failedInPeriod = stats.dailyActivity.reduce((a, d) => a + d.failed, 0);
  const successInPeriod = stats.dailyActivity.reduce((a, d) => a + d.completed, 0);

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="space-y-6">
        <SectionTitle>30-Day Operation Volume</SectionTitle>
        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 text-center">
            <p className="text-2xl font-black text-primary">{totalInPeriod}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-muted mt-1">
              Total Runs
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-success/5 border border-success/20 text-center">
            <p className="text-2xl font-black text-success">{successInPeriod}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-success/70 mt-1">
              Successful
            </p>
          </div>
          <div className="p-4 rounded-2xl bg-danger/5 border border-danger/20 text-center">
            <p className="text-2xl font-black text-danger">{failedInPeriod}</p>
            <p className="text-[9px] font-black uppercase tracking-widest text-danger/70 mt-1">
              Failed
            </p>
          </div>
        </div>

        <div className="p-6 rounded-[2rem] bg-black/40 border border-white/5">
          <div className="flex items-end gap-1 h-32">
            {stats.dailyActivity.map((d) => {
              const pct = (d.runs / maxDay) * 100;
              const isBad = d.failed > d.completed;
              return (
                <div
                  key={d.date}
                  className="flex-1 rounded-t-sm transition-all hover:opacity-100 opacity-60 hover:scale-x-110"
                  style={{
                    height: `${Math.max(pct, 4)}%`,
                    background: isBad ? "var(--danger)" : "var(--accent)",
                  }}
                  title={`${d.date}: ${d.runs} runs (${d.completed} ok, ${d.failed} falhas)`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-4">
            <span className="text-[10px] font-bold text-dimmed">
              {stats.dailyActivity[0]?.date}
            </span>
            <span className="text-[10px] font-bold text-dimmed">
              {stats.dailyActivity[stats.dailyActivity.length - 1]?.date}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <SectionTitle>Intensity Heatmap</SectionTitle>
        <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 flex flex-col items-center">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {stats.dailyActivity.map((d) => {
              const intensity = maxDay > 0 ? d.runs / maxDay : 0;
              const isBad = d.failed > d.completed && d.runs > 0;
              return (
                <div
                  key={d.date}
                  className="w-4 h-4 rounded-sm transition-all hover:scale-125"
                  style={{
                    background:
                      d.runs === 0
                        ? "var(--border-default)"
                        : isBad
                          ? `rgba(248, 113, 113, ${0.3 + intensity * 0.7})`
                          : `rgba(124, 58, 237, ${0.3 + intensity * 0.7})`,
                  }}
                  title={`${d.date}: ${d.runs} runs`}
                />
              );
            })}
          </div>
          <div className="flex items-center gap-3 mt-6">
            <span className="text-[9px] font-black uppercase tracking-widest text-dimmed">Low</span>
            <div className="flex gap-1">
              {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
                <div
                  key={v}
                  className="w-3 h-3 rounded-sm"
                  style={{ background: `rgba(124, 58, 237, ${v})` }}
                />
              ))}
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-dimmed">
              High
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkillsSection({ skills }: { skills: SkillEffectiveness[] }) {
  if (skills.length === 0) {
    return (
      <div className="py-20 text-center opacity-30 space-y-3">
        <p className="text-5xl">⚡</p>
        <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
          No skill metrics available
        </p>
        <p className="text-xs text-dimmed">Metrics appear after runs with evaluations enabled</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SectionTitle>Skill Effectiveness ROI</SectionTitle>
      <div className="grid md:grid-cols-2 gap-4">
        {skills.map((s) => (
          <div
            key={s.name}
            className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-black tracking-tight text-primary">{s.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-[9px] font-black uppercase tracking-widest text-muted bg-white/5 px-2 py-0.5 rounded-lg">
                  {s.totalRuns} runs
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[10px] font-bold">
                <span className="text-muted">Success Rate</span>
                <span
                  style={{
                    color:
                      s.successRate >= 70
                        ? "var(--success)"
                        : s.successRate >= 40
                          ? "var(--warning)"
                          : "var(--danger)",
                  }}
                >
                  {s.successRate}%
                </span>
              </div>
              <ProgressBar value={s.successRate} max={100} color="var(--success)" />
            </div>

            {(s.avgBlockers > 0 || s.avgWarnings > 0) && (
              <div className="flex gap-2 pt-2 border-t border-white/5">
                {s.avgBlockers > 0 && (
                  <span className="text-[9px] font-bold text-danger bg-danger/10 px-2 py-0.5 rounded-md">
                    {s.avgBlockers.toFixed(1)} blockers/run
                  </span>
                )}
                {s.avgWarnings > 0 && (
                  <span className="text-[9px] font-bold text-warning bg-warning/10 px-2 py-0.5 rounded-md">
                    {s.avgWarnings.toFixed(1)} warnings/run
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsDialog({ open, onClose }: StatsDialogProps) {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [skillStats, setSkillStats] = useState<SkillEffectiveness[]>([]);
  const [engineStats, setEngineStats] = useState<EngineEffectiveness[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<NavSection>("overview");
  const [animationsReady, setAnimationsReady] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.stats.get(),
      api.stats.skills().catch(() => [] as SkillEffectiveness[]),
      api.stats.engines().catch(() => [] as EngineEffectiveness[]),
    ])
      .then(([s, sk, eng]) => {
        setStats(s);
        setSkillStats(sk);
        setEngineStats(eng);
        setTimeout(() => setAnimationsReady(true), 100);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) {
      setAnimationsReady(false);
      return;
    }
    loadData();
  }, [open, loadData]);

  return (
    <Dialog open={open} onClose={onClose} title="Operational Intelligence" size="5xl">
      <div className="flex h-[75vh] -mx-8 -mb-8 mt-4 overflow-hidden border-t border-white/5">
        {/* Modern Sidebar Nav */}
        <nav className="w-60 shrink-0 border-r border-white/5 bg-white/[0.01] flex flex-col p-4 gap-1">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active-shrink cursor-pointer ${
                activeSection === item.id
                  ? "bg-accent text-white shadow-lg shadow-accent/25"
                  : "text-muted hover:text-primary hover:bg-white/5"
              }`}
            >
              <span className="text-lg opacity-70">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="flex-1" />
          {stats && !loading && (
            <button
              type="button"
              onClick={() => exportStatsJson(stats, skillStats, engineStats)}
              className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-dimmed hover:text-primary hover:bg-white/5 transition-all active-shrink cursor-pointer"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <title>Export</title>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
              Export JSON
            </button>
          )}
        </nav>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-10 custom-scrollbar bg-black/20">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-white/5" />
              <div className="space-y-2 text-center">
                <div className="h-4 w-32 bg-white/5 rounded-full mx-auto" />
                <div className="h-3 w-48 bg-white/5 rounded-full mx-auto" />
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full gap-6 text-center max-w-sm mx-auto">
              <div className="w-16 h-16 rounded-3xl bg-danger/10 flex items-center justify-center text-danger shadow-xl shadow-danger/10">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <title>Error</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-black text-primary tracking-tight">Sync Failure</p>
                <p className="text-sm text-muted leading-relaxed">{error}</p>
              </div>
              <Button variant="primary" onClick={loadData} className="rounded-xl h-10 px-6">
                Retry Sync
              </Button>
            </div>
          ) : stats ? (
            <div className="max-w-4xl mx-auto pb-10">
              {activeSection === "overview" && (
                <OverviewSection stats={stats} ready={animationsReady} />
              )}
              {activeSection === "engines" && (
                <EnginesSection stats={stats} engineStats={engineStats} />
              )}
              {activeSection === "tasks" && <TasksSection stats={stats} />}
              {activeSection === "activity" && <ActivitySection stats={stats} />}
              {activeSection === "skills" && <SkillsSection skills={skillStats} />}
            </div>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}

function exportStatsJson(
  stats: StatsResponse,
  skillStats: SkillEffectiveness[],
  engineStats: EngineEffectiveness[]
) {
  const payload = { exportedAt: new Date().toISOString(), stats, skillStats, engineStats };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vibe-code-stats-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
