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

interface TaskCardProps {
  task: TaskWithRun;
  onClick: (task: TaskWithRun) => void;
  onRetryPR: (taskId: string) => void;
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

function TaskCardComponent({ task, onClick, onRetryPR, retryEntry }: TaskCardProps) {
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

  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: sortable card uses pointer interaction on the wrapper by design
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard semantics are intentionally delegated to inner controls because the card contains nested interactive elements
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      className={`glass-card border rounded-2xl p-4 cursor-grab active:cursor-grabbing transition-all duration-200 group relative shadow-soft hover-lift active-shrink ${
        isRunning
          ? "border-info/40 shadow-glow-accent"
          : task.status === "failed"
            ? "border-danger/30 hover:border-danger/40 hover:shadow-glow-danger"
            : "hover:border-accent/30"
      }`}
    >
      {isRunning && (
        <div className="absolute inset-x-0 top-0 h-1 overflow-hidden rounded-t-2xl bg-info/10">
          <div className="h-full w-full bg-gradient-to-r from-transparent via-cyan-400 to-transparent animate-[pulse_1.5s_ease-in-out_infinite]" />
        </div>
      )}

      <div className="relative z-10 flex flex-col gap-3">
        {/* Header: Title and Issue/ID */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 flex-1 min-w-0">
            {ProviderIcon && (
              <span
                className={`mt-0.5 shrink-0 ${provider?.color} opacity-80 group-hover:opacity-100 transition-opacity`}
              >
                <ProviderIcon size={14} />
              </span>
            )}
            <h3 className="text-[13px] font-semibold line-clamp-2 leading-tight tracking-tight text-primary">
              {task.title}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <PriorityBadge priority={task.priority} />
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-hover border border-strong/40 text-dimmed">
              {task.issueNumber != null ? `#${task.issueNumber}` : task.id.slice(0, 6)}
            </span>
          </div>
        </div>

        {/* Description */}
        {task.description && (
          <p className="text-[11px] line-clamp-2 leading-relaxed text-secondary opacity-70 group-hover:opacity-90 transition-opacity">
            {task.description}
          </p>
        )}

        {/* Tags & Metadata Badges */}
        {(task.tags?.length > 0 ||
          task.taskType ||
          task.taskComplexity ||
          (task.labels && task.labels.length > 0)) && (
          <div className="flex flex-wrap gap-1.5">
            {task.taskType &&
              (() => {
                const m = TASK_TYPE_META[task.taskType];
                return (
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${m.bgColor} ${m.textColor} ${m.borderColor} opacity-80`}
                  >
                    {m.label}
                  </span>
                );
              })()}
            {task.taskComplexity &&
              (() => {
                const m = TASK_COMPLEXITY_META[task.taskComplexity];
                return (
                  <span
                    className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${m.bgColor} ${m.textColor} ${m.borderColor} opacity-80`}
                  >
                    {m.icon} {m.label}
                  </span>
                );
              })()}
            {task.tags?.map((tag) => (
              <span
                key={tag}
                className="text-[9px] px-1.5 py-0.5 rounded-sm bg-accent-muted/10 border border-accent/20 text-accent-text/80 font-medium"
              >
                #{tag}
              </span>
            ))}
            {task.labels?.map((label) => (
              <span
                key={label.id}
                className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full border"
                style={{
                  backgroundColor: `${label.color}15`,
                  borderColor: `${label.color}40`,
                  color: label.color,
                }}
              >
                <span
                  className="w-1 h-1 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                {label.name}
              </span>
            ))}
          </div>
        )}

        {/* Footer: Repo, Agent, Stats */}
        <div className="flex items-center justify-between pt-1 border-t border-strong/10">
          <div className="flex items-center gap-2 overflow-hidden min-w-0">
            {task.repo && (
              <span className="text-[10px] font-medium truncate text-muted opacity-60 hover:opacity-100 transition-opacity">
                {task.repo.name}
              </span>
            )}

            {task.engine &&
              (() => {
                const eng = getEngineMeta(task.engine);
                const EngIcon = eng.icon;
                return (
                  <div className="flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded bg-surface-hover/50 border border-strong/20">
                    <EngIcon size={10} className={eng.color} />
                    <span className="text-[9px] font-medium opacity-80 uppercase tracking-tighter">
                      {task.engine}
                    </span>
                  </div>
                );
              })()}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isRunning ? (
              <span className="flex items-center gap-1.5 text-[10px] font-bold text-info tabular-nums">
                <span className="w-1 h-1 rounded-full bg-info animate-pulse" />
                {elapsed}
              </span>
            ) : task.latestRun?.costStats ? (
              <span className="text-[10px] font-mono font-bold text-warning-muted">
                $
                {(task.latestRun.costStats.input
                  ? task.latestRun.costStats.input / 1_000_000
                  : 0
                ).toFixed(2)}
              </span>
            ) : null}
          </div>
        </div>

        {/* Special States (PR, Failed, Scheduled) */}
        {(task.status === "review" ||
          task.status === "failed" ||
          task.status === "scheduled" ||
          task.prUrl) && (
          <div className="flex items-center gap-2 mt-1">
            {task.prUrl && (
              <Badge variant="success" className="text-[9px] font-bold uppercase py-0 px-1.5">
                ↗ PR Created
              </Badge>
            )}
            {task.status === "failed" && (
              <Badge variant="danger" className="text-[9px] font-bold uppercase py-0 px-1.5">
                Failed
              </Badge>
            )}
            {task.status === "scheduled" && (
              <Badge variant="warning" className="text-[9px] font-bold uppercase py-0 px-1.5">
                Scheduled
              </Badge>
            )}
            {retryEntry && task.status === "failed" && (
              <RetryCountdown dueAt={retryEntry.dueAt} attempt={retryEntry.attempt} />
            )}
            {task.status === "review" && !task.prUrl && (
              <Button
                type="button"
                size="xs"
                variant="primary"
                className="h-5 text-[9px] font-bold uppercase px-2"
                onClick={handleRetryPR}
                disabled={retrying}
              >
                {retrying ? "…" : "Retry PR"}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent, (prev, next) => {
  return (
    prev.task === next.task &&
    prev.onClick === next.onClick &&
    prev.onRetryPR === next.onRetryPR &&
    prev.retryEntry === next.retryEntry
  );
});
