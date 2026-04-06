import { useDroppable } from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_STATUS_LABELS } from "@vibe-code/shared";
import { memo } from "react";
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
    countBg: "bg-amber-950/60 border-amber-800/40",
    countText: "text-amber-300",
    emptyIcon: "clock",
    emptyText: "Nenhuma tarefa agendada",
  },
  backlog: {
    dot: "bg-zinc-500",
    countBg: "bg-zinc-800/60 border-zinc-700/40",
    countText: "text-zinc-400",
    emptyIcon: "list",
    emptyText: "Adicione tarefas aqui",
  },
  in_progress: {
    dot: "bg-blue-400",
    countBg: "bg-blue-950/60 border-blue-800/40",
    countText: "text-blue-300",
    emptyIcon: "play",
    emptyText: "Nenhum agente rodando",
  },
  review: {
    dot: "bg-violet-400",
    countBg: "bg-violet-950/60 border-violet-800/40",
    countText: "text-violet-300",
    emptyIcon: "eye",
    emptyText: "Nada aguardando revisão",
  },
  done: {
    dot: "bg-emerald-400",
    countBg: "bg-emerald-950/60 border-emerald-800/40",
    countText: "text-emerald-300",
    emptyIcon: "check",
    emptyText: "Nenhuma tarefa concluída",
  },
  failed: {
    dot: "bg-red-400",
    countBg: "bg-red-950/60 border-red-800/40",
    countText: "text-red-300",
    emptyIcon: "x",
    emptyText: "Sem falhas",
  },
  archived: {
    dot: "bg-zinc-600",
    countBg: "bg-zinc-800/60 border-zinc-700/40",
    countText: "text-zinc-500",
    emptyIcon: "archive",
    emptyText: "Nenhum arquivo",
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
}

function EmptyStateIcon({ icon }: { icon: (typeof columnConfig)[TaskStatus]["emptyIcon"] }) {
  const shared = {
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
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "list":
      return (
        <svg {...shared}>
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
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="m10 8 6 4-6 4z" />
        </svg>
      );
    case "eye":
      return (
        <svg {...shared}>
          <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12 2.5 2.5L16 9" />
        </svg>
      );
    case "x":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6" />
          <path d="m15 9-6 6" />
        </svg>
      );
    case "archive":
      return (
        <svg {...shared}>
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
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = tasks.map((t) => t.id);
  const cfg = columnConfig[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col rounded-2xl glass-card border transition-all duration-200 ${
        horizontal ? "w-full" : "min-w-[272px] w-[272px] shrink-0"
      } ${isOver ? "ring-2 ring-violet-500/40 brightness-105" : ""}`}
    >
      {/* Column header */}
      <div className="px-4 pt-3.5 pb-3 border-b border-white/[0.05]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
            <h2 className="text-[13px] font-semibold text-zinc-200 tracking-tight">
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
            {status === "done" && tasks.length > 0 && onArchiveDone && (
              <button
                type="button"
                onClick={onArchiveDone}
                title="Arquivar concluídas"
                className="p-1.5 rounded-lg text-zinc-600 hover:text-emerald-400 hover:bg-emerald-950/30 transition-all cursor-pointer"
              >
                <svg
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
                    title="Retry todas as falhas"
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-blue-400 hover:bg-blue-950/30 transition-all cursor-pointer"
                  >
                    <svg
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
                    title="Limpar falhas"
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-950/30 transition-all cursor-pointer"
                  >
                    <svg
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
                <TaskCard task={task} onClick={onTaskClick} onRetryPR={onRetryPR} />
              </div>
            ))}
          </div>
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-700 select-none">
            <span className="opacity-50">
              <EmptyStateIcon icon={cfg.emptyIcon} />
            </span>
            <span className="text-[11px]">{cfg.emptyText}</span>
          </div>
        )}
      </div>
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
    prev.onRetryAllFailed === next.onRetryAllFailed
  );
});
