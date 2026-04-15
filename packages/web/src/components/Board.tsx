import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_COLUMNS } from "@vibe-code/shared";

const BOARD_COLUMNS: TaskStatus[] = [...TASK_COLUMNS, "failed"];

import { useCallback, useMemo, useState } from "react";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";

const SCHEDULED_COLLAPSED_KEY = "vibe-code-scheduled-collapsed";

interface BoardProps {
  tasks: TaskWithRun[];
  onTaskClick: (task: TaskWithRun) => void;
  onTaskMove: (taskId: string, newStatus: TaskStatus, newOrder: number) => void;
  onRetryPR: (taskId: string) => void;
  onArchiveDone?: () => void;
  onClearFailed?: () => void;
  onRetryAllFailed?: () => void;
}

export function Board({
  tasks,
  onTaskClick,
  onTaskMove,
  onRetryPR,
  onArchiveDone,
  onClearFailed,
  onRetryAllFailed,
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<TaskWithRun | null>(null);
  const [scheduledCollapsed, setScheduledCollapsed] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(SCHEDULED_COLLAPSED_KEY);
    // Default to collapsed (true) unless explicitly set to "0"
    return stored !== "0";
  });
  const noopTaskClick = useCallback(() => {}, []);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const tasksByColumn = useMemo(
    () =>
      BOARD_COLUMNS.reduce(
        (acc, status) => {
          acc[status] = tasks
            .filter((t) => t.status === status)
            .sort((a, b) => a.columnOrder - b.columnOrder);
          return acc;
        },
        {} as Record<TaskStatus, TaskWithRun[]>
      ),
    [tasks]
  );

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
      // Scheduled template tasks cannot be dragged to other columns
      if (task.status === "scheduled") return;
      // Tasks cannot be manually moved to scheduled templates
      if (targetStatus === "scheduled") return;

      // Calculate new order
      const targetTasks = tasksByColumn[targetStatus];
      const newOrder =
        targetTasks.length > 0 ? Math.max(...targetTasks.map((t) => t.columnOrder)) + 1 : 0;

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
      <div className="flex flex-col gap-4 pb-4 h-full">
        {/* Main columns — fill all available horizontal space */}
        <div className="flex gap-3 flex-1 min-h-0 min-w-0 overflow-hidden">
          {BOARD_COLUMNS.filter(
            (status) =>
              status !== "scheduled" && (status !== "failed" || tasksByColumn[status].length > 0)
          ).map((status) => (
            <div key={status} className="flex-1 min-w-[220px] flex flex-col overflow-hidden">
              <Column
                status={status}
                tasks={tasksByColumn[status]}
                onTaskClick={onTaskClick}
                onRetryPR={onRetryPR}
                onArchiveDone={onArchiveDone}
                onClearFailed={onClearFailed}
                onRetryAllFailed={onRetryAllFailed}
                fillWidth
              />
            </div>
          ))}
        </div>

        {/* Scheduled tasks — collapsible strip at the bottom */}
        <Column
          status="scheduled"
          tasks={tasksByColumn.scheduled}
          onTaskClick={onTaskClick}
          onRetryPR={onRetryPR}
          horizontal
          collapsible
          collapsed={scheduledCollapsed}
          onToggleCollapse={() => {
            setScheduledCollapsed((prev) => {
              const next = !prev;
              if (typeof window !== "undefined") {
                window.localStorage.setItem(SCHEDULED_COLLAPSED_KEY, next ? "1" : "0");
              }
              return next;
            });
          }}
        />
      </div>

      <DragOverlay>
        {activeTask ? (
          <div className="rotate-2 opacity-90">
            <TaskCard task={activeTask} onClick={noopTaskClick} onRetryPR={onRetryPR} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
