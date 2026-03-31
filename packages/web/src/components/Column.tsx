import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_STATUS_LABELS } from "@vibe-code/shared";
import { TaskCard } from "./TaskCard";

const columnColors: Record<TaskStatus, string> = {
  backlog: "border-zinc-600",
  in_progress: "border-blue-500",
  review: "border-violet-500",
  done: "border-emerald-500",
  failed: "border-red-500",
};

const columnDescriptions: Record<TaskStatus, string> = {
  backlog: "Tasks waiting to be picked up by an AI agent",
  in_progress: "An AI agent is actively working on these tasks",
  review: "Agent finished and a Pull Request is open for review",
  done: "PR merged or task completed",
  failed: "Agent encountered an error",
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

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] w-[280px] shrink-0 rounded-xl bg-zinc-900/50 border-t-2 ${columnColors[status]} ${isOver ? "ring-2 ring-violet-500/40" : ""}`}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-300">{TASK_STATUS_LABELS[status]}</h2>
            <span className="text-xs text-zinc-600 bg-zinc-800 rounded-full px-2 py-0.5">
              {tasks.length}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {status === "done" && tasks.length > 0 && onArchiveDone && (
              <button
                type="button"
                onClick={onArchiveDone}
                title="Archive all done tasks"
                className="p-1 text-zinc-600 hover:text-emerald-500 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
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
                    title="Retry all failed tasks"
                    className="p-1 text-zinc-600 hover:text-blue-500 transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
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
                    title="Clear all failed tasks"
                    className="p-1 text-zinc-600 hover:text-red-500 transition-colors"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
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
        <p className="text-[11px] text-zinc-600 mt-1 leading-tight">{columnDescriptions[status]}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
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
          <div className="text-center py-8 text-zinc-700 text-xs">Drop tasks here</div>
        )}
      </div>
    </div>
  );
}
