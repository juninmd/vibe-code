import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  closestCorners,
} from "@dnd-kit/core";
import { useState, useCallback } from "react";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_COLUMNS } from "@vibe-code/shared";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";

interface BoardProps {
  tasks: TaskWithRun[];
  onTaskClick: (task: TaskWithRun) => void;
  onTaskMove: (taskId: string, newStatus: TaskStatus, newOrder: number) => void;
  onRetryPR: (taskId: string) => void;
}

export function Board({ tasks, onTaskClick, onTaskMove, onRetryPR }: BoardProps) {
  const [activeTask, setActiveTask] = useState<TaskWithRun | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const tasksByColumn = TASK_COLUMNS.reduce(
    (acc, status) => {
      acc[status] = tasks
        .filter((t) => t.status === status)
        .sort((a, b) => a.columnOrder - b.columnOrder);
      return acc;
    },
    {} as Record<TaskStatus, TaskWithRun[]>
  );

  // Also show failed tasks in backlog column
  const failedTasks = tasks.filter((t) => t.status === "failed");
  if (failedTasks.length > 0) {
    tasksByColumn.backlog = [...tasksByColumn.backlog, ...failedTasks];
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const task = (event.active.data.current as any)?.task as TaskWithRun;
    setActiveTask(task ?? null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveTask(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Determine target column
      let targetStatus: TaskStatus;
      if (TASK_COLUMNS.includes(over.id as TaskStatus)) {
        targetStatus = over.id as TaskStatus;
      } else {
        // Dropped on another task - find which column it's in
        const overTask = tasks.find((t) => t.id === over.id);
        if (!overTask) return;
        targetStatus = overTask.status as TaskStatus;
      }

      if (task.status === targetStatus) return;

      // Calculate new order
      const targetTasks = tasksByColumn[targetStatus];
      const newOrder = targetTasks.length > 0
        ? Math.max(...targetTasks.map((t) => t.columnOrder)) + 1
        : 0;

      onTaskMove(taskId, targetStatus, newOrder);
    },
    [tasks, tasksByColumn, onTaskMove]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {TASK_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={tasksByColumn[status]}
            onTaskClick={onTaskClick}
            onRetryPR={onRetryPR}
          />
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-2 opacity-90">
            <TaskCard task={activeTask} onClick={() => {}} onRetryPR={onRetryPR} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
