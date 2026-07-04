import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  TASK_COMPLEXITY_META,
  TASK_PRIORITY_META,
  TASK_TYPE_META,
  type TaskWithRun,
} from "@vibe-code/shared";
import { memo, useEffect, useRef, useState } from "react";
import { useElapsedTime } from "../hooks/useElapsedTime";
import type { RetryState } from "../hooks/useRetryQueue";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getEngineMeta } from "./ui/engine-icons";
import { getProviderFromUrl } from "./ui/git-icons";

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface TaskCardProps {
  task: TaskWithRun;
  onClick: (task: TaskWithRun) => void;
  onRetryPR: (taskId: string) => void;
  onUnblock?: (taskId: string) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelectionChange?: (taskId: string, selected: boolean) => void;
  retryEntry?: RetryState;
}

function RetryCountdown({ dueAt, attempt }: { dueAt: number; attempt: number }) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.ceil((dueAt - Date.now()) / 1000))
  );
  const rafRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    rafRef.current = setInterval(() => {
      const secs = Math.max(0, Math.ceil((dueAt - Date.now()) / 1000));
      setRemaining(secs);
      if (secs === 0 && rafRef.current) clearInterval(rafRef.current);
    }, 1_000);
    return () => {
      if (rafRef.current) clearInterval(rafRef.current);
    };
  }, [dueAt]);

  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-px rounded-md bg-warning/15 border border-warning/30 text-warning">
      <svg
        aria-hidden="true"
        width="9"
        height="9"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5.5v3l2 1.3" />
      </svg>
      retry #{attempt} in {remaining}s
    </span>
  );
}

function PriorityBadge({ priority }: { priority: import("@vibe-code/shared").TaskPriority }) {
  if (priority === "none") return null;
  const meta = TASK_PRIORITY_META[priority];
  return (
    <span
      title={meta.label}
      className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${meta.bgColor} ${meta.textColor} ${meta.borderColor}`}
    >
      {meta.icon} {meta.label}
    </span>
  );
}

const statusColor: Record<string, { bg: string; border: string; glow: string }> = {
  running: {
    bg: "from-cyan-500/20 to-blue-500/20",
    border: "border-cyan-500/30",
    glow: "shadow-[0_0_20px_-5px_rgba(6,182,212,0.3)]",
  },
  failed: {
    bg: "from-red-500/10 to-orange-500/10",
    border: "border-red-500/30",
    glow: "shadow-[0_0_20px_-5px_rgba(239,68,68,0.2)]",
  },
  review: {
    bg: "from-purple-500/10 to-pink-500/10",
    border: "border-purple-500/30",
    glow: "shadow-[0_0_20px_-5px_rgba(168,85,247,0.2)]",
  },
  done: {
    bg: "from-emerald-500/10 to-teal-500/10",
    border: "border-emerald-500/30",
    glow: "shadow-[0_0_20px_-5px_rgba(16,185,129,0.2)]",
  },
  scheduled: {
    bg: "from-amber-500/10 to-yellow-500/10",
    border: "border-amber-500/30",
    glow: "shadow-[0_0_20px_-5px_rgba(245,158,11,0.2)]",
  },
  backlog: { bg: "from-zinc-500/10 to-neutral-500/10", border: "border-zinc-500/20", glow: "" },
  blocked: {
    bg: "from-orange-500/15 to-amber-500/10",
    border: "border-orange-500/40",
    glow: "shadow-[0_0_20px_-5px_rgba(249,115,22,0.3)]",
  },
};

const conflictColor = {
  bg: "from-rose-500/20 to-orange-500/15",
  border: "border-rose-500/50",
  glow: "shadow-[0_0_24px_-4px_rgba(244,63,94,0.4)]",
};

function TaskCardComponent({
  task,
  onClick,
  onRetryPR,
  onUnblock,
  selectionMode = false,
  selected = false,
  onSelectionChange,
  retryEntry,
}: TaskCardProps) {
  const isConflictResolution = task.tags?.includes("conflict-resolution") ?? false;
  const colors = isConflictResolution
    ? conflictColor
    : statusColor[task.status] || statusColor.backlog;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const [retrying, setRetrying] = useState(false);
  const [_retryError, setRetryError] = useState<string | null>(null);
  const isRunning = task.latestRun?.status === "running";
  const elapsed = useElapsedTime(task.latestRun?.startedAt, isRunning);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleRetryPR = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (retrying) return;
    setRetrying(true);
    setRetryError(null);
    try {
      await onRetryPR(task.id);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : String(err));
    } finally {
      setRetrying(false);
    }
  };

  const handleSelectionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    onSelectionChange?.(task.id, e.currentTarget.checked);
  };

  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;

  const isFailed = task.status === "failed";
  const isReview = task.status === "review";
  const isScheduled = task.status === "scheduled";
  const isBlocked = task.status === "blocked";
  const isDone = task.status === "done";
  const hasPR = !!task.prUrl;
  const hasMetadata = !!(
    task.tags?.length ||
    task.taskType ||
    task.taskComplexity ||
    task.labels?.length
  );

  let displayCost: number | null = null;
  const run = task.latestRun;
  if (task.usageSummary && task.usageSummary.runCount > 0) {
    displayCost = task.usageSummary.totalCost;
  } else if (run) {
    if (run.tokenUsage && Object.keys(run.tokenUsage).length > 0) {
      let sumTotalCost = 0;
      for (const stats of Object.values(run.tokenUsage) as any[]) {
        sumTotalCost += stats.total_cost || (stats.input_cost || 0) + (stats.output_cost || 0);
      }
      displayCost = sumTotalCost;
    } else if (run.costStats) {
      const rawTotal =
        run.costStats.total ?? (run.costStats.input || 0) + (run.costStats.output || 0);
      displayCost = rawTotal / 1_000_000;
    }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={`Task: ${task.title}`}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick(task);
        }
      }}
      onClick={() => onClick(task)}
      className={`group relative rounded-lg cursor-grab active:cursor-grabbing transition-all duration-300 overflow-hidden ${
        selected ? "ring-2 ring-danger/50" : ""
      } ${isRunning ? colors.glow : ""}`}
    >
      <div
        className={`absolute inset-0 bg-gradient-to-br ${colors.bg} opacity-50 group-hover:opacity-80 transition-opacity duration-300`}
      />

      {isRunning && (
        <div className="absolute inset-0 animate-[pulse_2s_ease-in-out_infinite]">
          <div
            className={`absolute inset-0 bg-gradient-to-r from-transparent ${isConflictResolution ? "via-rose-400/30" : "via-cyan-400/30"} to-transparent -translate-x-full animate-[shimmer_2s_ease-in-out_infinite]`}
          />
        </div>
      )}

      <div
        className={`absolute left-0 top-0 bottom-0 w-0.5 ${colors.border} group-hover:w-1 transition-all duration-200`}
      />

      <div className="relative z-10">
        <div className="p-3 border-b border-white/[0.05]">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              {selectionMode && (
                <input
                  type="checkbox"
                  aria-label={`Selecionar ${task.title}`}
                  checked={selected}
                  onChange={handleSelectionChange}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-red-500"
                />
              )}
              {ProviderIcon && (
                <span className={`mt-0.5 shrink-0 ${provider?.color}`}>
                  <ProviderIcon size={13} />
                </span>
              )}
              <h3 className="text-[12px] font-medium line-clamp-2 leading-snug text-primary">
                {task.title}
              </h3>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <PriorityBadge priority={task.priority} />
              <span className="text-[9px] font-mono text-dimmed">
                {task.issueNumber != null ? `#${task.issueNumber}` : task.id.slice(0, 4)}
              </span>
            </div>
          </div>
        </div>

        <div className="p-3">
          {task.description && (
            <p className="text-[11px] line-clamp-1 text-secondary opacity-60 mb-2">
              {task.description}
            </p>
          )}

          {hasMetadata && (
            <div className="flex flex-wrap gap-1 mb-2">
              {task.taskType && (
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${TASK_TYPE_META[task.taskType].bgColor} ${TASK_TYPE_META[task.taskType].textColor}`}
                >
                  {TASK_TYPE_META[task.taskType].label}
                </span>
              )}
              {task.taskComplexity && (
                <span
                  className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${TASK_COMPLEXITY_META[task.taskComplexity].bgColor} ${TASK_COMPLEXITY_META[task.taskComplexity].textColor}`}
                >
                  {TASK_COMPLEXITY_META[task.taskComplexity].icon}
                </span>
              )}
              {task.tags?.slice(0, 2).map((tag) => (
                <span key={tag} className="text-[9px] text-accent-text/70">
                  #{tag}
                </span>
              ))}
              {task.labels?.slice(0, 1).map((label) => (
                <span key={label.id} className="text-[9px]" style={{ color: label.color }}>
                  {label.name}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-white/[0.05]">
            <div className="flex items-center gap-2 min-w-0">
              {task.repo && (
                <span className="text-[10px] text-muted truncate group-hover:text-secondary transition-colors">
                  {task.repo.name}
                </span>
              )}
              {task.engine &&
                (() => {
                  const eng = getEngineMeta(task.engine);
                  const EngIcon = eng.icon;
                  return (
                    <div className="flex items-center gap-1 shrink-0">
                      <EngIcon size={9} className={eng.color} />
                      <span className="text-[9px] text-muted/70 uppercase">{task.engine}</span>
                    </div>
                  );
                })()}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isRunning ? (
                <span className="flex items-center gap-1.5 text-[10px] text-info tabular-nums font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)] animate-pulse" />
                  {elapsed}
                </span>
              ) : displayCost !== null ? (
                <span className="text-[10px] font-mono text-warning/80 bg-warning/10 px-1.5 py-0.5 rounded">
                  ${displayCost.toFixed(2)}
                </span>
              ) : isDone && task.latestRun?.finishedAt ? (
                <span
                  className="text-[10px] text-emerald-400/70"
                  title={new Date(task.latestRun.finishedAt).toLocaleString()}
                >
                  {formatRelativeTime(task.latestRun.finishedAt)}
                </span>
              ) : isDone ? (
                <span className="text-[10px] text-emerald-400">done</span>
              ) : null}
            </div>
          </div>
        </div>

        <div
          className={`p-2.5 flex items-center gap-2 ${isConflictResolution ? "bg-rose-500/10" : isFailed ? "bg-danger/10" : isReview ? "bg-purple-500/10" : isBlocked ? "bg-orange-500/10" : "bg-white/[0.02]"}`}
        >
          {isConflictResolution && (
            <span className="inline-flex items-center gap-1 text-[8px] font-semibold px-2 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300">
              <svg
                aria-hidden="true"
                width="8"
                height="8"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3h4v4H3zM9 9h4v4H9zM7 5h2M7 11h2M11 7v2M5 7v2" />
              </svg>
              Merge Conflict
            </span>
          )}
          {hasPR && !isConflictResolution && (
            <Badge variant="success" className="text-[8px] py-0.5 px-2 font-medium">
              PR
            </Badge>
          )}
          {hasPR && isConflictResolution && (
            <a
              href={task.prUrl ?? "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-[8px] font-medium px-2 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 transition-colors"
            >
              PR
            </a>
          )}
          {isFailed && (
            <Badge variant="danger" className="text-[8px] py-0.5 px-2 font-medium">
              Failed
            </Badge>
          )}
          {isScheduled && (
            <Badge variant="warning" className="text-[8px] py-0.5 px-2 font-medium">
              Scheduled
            </Badge>
          )}
          {task.loopConfig?.enabled && (
            <Badge variant="info" className="text-[8px] py-0.5 px-2 font-medium">
              Loop
              {task.loopConfig.currentAttempt
                ? ` ${task.loopConfig.currentAttempt}/${task.loopConfig.maxAttempts}`
                : ""}
            </Badge>
          )}
          {isBlocked && (
            <>
              <Badge variant="warning" className="text-[8px] py-0.5 px-2 font-medium">
                🔒 Blocked
              </Badge>
              {onUnblock && (
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="h-5 text-[8px] px-2 ml-auto"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnblock(task.id);
                  }}
                >
                  Resume
                </Button>
              )}
            </>
          )}
          {retryEntry && isFailed && (
            <RetryCountdown dueAt={retryEntry.dueAt} attempt={retryEntry.attempt} />
          )}
          {isReview && !hasPR && (
            <Button
              type="button"
              size="xs"
              variant="primary"
              className="h-5 text-[8px] px-2"
              onClick={handleRetryPR}
              disabled={retrying}
            >
              {retrying ? "..." : "Retry PR"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent, (prev, next) => {
  return (
    prev.task === next.task &&
    prev.onClick === next.onClick &&
    prev.onRetryPR === next.onRetryPR &&
    prev.selectionMode === next.selectionMode &&
    prev.selected === next.selected &&
    prev.onSelectionChange === next.onSelectionChange &&
    prev.retryEntry === next.retryEntry
  );
});
