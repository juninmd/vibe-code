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
}

export function Column({ status, tasks, onTaskClick }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const taskIds = tasks.map((t) => t.id);

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[280px] w-[280px] shrink-0 rounded-xl bg-zinc-900/50 border-t-2 ${columnColors[status]} ${isOver ? "ring-2 ring-violet-500/40" : ""}`}
    >
      <div className="px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300">
            {TASK_STATUS_LABELS[status]}
          </h2>
          <span className="text-xs text-zinc-600 bg-zinc-800 rounded-full px-2 py-0.5">
            {tasks.length}
          </span>
        </div>
        <p className="text-[11px] text-zinc-600 mt-1 leading-tight">
          {columnDescriptions[status]}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2">
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="text-center py-8 text-zinc-700 text-xs">
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  );
}
