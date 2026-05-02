import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TASK_PRIORITY_META, type TaskWithRun } from "@vibe-code/shared";
import { memo, useEffect, useRef, useState } from "react";
import { useElapsedTime } from "../hooks/useElapsedTime";
import type { RetryState } from "../hooks/useRetryQueue";
import { formatDuration } from "../utils/date";
import { getPhaseLabel } from "../utils/runPhase";
import { TaskTagsDisplay } from "./TaskTags";
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

const PRIORITY_CONFIG = [
  { label: "P3", color: "text-dimmed", bg: "bg-surface-hover", dot: "bg-border-strong" },
  { label: "P2", color: "text-info", bg: "bg-info/15", dot: "bg-sky-500" },
  { label: "P1", color: "text-warning", bg: "bg-warning/15", dot: "bg-amber-400" },
  { label: "P0", color: "text-danger", bg: "bg-danger/15", dot: "bg-red-400" },
];

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

/** @deprecated kept for legacy priority: number usage during transition */
function _PriorityDot({ priority }: { priority: number }) {
  const cfg = PRIORITY_CONFIG[Math.min(priority, 3)] ?? PRIORITY_CONFIG[0];
  if (priority === 0) return null;
  return (
    <span
      title={`Priority ${priority}`}
      className={`shrink-0 inline-flex items-center gap-1 text-[9px] font-bold px-1 py-0.5 rounded ${cfg.bg} ${cfg.color}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function TaskCardComponent({ task, onClick, onRetryPR, retryEntry }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  });

  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
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
      className={`glass-card border rounded-2xl p-3 cursor-grab active:cursor-grabbing transition-all duration-250 group relative shadow-lg shadow-black/35 overflow-hidden ${
        isRunning
          ? "border-info/30 shadow-cyan-500/20 running-glow"
          : task.status === "failed"
            ? "border-danger/30 hover:border-danger/30 hover:shadow-red-900/30"
            : "hover:border-sky-300/25 hover:shadow-blue-900/30 hover:translate-y-[-1px]"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.04] via-transparent to-cyan-400/[0.05] opacity-80" />

      {isRunning && (
        <>
          <div className="absolute inset-x-2 top-0 h-[2px] overflow-hidden rounded-full bg-info/15">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan-300 to-transparent animate-[pulse_1.1s_ease-in-out_infinite]" />
          </div>
          <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-r-full bg-gradient-to-b from-cyan-300 via-blue-400 to-indigo-400 animate-pulse" />
        </>
      )}

      <div className="relative z-10 flex items-start gap-2 mb-1.5">
        {ProviderIcon && (
          <span className={`mt-0.5 shrink-0 ${provider?.color}`}>
            <ProviderIcon size={13} />
          </span>
        )}
        <h3
          className="text-[13px] font-medium line-clamp-2 flex-1 leading-snug"
          style={{ color: "var(--text-primary)" }}
        >
          {task.title}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <PriorityBadge priority={task.priority} />
          {task.issueNumber != null ? (
            <span
              title={task.id}
              className="text-[9px] font-mono select-all leading-snug mt-px px-1 py-0.5 rounded bg-surface-hover border border-strong"
              style={{ color: "var(--text-dimmed)" }}
            >
              #{task.issueNumber}
            </span>
          ) : (
            <span
              title={task.id}
              className="text-[9px] font-mono select-all leading-snug mt-px"
              style={{ color: "var(--text-dimmed)" }}
            >
              {task.id.slice(0, 8)}
            </span>
          )}
        </div>
      </div>

      {task.description && (
        <p
          className="text-xs line-clamp-2 mb-2.5 ml-[21px] leading-relaxed"
          style={{ color: "var(--text-secondary)" }}
        >
          {task.description}
        </p>
      )}

      {task.tags && task.tags.length > 0 && (
        <div className="mb-2 ml-[21px]">
          <TaskTagsDisplay tags={task.tags} small />
        </div>
      )}

      {task.labels && task.labels.length > 0 && (
        <div className="mb-2 ml-[21px] flex flex-wrap gap-1">
          {task.labels.map((label) => (
            <span
              key={label.id}
              className="inline-flex items-center gap-1 text-[9px] font-medium px-1.5 py-0.5 rounded-full border"
              style={{
                backgroundColor: `${label.color}22`,
                borderColor: `${label.color}55`,
                color: label.color,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              {label.name}
            </span>
          ))}
        </div>
      )}

      <div className="relative z-10 flex items-center gap-1.5 flex-wrap ml-[21px]">
        {task.repo &&
          (task.repo.url ? (
            <a
              href={task.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] font-medium transition-colors"
              style={{ color: "var(--text-muted)" }}
              title={task.repo.url}
            >
              {task.repo.name}
            </a>
          ) : (
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              {task.repo.name}
            </span>
          ))}

        {task.branchName && (
          <span
            className="hidden sm:inline-flex items-center gap-1 text-[11px] px-1.5 py-px rounded-md font-mono"
            style={{
              color: "var(--text-muted)",
              background: "var(--bg-card)",
              border: "1px solid var(--border-default)",
            }}
          >
            <svg
              aria-hidden="true"
              width="9"
              height="9"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="text-dimmed"
            >
              <path d="M11.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zm-2.25.75a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0zM4.25 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM2 3.25a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0zM4.25 12.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM2 13.25a2.25 2.25 0 1 1 4.5 0 2.25 2.25 0 0 1-4.5 0zM5 6.25V7.5A2.5 2.5 0 0 0 7.5 10H9v1.75A2.25 2.25 0 1 0 3 11.75V6.25A2.25 2.25 0 1 0 5 6.25z" />
            </svg>
            {task.branchName.replace("vibe-code/", "vc/")}
          </span>
        )}

        {task.engine &&
          (() => {
            const eng = getEngineMeta(task.engine);
            const EngIcon = eng.icon;
            return (
              <Badge variant="purple" className="text-[10px] py-0 px-1.5 flex items-center gap-1">
                <EngIcon size={9} className={eng.color} />
                {task.engine}
                {task.model && (
                  <span
                    className="text-[9px] opacity-60 font-mono ml-0.5 max-w-[80px] truncate"
                    title={task.model}
                  >
                    /{task.model.split("/").pop()?.replace(":free", "")}
                  </span>
                )}
              </Badge>
            );
          })()}

        {task.latestRun?.litellmTokenId && (
          <Badge variant="default" className="text-[10px] py-0 px-1.5 opacity-80">
            LiteLLM
          </Badge>
        )}

        {task.status === "scheduled" && (
          <Badge
            variant="warning"
            className="text-[10px] py-0 px-1.5 inline-flex items-center gap-1"
          >
            <svg
              aria-hidden="true"
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="5.5" />
              <path d="M8 5.5v3l2 1.3" />
            </svg>
            scheduled
          </Badge>
        )}
        {task.parentTaskId && (
          <Badge variant="default" className="text-[10px] py-0 px-1.5 opacity-60">
            ↳ derived
          </Badge>
        )}
        {task.status === "failed" && (
          <Badge variant="danger" className="text-[10px] py-0 px-1.5">
            Failed
          </Badge>
        )}
        {task.status === "failed" && task.latestRun?.errorMessage && (
          <span
            className="text-[9px] text-danger/70 font-mono truncate max-w-[140px]"
            title={task.latestRun.errorMessage}
          >
            {task.latestRun.errorMessage}
          </span>
        )}

        {task.status === "review" && !task.prUrl && (
          // biome-ignore lint/a11y/noStaticElementInteractions: this wrapper only prevents drag/click propagation around the nested button
          <div
            className="relative z-10"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Button
              size="xs"
              variant="primary"
              className="h-5 text-[10px] px-2"
              onClick={handleRetryPR}
              disabled={retrying}
            >
              {retrying ? "…" : "Retry PR"}
            </Button>
            {retryError && (
              <span className="absolute left-0 top-full mt-1 z-20 text-[10px] text-danger bg-input border border-danger/30 rounded px-1.5 py-0.5 whitespace-nowrap max-w-[200px] truncate">
                {retryError}
              </span>
            )}
          </div>
        )}

        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-0.5"
          >
            <Badge
              variant="success"
              className="text-[10px] py-0 px-1.5 hover:opacity-80 transition-opacity"
            >
              ↗ PR
            </Badge>
          </a>
        )}

        {task.issueUrl &&
          (() => {
            const { name, icon: IssueIcon, color } = getProviderFromUrl(task.issueUrl);
            return (
              <a
                href={task.issueUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-0.5"
              >
                <Badge
                  variant="info"
                  className={`text-[10px] py-0 px-1.5 hover:opacity-80 transition-opacity ${color}`}
                >
                  <IssueIcon size={9} className="mr-0.5" />
                  {name}
                </Badge>
              </a>
            );
          })()}

        {retryEntry && task.status === "failed" && (
          <RetryCountdown dueAt={retryEntry.dueAt} attempt={retryEntry.attempt} />
        )}

        {isRunning && (
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-info ml-auto whitespace-nowrap overflow-hidden max-w-[170px] bg-info/15 border border-info/30 px-2 py-[2px] rounded-md">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
            <span className="truncate">{getPhaseLabel(task.latestRun?.currentStatus)}</span>
            {elapsed && <span className="shrink-0 text-info/80 tabular-nums">{elapsed}</span>}
          </span>
        )}

        {task.latestRun?.costStats && (
          <div className={`${isRunning ? "ml-2" : "ml-auto"} flex flex-col items-end gap-0.5`}>
            {(() => {
              const stats = task.latestRun?.costStats;
              if (!stats) return null;
              const cost = stats.input !== undefined ? stats.input / 1_000_000 : 0;
              const hasTokens = stats.input_tokens > 0 || stats.output_tokens > 0;

              return (
                <span
                  className="text-[9px] font-mono whitespace-nowrap flex items-center gap-1.5"
                  style={{ color: "var(--text-dimmed)" }}
                >
                  {cost > 0 && (
                    <span className="text-warning-muted font-bold">${cost.toFixed(3)}</span>
                  )}
                  {hasTokens && (
                    <span className="flex items-center gap-1">
                      <span title="Input Tokens">
                        ↓{Math.round(stats.input_tokens / 100) / 10}k
                      </span>
                      <span title="Output Tokens">
                        ↑{Math.round(stats.output_tokens / 100) / 10}k
                      </span>
                    </span>
                  )}
                </span>
              );
            })()}
            {!isRunning && task.latestRun?.startedAt && task.latestRun?.finishedAt && (
              <span className="text-[10px] tabular-nums" style={{ color: "var(--text-dimmed)" }}>
                ⏱ {formatDuration(task.latestRun.startedAt, task.latestRun.finishedAt)}
              </span>
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
