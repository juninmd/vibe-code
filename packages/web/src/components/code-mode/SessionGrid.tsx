import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { useElapsedTime } from "../../hooks/useElapsedTime";
import { formatRelativeTime } from "../../utils/relative-time";
import { getEngineMeta } from "../ui/engine-icons";
import { getProviderFromUrl } from "../ui/git-icons";
import { sessionLabel } from "./chat";
import { sessionStatusMeta } from "./status";

/** Ordering for the status filter, most "alive" first. */
const STATUS_ORDER: TaskStatus[] = [
  "in_progress",
  "review",
  "blocked",
  "failed",
  "backlog",
  "scheduled",
  "done",
];

type GroupBy = "none" | "project" | "status" | "executor";

const GROUP_BY_LABELS: Record<GroupBy, string> = {
  none: "No grouping",
  project: "Project",
  status: "Status",
  executor: "Executor",
};

const NO_PROJECT = "No project";
const UNASSIGNED = "Unassigned";

interface SessionGridProps {
  tasks: TaskWithRun[];
  loading?: boolean;
  connected?: boolean;
  onOpen: (task: TaskWithRun) => void;
  /** Stop a running session (called when its card is dismissed while running). */
  onStop: (taskId: string) => void;
}

function Chip({
  label,
  value,
  active,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="relative">
      <summary
        className={`flex cursor-pointer list-none items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors [&::-webkit-details-marker]:hidden ${
          active
            ? "border-accent/40 bg-accent/10 text-accent-text"
            : "border-default text-secondary hover:border-strong hover:text-primary"
        }`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M7 12h10M10 18h4" />
        </svg>
        {label}
        {value && <span className="text-accent-text">· {value}</span>}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="opacity-60"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="absolute left-0 z-30 mt-1.5 min-w-[200px] rounded-xl border border-default bg-surface p-1 shadow-2xl shadow-black/40">
        {children}
      </div>
    </details>
  );
}

function Option({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        onClick();
        e.currentTarget.closest("details")?.removeAttribute("open");
      }}
      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
        selected ? "bg-accent/15 text-accent-text" : "text-secondary hover:bg-surface-hover"
      }`}
    >
      <span className="min-w-0 truncate">{label}</span>
      <span className="shrink-0 tabular-nums text-muted">{count}</span>
    </button>
  );
}

function SessionCard({
  task,
  onOpen,
  onDismiss,
}: {
  task: TaskWithRun;
  onOpen: (task: TaskWithRun) => void;
  onDismiss: (task: TaskWithRun) => void;
}) {
  const meta = sessionStatusMeta(task.status);
  const running = task.status === "in_progress";
  const elapsed = useElapsedTime(task.latestRun?.startedAt, running);
  const provider = getProviderFromUrl(task.repo?.url ?? "");
  const ProviderIcon = provider.icon;
  const engine = task.engine ? getEngineMeta(task.engine) : null;
  const EngineIcon = engine?.icon;
  const snippet = (task.description ?? "").replace(/\s+/g, " ").trim();
  const timing = running
    ? (elapsed ?? "live")
    : formatRelativeTime(task.latestRun?.finishedAt ?? task.updatedAt);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(task)}
        className="flex h-full w-full flex-col rounded-2xl border border-white/6 bg-surface/50 p-4 pr-9 text-left transition-colors hover:border-white/12 hover:bg-surface-hover"
      >
        <div className="flex items-center gap-1.5 text-[11px] text-muted">
          <ProviderIcon size={13} className="shrink-0" />
          <span className="truncate font-medium text-secondary">
            {task.repo?.name ?? NO_PROJECT}
          </span>
          {task.branchName && (
            <>
              <span className="text-white/15">/</span>
              <span className="truncate">{task.branchName}</span>
            </>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-snug text-primary">
          {sessionLabel(task)}
        </h3>

        <p className="mt-1.5 line-clamp-2 min-h-[2rem] text-xs leading-relaxed text-dimmed">
          {snippet || "No context yet"}
        </p>

        <div className="mt-auto flex items-center gap-2 pt-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`}
              aria-hidden="true"
            />
            <span className={meta.text}>{meta.label}</span>
          </span>
          {task.prUrl && (
            <span className="font-medium text-success" title="Pull request open">
              PR
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5 text-muted">
            {EngineIcon && engine && (
              <EngineIcon size={12} className={`shrink-0 ${engine.color}`} />
            )}
            <span className="tabular-nums">{timing}</span>
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(task);
        }}
        aria-label={`Dismiss ${sessionLabel(task)}`}
        title="Dismiss"
        className="absolute right-2.5 top-3.5 grid h-5 w-5 place-items-center rounded-md text-muted/70 transition-colors hover:bg-white/10 hover:text-primary"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/** Card grid for the live (and recent) sessions, with chips and grouping. */
export function SessionGrid({
  tasks,
  loading = false,
  connected = false,
  onOpen,
  onStop,
}: SessionGridProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<TaskStatus | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [executor, setExecutor] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());

  const visible = useMemo(() => tasks.filter((t) => !hidden.has(t.id)), [tasks, hidden]);

  const counts = useMemo(() => {
    const byStatus = new Map<TaskStatus, number>();
    const byProject = new Map<string, number>();
    const byExecutor = new Map<string, number>();
    for (const t of visible) {
      byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
      const p = t.repo?.name || NO_PROJECT;
      byProject.set(p, (byProject.get(p) ?? 0) + 1);
      const e = t.engine || UNASSIGNED;
      byExecutor.set(e, (byExecutor.get(e) ?? 0) + 1);
    }
    return { byStatus, byProject, byExecutor };
  }, [visible]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return visible.filter((t) => {
      if (status && t.status !== status) return false;
      if (project && (t.repo?.name || NO_PROJECT) !== project) return false;
      if (executor && (t.engine || UNASSIGNED) !== executor) return false;
      if (!needle) return true;
      return (
        sessionLabel(t).toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle) ||
        (t.repo?.name ?? "").toLowerCase().includes(needle)
      );
    });
  }, [visible, query, status, project, executor]);

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "", tasks: filtered }];
    const keyOf = (t: TaskWithRun) =>
      groupBy === "project"
        ? t.repo?.name || NO_PROJECT
        : groupBy === "status"
          ? sessionStatusMeta(t.status).label
          : t.engine || UNASSIGNED;
    const map = new Map<string, TaskWithRun[]>();
    for (const t of filtered) {
      const key = keyOf(t);
      const bucket = map.get(key);
      if (bucket) bucket.push(t);
      else map.set(key, [t]);
    }
    const ordered = [...map.entries()].sort((a, b) => {
      if (groupBy === "status") {
        const sa = a[1][0]?.status ?? "backlog";
        const sb = b[1][0]?.status ?? "backlog";
        return STATUS_ORDER.indexOf(sa) - STATUS_ORDER.indexOf(sb);
      }
      return a[0].localeCompare(b[0]);
    });
    return ordered.map(([key, list]) => ({ key, label: key, tasks: list }));
  }, [filtered, groupBy]);

  const dismiss = (task: TaskWithRun) => {
    if (task.status === "in_progress") onStop(task.id);
    setHidden((prev) => new Set(prev).add(task.id));
  };

  const clearFilters = () => {
    setStatus(null);
    setProject(null);
    setExecutor(null);
    setQuery("");
  };
  const anyFilter = status !== null || project !== null || executor !== null || query.trim() !== "";

  const statusOptions = STATUS_ORDER.filter((s) => (counts.byStatus.get(s) ?? 0) > 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-4 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-primary">
            Live now
            <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-muted">
              {filtered.length}
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted">
              <span
                className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-info animate-pulse" : "bg-muted"}`}
                aria-hidden="true"
              />
              {connected ? "Live" : "Reconnecting…"}
            </span>
          </h2>
          <div className="relative ml-auto w-full sm:w-64">
            <svg
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sessions"
              className="h-9 w-full rounded-lg border border-default bg-input/40 pl-8 pr-3 text-xs text-primary outline-none transition-colors placeholder:text-muted focus:border-accent/40"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Chip
            label="Status"
            value={status ? sessionStatusMeta(status).label : ""}
            active={status !== null}
          >
            {statusOptions.map((s) => (
              <Option
                key={s}
                label={sessionStatusMeta(s).label}
                count={counts.byStatus.get(s) ?? 0}
                selected={status === s}
                onClick={() => setStatus(status === s ? null : s)}
              />
            ))}
          </Chip>
          <Chip label="Project" value={project ?? ""} active={project !== null}>
            {[...counts.byProject.entries()].map(([p, count]) => (
              <Option
                key={p}
                label={p}
                count={count}
                selected={project === p}
                onClick={() => setProject(project === p ? null : p)}
              />
            ))}
          </Chip>
          <Chip label="Executor" value={executor ?? ""} active={executor !== null}>
            {[...counts.byExecutor.entries()].map(([e, count]) => (
              <Option
                key={e}
                label={e}
                count={count}
                selected={executor === e}
                onClick={() => setExecutor(executor === e ? null : e)}
              />
            ))}
          </Chip>

          <label className="ml-1 flex items-center gap-2 text-xs text-muted">
            <span className="hidden sm:inline">Group by</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="h-8 rounded-lg border border-default bg-input/40 px-2 text-xs text-secondary outline-none focus:border-accent/40"
            >
              {(Object.keys(GROUP_BY_LABELS) as GroupBy[]).map((g) => (
                <option key={g} value={g}>
                  {GROUP_BY_LABELS[g]}
                </option>
              ))}
            </select>
          </label>

          {anyFilter && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-default px-2.5 py-1.5 text-xs text-secondary transition-colors hover:border-strong hover:text-primary"
            >
              Clear
            </button>
          )}

          <span className="ml-auto text-[11px] tabular-nums text-muted">
            {filtered.length} of {visible.length}
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3 sm:px-6">
        {loading ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-surface/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/8 bg-surface/60 text-accent">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M4 17l6-6-6-6M12 19h8" />
              </svg>
            </div>
            <p className="mt-2 text-sm font-semibold text-primary">
              {visible.length === 0 ? "No sessions yet" : "No sessions match"}
            </p>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              {visible.length === 0
                ? "Describe a task below and the harness will start a session and name it for you."
                : "Adjust the filters to see more sessions."}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <section key={group.key}>
                {group.label && (
                  <div className="mb-2 flex items-center gap-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted">
                      {group.label}
                    </h3>
                    <span className="text-[11px] tabular-nums text-dimmed">
                      {group.tasks.length}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.tasks.map((task) => (
                    <SessionCard key={task.id} task={task} onOpen={onOpen} onDismiss={dismiss} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
