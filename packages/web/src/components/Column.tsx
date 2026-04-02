import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_STATUS_LABELS } from "@vibe-code/shared";
import { TaskCard } from "./TaskCard";

// ─── Column visual config ──────────────────────────────────────────────────────

const columnConfig: Record<
  TaskStatus,
  { dot: string; countBg: string; countText: string; emptyIcon: string; emptyText: string }
> = {
  scheduled: {
    dot: "bg-amber-400",
    countBg: "bg-amber-950/60 border-amber-800/40",
    countText: "text-amber-300",
    emptyIcon: "⏰",
    emptyText: "Nenhuma tarefa agendada",
  },
  backlog: {
    dot: "bg-zinc-500",
    countBg: "bg-zinc-800/60 border-zinc-700/40",
    countText: "text-zinc-400",
    emptyIcon: "📋",
    emptyText: "Adicione tarefas aqui",
  },
  in_progress: {
    dot: "bg-blue-400",
    countBg: "bg-blue-950/60 border-blue-800/40",
    countText: "text-blue-300",
    emptyIcon: "▶",
    emptyText: "Nenhum agente rodando",
  },
  review: {
    dot: "bg-violet-400",
    countBg: "bg-violet-950/60 border-violet-800/40",
    countText: "text-violet-300",
    emptyIcon: "👁",
    emptyText: "Nada aguardando revisão",
  },
  done: {
    dot: "bg-emerald-400",
    countBg: "bg-emerald-950/60 border-emerald-800/40",
    countText: "text-emerald-300",
    emptyIcon: "✓",
    emptyText: "Nenhuma tarefa concluída",
  },
  failed: {
    dot: "bg-red-400",
    countBg: "bg-red-950/60 border-red-800/40",
    countText: "text-red-300",
    emptyIcon: "✕",
    emptyText: "Sem falhas",
  },
  archived: {
    dot: "bg-zinc-600",
    countBg: "bg-zinc-800/60 border-zinc-700/40",
    countText: "text-zinc-500",
    emptyIcon: "📦",
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
}

export function Column({
  status,
  tasks,
  onTaskClick,
  onRetryPR,
  onArchiveDone,
  onClearFailed,
  onRetryAllFailed,
}: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = tasks.map((t) => t.id);
  const cfg = columnConfig[status];

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[272px] w-[272px] shrink-0 rounded-2xl glass-card border transition-all duration-200 ${
        isOver ? "ring-2 ring-violet-500/40 brightness-105" : ""
      }`}
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
      <div className="flex-1 overflow-y-auto px-2.5 py-2.5 space-y-2 min-h-[80px]">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              onRetryPR={onRetryPR}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-zinc-700 select-none">
            <span className="text-2xl opacity-40">{cfg.emptyIcon}</span>
            <span className="text-[11px]">{cfg.emptyText}</span>
          </div>
        )}
      </div>
    </div>
  );
}
