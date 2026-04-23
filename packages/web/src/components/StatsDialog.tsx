import type { EngineEffectiveness, SkillEffectiveness, StatsResponse } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";

interface StatsDialogProps {
  open: boolean;
  onClose: () => void;
}

type NavSection = "overview" | "engines" | "tasks" | "activity" | "skills";

const NAV_ITEMS: { id: NavSection; label: string; icon: string }[] = [
  { id: "overview", label: "Visão General", icon: "◈" },
  { id: "engines", label: "Motores", icon: "⚙" },
  { id: "tasks", label: "Tasks", icon: "☰" },
  { id: "activity", label: "Atividade", icon: "▦" },
  { id: "skills", label: "Skills", icon: "⚡" },
];

// ─── Animated counter ────────────────────────────────────────────────────────

function useCountUp(target: number, enabled: boolean, duration = 600): number {
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
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(eased * target));
      if (progress < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, enabled, duration]);
  return value;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3
      className="text-[10px] font-semibold uppercase tracking-widest mb-3"
      style={{ color: "var(--text-muted)" }}
    >
      {children}
    </h3>
  );
}

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  highlight?: boolean;
  color?: string;
  animated?: boolean;
}

function StatCard({ label, value, sub, highlight, color, animated = false }: StatCardProps) {
  const numericValue = typeof value === "number" ? value : 0;
  const counted = useCountUp(numericValue, animated && typeof value === "number", 700);
  const display = animated && typeof value === "number" ? counted : value;
  return (
    <div
      className="px-4 py-3.5 rounded-xl border transition-colors"
      style={{
        background: highlight ? "var(--accent-muted, rgba(124,58,237,0.12))" : "var(--bg-card)",
        borderColor: highlight ? "var(--accent, #7c3aed)" : "var(--border-subtle)",
      }}
    >
      <p
        className="text-2xl font-bold tracking-tight tabular-nums"
        style={{
          color: color ?? (highlight ? "var(--accent-light, #c4b5fd)" : "var(--text-primary)"),
        }}
      >
        {display}
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

interface ProgressBarProps {
  value: number;
  max: number;
  color: string;
  secondaryValue?: number;
  secondaryColor?: string;
}

function ProgressBar({ value, max, color, secondaryValue, secondaryColor }: ProgressBarProps) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const secPct = max > 0 && secondaryValue ? Math.min((secondaryValue / max) * 100, 100) : 0;
  return (
    <div
      className="w-full h-1.5 rounded-full overflow-hidden"
      style={{ background: "var(--border-default, #27272a)" }}
    >
      {secondaryValue !== undefined ? (
        <div className="flex h-full">
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, background: color }}
          />
          <div
            className="h-full transition-all duration-500"
            style={{ width: `${secPct}%`, background: secondaryColor ?? "#f87171" }}
          />
        </div>
      ) : (
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, background: color }}
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

// ─── Section: Overview ───────────────────────────────────────────────────────

function OverviewSection({ stats, ready }: { stats: StatsResponse; ready: boolean }) {
  const o = stats.overview;
  const failRate = o.totalRuns > 0 ? Math.round((o.failedRuns / o.totalRuns) * 100) : 0;
  const successColor =
    o.successRate >= 70
      ? "var(--success, #4ade80)"
      : o.successRate >= 40
        ? "var(--warning, #facc15)"
        : "var(--danger, #f87171)";
  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Resumo</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Repositories" value={o.totalRepos} animated={ready} />
          <StatCard label="Tasks" value={o.totalTasks} animated={ready} />
          <StatCard
            label="Execuções"
            value={o.totalRuns}
            animated={ready}
            sub={o.failedRuns > 0 ? `${o.failedRuns} falhas` : undefined}
          />
          <StatCard label="Taxa de Sucesso" value={`${o.successRate}%`} color={successColor} />
        </div>
      </div>
      <div>
        <SectionTitle>Performance</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Duração Média" value={formatDuration(o.avgRunDurationSecs)} />
          <StatCard
            label="PRs Criados"
            value={o.totalPRsCreated}
            animated={ready}
            sub={o.totalPRsMerged > 0 ? `${o.totalPRsMerged} merged` : undefined}
          />
        </div>
      </div>
      {o.totalRuns > 0 && (
        <div>
          <SectionTitle>Execuções: Sucesso vs Falha</SectionTitle>
          <div
            className="flex justify-between text-xs mb-1.5"
            style={{ color: "var(--text-muted)" }}
          >
            <span style={{ color: "var(--success, #4ade80)" }}>
              ✓ {o.totalRuns - o.failedRuns} sucesso
            </span>
            <span style={{ color: "var(--danger, #f87171)" }}>
              ✗ {o.failedRuns} falha ({failRate}%)
            </span>
          </div>
          <div
            className="h-3 rounded-full overflow-hidden flex"
            style={{ background: "var(--border-default, #27272a)" }}
          >
            <div
              className="h-full transition-all duration-700"
              style={{
                width: `${100 - failRate}%`,
                background: "linear-gradient(90deg, var(--success, #4ade80), #22d3ee)",
              }}
            />
            <div
              className="h-full transition-all duration-700"
              style={{ width: `${failRate}%`, background: "var(--danger, #f87171)" }}
            />
          </div>
        </div>
      )}
      <div>
        <SectionTitle>Favoritos</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <div
            className="px-4 py-3 rounded-xl border"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              Engine favorito
            </p>
            <p className="text-sm font-semibold" style={{ color: "var(--accent-light, #c4b5fd)" }}>
              {stats.favoriteEngine ?? "—"}
            </p>
          </div>
          <div
            className="px-4 py-3 rounded-xl border"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
          >
            <p className="text-xs font-medium mb-1" style={{ color: "var(--text-muted)" }}>
              Modelo favorito
            </p>
            <p className="text-sm font-semibold truncate" style={{ color: "var(--info, #60a5fa)" }}>
              {stats.favoriteModel ?? "—"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Engines ────────────────────────────────────────────────────────

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
    <div className="space-y-6">
      <div>
        <SectionTitle>Uso por Motor</SectionTitle>
        <div className="space-y-3">
          {stats.runsByEngine.map((e) => {
            const successPct = e.runs > 0 ? Math.round((e.completed / e.runs) * 100) : 0;
            const successColor =
              successPct >= 70
                ? "var(--success, #4ade80)"
                : successPct >= 40
                  ? "var(--warning, #facc15)"
                  : "var(--danger, #f87171)";
            return (
              <div key={e.engine} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                    {e.engine}
                  </span>
                  <span className="text-[10px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                    {e.runs} runs · {formatDuration(e.avgDurationSecs)} avg
                  </span>
                </div>
                <ProgressBar value={e.runs} max={maxRuns} color="var(--accent, #7c3aed)" />
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <ProgressBar
                      value={e.completed}
                      max={e.runs}
                      color="var(--success, #4ade80)"
                      secondaryValue={e.failed}
                      secondaryColor="var(--danger, #f87171)"
                    />
                  </div>
                  <span
                    className="text-[10px] tabular-nums shrink-0 w-12 text-right"
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
      {engineStats.length > 0 && (
        <div>
          <SectionTitle>Efetividade (avaliação)</SectionTitle>
          <div className="space-y-2">
            {engineStats.map((e) => (
              <div
                key={e.engine}
                className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
              >
                <span style={{ color: "var(--text-primary)" }}>{e.engine}</span>
                <div
                  className="flex items-center gap-3 tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  <span>{e.successRate}%</span>
                  <span>{formatDuration(e.avgDurationSecs)}</span>
                  <span style={{ color: "var(--info, #60a5fa)" }}>
                    {Math.round(e.prRate * 100)}% PRs
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.runsByModel.length > 0 && (
        <div>
          <SectionTitle>Modelos Usados</SectionTitle>
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
                  <span
                    className="text-[10px] tabular-nums shrink-0"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {m.runs} runs
                  </span>
                </div>
                <ProgressBar value={m.runs} max={maxModel} color="var(--info, #60a5fa)" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section: Tasks ──────────────────────────────────────────────────────────

function TasksSection({ stats }: { stats: StatsResponse }) {
  const STATUS_COLORS: Record<string, string> = {
    done: "var(--success, #4ade80)",
    in_progress: "var(--info, #60a5fa)",
    review: "#a78bfa",
    failed: "var(--danger, #f87171)",
    backlog: "var(--text-muted)",
    scheduled: "var(--warning, #facc15)",
  };

  return (
    <div className="space-y-6">
      {stats.tasksByStatus.length > 0 && (
        <div>
          <SectionTitle>Por Status</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {stats.tasksByStatus.map((s) => (
              <div
                key={s.status}
                className="flex items-center justify-between px-3 py-2 rounded-lg border text-xs"
                style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
              >
                <span
                  className="font-medium capitalize"
                  style={{ color: STATUS_COLORS[s.status] ?? "var(--text-muted)" }}
                >
                  {s.status.replace("_", " ")}
                </span>
                <span className="font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {stats.tasksByRepo.length > 0 && (
        <div>
          <SectionTitle>Por Repositório (taxa de conclusão)</SectionTitle>
          <div className="space-y-3">
            {stats.tasksByRepo.slice(0, 10).map((r) => {
              const completionPct = r.total > 0 ? Math.round((r.done / r.total) * 100) : 0;
              const failedPct = r.total > 0 ? Math.round((r.failed / r.total) * 100) : 0;
              return (
                <div key={r.repoId}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className="text-xs truncate flex-1 pr-2"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {r.repoName}
                    </span>
                    <span
                      className="text-[10px] tabular-nums shrink-0"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {r.done}/{r.total} ({completionPct}%)
                      {r.failed > 0 && (
                        <span style={{ color: "var(--danger, #f87171)" }}> · {r.failed}✗</span>
                      )}
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full overflow-hidden flex"
                    style={{ background: "var(--border-default, #27272a)" }}
                  >
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${completionPct}%`, background: "var(--success, #4ade80)" }}
                    />
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${failedPct}%`, background: "var(--danger, #f87171)" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Section: Activity ───────────────────────────────────────────────────────

function ActivitySection({ stats }: { stats: StatsResponse }) {
  const maxDay = useMemo(
    () => Math.max(...stats.dailyActivity.map((d) => d.runs), 1),
    [stats.dailyActivity]
  );

  if (stats.dailyActivity.length === 0) {
    return (
      <div
        className="flex items-center justify-center h-32 text-sm"
        style={{ color: "var(--text-dimmed)" }}
      >
        Sem atividade nos últimos 30 dias
      </div>
    );
  }

  const totalInPeriod = stats.dailyActivity.reduce((a, d) => a + d.runs, 0);
  const failedInPeriod = stats.dailyActivity.reduce((a, d) => a + d.failed, 0);
  const successInPeriod = stats.dailyActivity.reduce((a, d) => a + d.completed, 0);

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Últimos 30 Dias</SectionTitle>
        <div className="flex gap-4 mb-4 text-xs" style={{ color: "var(--text-muted)" }}>
          <span>
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
              {totalInPeriod}
            </span>{" "}
            runs
          </span>
          <span>
            <span className="font-semibold" style={{ color: "var(--success, #4ade80)" }}>
              {successInPeriod}
            </span>{" "}
            ok
          </span>
          <span>
            <span className="font-semibold" style={{ color: "var(--danger, #f87171)" }}>
              {failedInPeriod}
            </span>{" "}
            falhas
          </span>
        </div>
        <div className="flex items-end gap-px h-20">
          {stats.dailyActivity.map((d) => {
            const pct = (d.runs / maxDay) * 100;
            const isBad = d.failed > d.completed;
            return (
              <div
                key={d.date}
                className="flex-1 rounded-t-sm transition-all hover:opacity-100"
                style={{
                  height: `${Math.max(pct, 3)}%`,
                  background: isBad
                    ? "var(--danger, #f87171)"
                    : "linear-gradient(to top, var(--accent, #7c3aed), #06b6d4)",
                  opacity: 0.6 + (pct / 100) * 0.4,
                }}
                title={`${d.date}: ${d.runs} runs (${d.completed} ok, ${d.failed} falhas)`}
              />
            );
          })}
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
            {stats.dailyActivity[0]?.date}
          </span>
          <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
            {stats.dailyActivity[stats.dailyActivity.length - 1]?.date}
          </span>
        </div>
      </div>
      <div>
        <SectionTitle>Intensidade por Dia</SectionTitle>
        <div className="flex flex-wrap gap-1">
          {stats.dailyActivity.map((d) => {
            const intensity = maxDay > 0 ? d.runs / maxDay : 0;
            const isBad = d.failed > d.completed && d.runs > 0;
            return (
              <div
                key={d.date}
                className="w-3.5 h-3.5 rounded-sm cursor-default"
                style={{
                  background:
                    d.runs === 0
                      ? "var(--border-default, #27272a)"
                      : isBad
                        ? `rgba(248, 113, 113, ${0.3 + intensity * 0.7})`
                        : `rgba(124, 58, 237, ${0.3 + intensity * 0.7})`,
                }}
                title={`${d.date}: ${d.runs} runs`}
              />
            );
          })}
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
            pouco
          </span>
          {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
            <div
              key={v}
              className="w-2.5 h-2.5 rounded-sm"
              style={{ background: `rgba(124, 58, 237, ${v})` }}
            />
          ))}
          <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
            muito
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Section: Skills ─────────────────────────────────────────────────────────

function SkillsSection({ skills }: { skills: SkillEffectiveness[] }) {
  if (skills.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center gap-2">
        <p className="text-sm" style={{ color: "var(--text-dimmed)" }}>
          Nenhuma métrica de skill disponível
        </p>
        <p className="text-xs" style={{ color: "var(--text-dimmed)" }}>
          Métricas aparecem após execuções com avaliação ativada
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SectionTitle>Efetividade das Skills</SectionTitle>
      <div className="space-y-2">
        {skills.map((s) => (
          <div
            key={s.name}
            className="px-3 py-2.5 rounded-lg border"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>
                {s.name}
              </span>
              <div
                className="flex items-center gap-3 text-[10px] tabular-nums"
                style={{ color: "var(--text-muted)" }}
              >
                <span>{s.totalRuns} runs</span>
                <span
                  style={{
                    color:
                      s.successRate >= 70
                        ? "var(--success, #4ade80)"
                        : s.successRate >= 40
                          ? "var(--warning, #facc15)"
                          : "var(--danger, #f87171)",
                  }}
                >
                  {s.successRate}%
                </span>
              </div>
            </div>
            <ProgressBar value={s.successRate} max={100} color="var(--success, #4ade80)" />
            {(s.avgBlockers > 0 || s.avgWarnings > 0) && (
              <div className="flex gap-3 mt-1.5 text-[10px]" style={{ color: "var(--text-muted)" }}>
                {s.avgBlockers > 0 && (
                  <span style={{ color: "var(--danger, #f87171)" }}>
                    {s.avgBlockers.toFixed(1)} bloqueadores/run
                  </span>
                )}
                {s.avgWarnings > 0 && (
                  <span style={{ color: "var(--warning, #facc15)" }}>
                    {s.avgWarnings.toFixed(1)} avisos/run
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

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-3 rounded w-20 mb-4" style={{ background: "var(--bg-card)" }} />
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl" style={{ background: "var(--bg-card)" }} />
        ))}
      </div>
      <div className="h-3 rounded w-28 mt-2" style={{ background: "var(--bg-card)" }} />
      <div className="h-24 rounded-xl" style={{ background: "var(--bg-card)" }} />
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-10 rounded-lg" style={{ background: "var(--bg-card)" }} />
        ))}
      </div>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

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

// ─── Main Dialog ──────────────────────────────────────────────────────────────

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
        setTimeout(() => setAnimationsReady(true), 50);
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
    <Dialog open={open} onClose={onClose} title="Estatísticas" size="5xl">
      <div className="flex gap-0 h-[70vh] -mx-6 -mb-6">
        {/* ── Left nav ──────────────────────────────────── */}
        <nav
          className="w-44 shrink-0 border-r flex flex-col gap-0.5 p-3"
          style={{ borderColor: "var(--glass-border)" }}
        >
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium cursor-pointer transition-colors text-left w-full"
              style={{
                background:
                  activeSection === item.id
                    ? "var(--accent-muted, rgba(124,58,237,0.15))"
                    : "transparent",
                color:
                  activeSection === item.id ? "var(--accent-light, #c4b5fd)" : "var(--text-muted)",
              }}
            >
              <span className="text-base leading-none flex-shrink-0">{item.icon}</span>
              {item.label}
            </button>
          ))}
          <div className="flex-1" />
          {stats && !loading && (
            <button
              type="button"
              onClick={() => exportStatsJson(stats, skillStats, engineStats)}
              title="Exportar como JSON"
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-[10px] cursor-pointer transition-colors hover:opacity-80 w-full"
              style={{ color: "var(--text-dimmed)" }}
            >
              <span>↓</span> Exportar JSON
            </button>
          )}
        </nav>

        {/* ── Right content ─────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-5">
          {loading && <LoadingSkeleton />}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--danger, #f87171)" }}>
                Erro ao carregar estatísticas
              </p>
              <p className="text-xs max-w-xs" style={{ color: "var(--text-muted)" }}>
                {error}
              </p>
              <button
                type="button"
                onClick={loadData}
                className="text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-colors hover:opacity-80"
                style={{ borderColor: "var(--border-subtle)", color: "var(--text-muted)" }}
              >
                Tentar novamente
              </button>
            </div>
          )}
          {!loading && !error && !stats && (
            <div
              className="flex items-center justify-center h-full"
              style={{ color: "var(--text-dimmed)" }}
            >
              <p className="text-sm">Sem dados disponíveis</p>
            </div>
          )}
          {!loading && !error && stats && (
            <>
              {activeSection === "overview" && (
                <OverviewSection stats={stats} ready={animationsReady} />
              )}
              {activeSection === "engines" && (
                <EnginesSection stats={stats} engineStats={engineStats} />
              )}
              {activeSection === "tasks" && <TasksSection stats={stats} />}
              {activeSection === "activity" && <ActivitySection stats={stats} />}
              {activeSection === "skills" && <SkillsSection skills={skillStats} />}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
