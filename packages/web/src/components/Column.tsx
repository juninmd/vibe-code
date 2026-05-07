import { useDroppable } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_STATUS_LABELS } from "@vibe-code/shared";
import { memo } from "react";
import type { RetryState } from "../hooks/useRetryQueue";
import { TaskCard } from "./TaskCard";

// ─── Column visual config ──────────────────────────────────────────────────────

const columnConfig: Record<
  TaskStatus,
  {
    dot: string;
    countBg: string;
    countText: string;
    emptyIcon: "clock" | "list" | "play" | "eye" | "check" | "x" | "archive";
    emptyText: string;
  }
> = {
  scheduled: {
    dot: "bg-amber-400",
    countBg: "bg-warning/15 border-warning/30",
    countText: "text-warning",
    emptyIcon: "clock",
    emptyText: "Nenhuma tarefa agendada",
  },
  backlog: {
    dot: "bg-zinc-500",
    countBg: "bg-surface-hover border-strong/40",
    countText: "text-secondary",
    emptyIcon: "list",
    emptyText: "Add tasks here",
  },
  in_progress: {
    dot: "bg-blue-400",
    countBg: "bg-info/15 border-info/30",
    countText: "text-info",
    emptyIcon: "play",
    emptyText: "No agents running",
  },
  review: {
    dot: "bg-violet-400",
    countBg: "bg-accent-muted border-accent/30",
    countText: "text-accent-text",
    emptyIcon: "eye",
    emptyText: "Nothing awaiting review",
  },
  done: {
    dot: "bg-emerald-400",
    countBg: "bg-success/15 border-success/30",
    countText: "text-success",
    emptyIcon: "check",
    emptyText: "No tasks completed",
  },
  failed: {
    dot: "bg-red-400",
    countBg: "bg-danger/15 border-danger/30",
    countText: "text-danger",
    emptyIcon: "x",
    emptyText: "No failures",
  },
  archived: {
    dot: "bg-border-strong",
    countBg: "bg-surface-hover border-strong/40",
    countText: "text-primary0",
    emptyIcon: "archive",
    emptyText: "No archived files",
  },
};

interface ColumnProps {
  status: TaskStatus;
  tasks: TaskWithRun[];
  onTaskClick: (task: TaskWithRun) => void;
  onRetryPR: (taskId: string) => void;
  onArchiveDone?: () => void;
  onClearFailed?: () => void;
  onRetryAllFailed?: () => void;
  horizontal?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** When true, the column stretches to fill available width instead of using fixed 272px */
  fillWidth?: boolean;
  retryQueueMap?: Map<string, RetryState>;
}

function EmptyStateIcon({ icon }: { icon: (typeof columnConfig)[TaskStatus]["emptyIcon"] }) {
  const shared = {
    "aria-hidden": true,
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.8",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (icon) {
    case "clock":
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "list":
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M9 6h11" />
          <path d="M9 12h11" />
          <path d="M9 18h11" />
          <circle cx="4" cy="6" r="1" />
          <circle cx="4" cy="12" r="1" />
          <circle cx="4" cy="18" r="1" />
        </svg>
      );
    case "play":
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8 6 4-6 4z" />
        </svg>
      );
    case "eye":
      return (
        <svg {...shared} aria-hidden="true">
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
    case "x":
      return (
        <svg {...shared} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6" />
          <path d="m15 9-6 6" />
        </svg>
      );
    case "archive":
      return (
        <svg {...shared} aria-hidden="true">
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
          <path d="M10 13h4" />
        </svg>
      );
  }
}

function ColumnComponent({
  status,
  tasks,
  onTaskClick,
  onRetryPR,
  onArchiveDone,
  onClearFailed,
  onRetryAllFailed,
  horizontal = false,
  collapsible = false,
  collapsed = false,
  onToggleCollapse,
  fillWidth = false,
  retryQueueMap,
  headerAction,
}: ColumnProps & { headerAction?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = tasks.map((t) => t.id);
  const cfg = columnConfig[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-0 flex flex-col rounded-2xl glass-card border transition-all duration-200 ${
        horizontal ? "w-full" : fillWidth ? "w-full" : "min-w-[272px] w-[272px] shrink-0"
      } ${isOver ? "ring-2 ring-violet-500/40 brightness-105" : ""}`}
    >
      {/* Column header */}
      <div className="px-4 pt-3.5 pb-3 border-b" style={{ borderColor: "var(--glass-border)" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
            <h2
              className="text-[13px] font-semibold tracking-tight"
              style={{ color: "var(--text-primary)" }}
            >
              {TASK_STATUS_LABELS[status]}
            </h2>
            <span
              className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full border ${cfg.countBg} ${cfg.countText}`}
            >
              {tasks.length}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-0.5">
            {headerAction}
            {collapsible && onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={collapsed ? "Expand Scheduled" : "Collapse Scheduled"}
                title={collapsed ? "Expand Scheduled" : "Collapse Scheduled"}
                className="p-1.5 rounded-lg text-dimmed hover:text-warning hover:bg-warning/15 transition-all cursor-pointer"
              >
                <svg
                  aria-hidden="true"
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={collapsed ? "" : "rotate-180"}
                >
                  <path d="m4 6 4 4 4-4" />
                </svg>
              </button>
            )}
            {status === "done" && tasks.length > 0 && onArchiveDone && (
              <button
                type="button"
                onClick={onArchiveDone}
                aria-label="Archive completed"
                title="Archive completed"
                className="p-1.5 rounded-lg text-dimmed hover:text-success hover:bg-success/15 transition-all cursor-pointer"
              >
                <svg
                  aria-hidden="true"
                  xmlns="http://www.w3.org/2000/svg"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3 9 9 7 9-7" />
                  <path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" />
                  <path d="M12 3v3" />
                </svg>
              </button>
            )}
            {status === "failed" && tasks.length > 0 && (
              <>
                {onRetryAllFailed && (
                  <button
                    type="button"
                    onClick={onRetryAllFailed}
                    aria-label="Retry all failed"
                    title="Retry all failed"
                    className="p-1.5 rounded-lg text-dimmed hover:text-info hover:bg-info/15 transition-all cursor-pointer"
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                      <path d="M21 3v5h-5" />
                      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                      <path d="M3 21v-5h5" />
                    </svg>
                  </button>
                )}
                {onClearFailed && (
                  <button
                    type="button"
                    onClick={onClearFailed}
                    aria-label="Clear failures"
                    title="Clear failures"
                    className="p-1.5 rounded-lg text-dimmed hover:text-danger hover:bg-danger/15 transition-all cursor-pointer"
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Cards area */}
      {!collapsed && (
        <div
          className={
            horizontal
              ? "overflow-x-auto px-2.5 py-2.5 min-h-[80px]"
              : "flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2 min-h-[80px]"
          }
        >
          <SortableContext
            items={taskIds}
            strategy={horizontal ? horizontalListSortingStrategy : verticalListSortingStrategy}
          >
            <div className={horizontal ? "flex gap-2" : "space-y-2"}>
              {tasks.map((task) => (
                <div key={task.id} className={horizontal ? "w-[320px] shrink-0" : undefined}>
                  <TaskCard
                    task={task}
                    onClick={onTaskClick}
                    onRetryPR={onRetryPR}
                    retryEntry={retryQueueMap?.get(task.id)}
                  />
                </div>
              ))}
            </div>
          </SortableContext>

          {tasks.length === 0 && (
            <div
              className="flex flex-col items-center justify-center py-8 gap-2 select-none"
              style={{ color: "var(--text-dimmed)" }}
            >
              <span className="opacity-50">
                <EmptyStateIcon icon={cfg.emptyIcon} />
              </span>
              <span className="text-[11px]">{cfg.emptyText}</span>
            </div>
          )}
        </div>
      )}

      {collapsed && (
        <div
          className="px-4 py-2 text-xs border-t"
          style={{ color: "var(--text-muted)", borderColor: "var(--glass-border)" }}
        >
          Column collapsed. {tasks.length} tarefa{tasks.length !== 1 ? "s" : ""} agendada
          {tasks.length !== 1 ? "s" : ""}.
        </div>
      )}
    </div>
  );
}

export const Column = memo(ColumnComponent, (prev, next) => {
  return (
    prev.status === next.status &&
    prev.tasks === next.tasks &&
    prev.onTaskClick === next.onTaskClick &&
    prev.onRetryPR === next.onRetryPR &&
    prev.onArchiveDone === next.onArchiveDone &&
    prev.onClearFailed === next.onClearFailed &&
    prev.onRetryAllFailed === next.onRetryAllFailed &&
    prev.collapsible === next.collapsible &&
    prev.collapsed === next.collapsed &&
    prev.onToggleCollapse === next.onToggleCollapse &&
    prev.retryQueueMap === next.retryQueueMap
  );
});
