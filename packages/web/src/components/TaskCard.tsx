import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskWithRun } from "@vibe-code/shared";
import { memo, useState } from "react";
import { useElapsedTime } from "../hooks/useElapsedTime";
import { formatDuration } from "../utils/date";
import { TaskTagsDisplay } from "./TaskTags";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getEngineMeta } from "./ui/engine-icons";
import { getProviderFromUrl } from "./ui/git-icons";

interface TaskCardProps {
  task: TaskWithRun;
  onClick: (task: TaskWithRun) => void;
  onRetryPR: (taskId: string) => void;
}

const PRIORITY_CONFIG = [
  { label: "P3", color: "text-zinc-600", bg: "bg-zinc-700/60", dot: "bg-zinc-600" },
  { label: "P2", color: "text-sky-500", bg: "bg-sky-900/40", dot: "bg-sky-500" },
  { label: "P1", color: "text-amber-400", bg: "bg-amber-900/40", dot: "bg-amber-400" },
  { label: "P0", color: "text-red-400", bg: "bg-red-900/40", dot: "bg-red-400" },
];

function PriorityDot({ priority }: { priority: number }) {
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

function TaskCardComponent({ task, onClick, onRetryPR }: TaskCardProps) {
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
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(task)}
      className={`glass-card border rounded-xl p-3 cursor-grab active:cursor-grabbing transition-all duration-200 group relative shadow-sm shadow-black/20 ${
        isRunning
          ? "border-blue-500/30 shadow-blue-500/10 shadow-md running-glow"
          : task.status === "failed"
            ? "border-red-500/20 hover:border-red-500/30"
            : "hover:border-white/10 hover:brightness-110"
      }`}
    >
      {/* Running accent bar */}
      {isRunning && (
        <>
          <div className="absolute inset-x-3 top-0 h-px overflow-hidden rounded-full bg-blue-500/20">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-blue-400 to-transparent animate-[pulse_1.4s_ease-in-out_infinite]" />
          </div>
          <div className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-blue-400 animate-pulse" />
        </>
      )}

      {/* Title row */}
      <div className="flex items-start gap-2 mb-1.5">
        {ProviderIcon && (
          <span className={`mt-0.5 shrink-0 ${provider?.color}`}>
            <ProviderIcon size={13} />
          </span>
        )}
        <h3 className="text-[13px] font-medium text-zinc-100 line-clamp-2 flex-1 leading-snug">
          {task.title}
        </h3>
        <div className="flex items-center gap-1 shrink-0">
          <PriorityDot priority={task.priority} />
          <span
            title={task.id}
            className="text-[9px] font-mono text-zinc-700 select-all leading-snug mt-px"
          >
            {task.id.slice(0, 8)}
          </span>
        </div>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-zinc-500 line-clamp-2 mb-2.5 ml-[21px] leading-relaxed">
          {task.description}
        </p>
      )}

      {/* Tags */}
      {task.tags && task.tags.length > 0 && (
        <div className="mb-2 ml-[21px]">
          <TaskTagsDisplay tags={task.tags} small />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-1.5 flex-wrap ml-[21px]">
        {task.repo &&
          (task.repo.url ? (
            <a
              href={task.repo.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-[11px] text-zinc-500 font-medium hover:text-zinc-300 transition-colors"
              title={task.repo.url}
            >
              {task.repo.name}
            </a>
          ) : (
            <span className="text-[11px] text-zinc-500 font-medium">{task.repo.name}</span>
          ))}

        {task.branchName && (
          <span className="hidden sm:inline-flex items-center gap-1 text-[11px] text-zinc-600 bg-zinc-900/60 border border-zinc-800/60 px-1.5 py-px rounded-md font-mono">
            <svg
              width="9"
              height="9"
              viewBox="0 0 16 16"
              fill="currentColor"
              className="text-zinc-700"
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

        {task.status === "scheduled" && (
          <Badge variant="warning" className="text-[10px] py-0 px-1.5">
            ⏰ agendada
          </Badge>
        )}
        {task.parentTaskId && (
          <Badge variant="default" className="text-[10px] py-0 px-1.5 opacity-60">
            ↳ derivada
          </Badge>
        )}
        {task.status === "failed" && (
          <Badge variant="danger" className="text-[10px] py-0 px-1.5">
            Failed
          </Badge>
        )}

        {task.status === "review" && !task.prUrl && (
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
              <span className="absolute left-0 top-full mt-1 z-20 text-[10px] text-red-400 bg-zinc-900 border border-red-900/50 rounded px-1.5 py-0.5 whitespace-nowrap max-w-[200px] truncate">
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

        {isRunning && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-400 ml-auto whitespace-nowrap overflow-hidden max-w-[160px]">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="truncate">{task.latestRun?.currentStatus || "Running…"}</span>
            {elapsed && <span className="shrink-0 text-blue-500/80 tabular-nums">{elapsed}</span>}
          </span>
        )}
        {!isRunning &&
          task.latestRun?.startedAt &&
          task.latestRun?.finishedAt &&
          (() => {
            const dur = formatDuration(task.latestRun.startedAt, task.latestRun.finishedAt);
            return dur ? (
              <span className="text-[10px] text-zinc-600 ml-auto tabular-nums">⏱ {dur}</span>
            ) : null;
          })()}
      </div>
    </div>
  );
}

export const TaskCard = memo(TaskCardComponent, (prev, next) => {
  return (
    prev.task === next.task && prev.onClick === next.onClick && prev.onRetryPR === next.onRetryPR
  );
});
