import {
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";
import { TASK_COLUMNS } from "@vibe-code/shared";
import type { RetryState } from "../hooks/useRetryQueue";

const BOARD_COLUMNS: TaskStatus[] = [...TASK_COLUMNS, "failed"];

import { useCallback, useMemo, useState } from "react";
import { Column } from "./Column";
import { TaskCard } from "./TaskCard";

interface BoardProps {
  tasks: TaskWithRun[];
  onTaskClick: (task: TaskWithRun) => void;
  onTaskMove: (taskId: string, newStatus: TaskStatus, newOrder: number) => void | Promise<void>;
  onRetryPR: (taskId: string) => void;
  onUnblock?: (taskId: string) => void;
  onArchiveDone?: () => void;
  onClearFailed?: () => void;
  onRetryAllFailed?: () => void;
  onDeleteTasks?: (taskIds: string[]) => void | Promise<void>;
  retryQueueMap?: Map<string, RetryState>;
  onNewTask?: () => void;
}

export function Board({
  tasks,
  onTaskClick,
  onTaskMove,
  onRetryPR,
  onUnblock,
  onArchiveDone,
  onClearFailed,
  onRetryAllFailed,
  onDeleteTasks,
  retryQueueMap,
  onNewTask: _onNewTask,
}: BoardProps) {
  const [activeTask, setActiveTask] = useState<TaskWithRun | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const noopTaskClick = useCallback(() => {}, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    // On touch, require a short press-and-hold so taps and vertical/horizontal
    // scrolling are not hijacked by drag start.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } })
  );

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

  const hiddenRails = useMemo(
    () => [
      {
        id: "scheduled",
        label: "Scheduled",
        count: tasksByColumn.scheduled.length,
        hint: "Template lane",
      },
      {
        id: "failed",
        label: "Failed",
        count: tasksByColumn.failed.length,
        hint: "Needs recovery",
      },
    ],
    [tasksByColumn.failed.length, tasksByColumn.scheduled.length]
  );

  const handleSelectionModeChange = useCallback((enabled: boolean) => {
    setSelectionMode(enabled);
    if (!enabled) setSelectedTaskIds(new Set());
  }, []);

  const handleTaskSelectionChange = useCallback((taskId: string, selected: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (selected) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const handleSelectColumn = useCallback((taskIds: string[]) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      const allSelected = taskIds.every((id) => next.has(id));
      for (const id of taskIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    if (!onDeleteTasks || selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    if (
      !window.confirm(
        `Excluir ${ids.length} card${ids.length === 1 ? "" : "s"} selecionado${ids.length === 1 ? "" : "s"}?`
      )
    ) {
      return;
    }
    await onDeleteTasks(ids);
    setSelectedTaskIds(new Set());
    setSelectionMode(false);
  }, [onDeleteTasks, selectedTaskIds]);

  const handleDeleteColumn = useCallback(
    async (status: TaskStatus, taskIds: string[]) => {
      if (!onDeleteTasks || taskIds.length === 0) return;
      if (status === "in_progress") return;
      const label = status.replace("_", " ");
      if (!window.confirm(`Excluir todos os ${taskIds.length} cards da coluna ${label}?`)) {
        return;
      }
      await onDeleteTasks(taskIds);
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        for (const id of taskIds) next.delete(id);
        return next;
      });
    },
    [onDeleteTasks]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex flex-col gap-4 pb-4 h-full">
        {/* Main columns — horizontally scrollable + snap on mobile, fill width on desktop */}
        <div className="flex gap-3 flex-1 min-h-0 min-w-0 overflow-x-auto md:overflow-hidden touch-scroll-x -mx-1 px-1 md:mx-0 md:px-0">
          {BOARD_COLUMNS.filter(
            (status) =>
              status !== "scheduled" && (status !== "failed" || tasksByColumn[status].length > 0)
          ).map((status) => (
            <div
              key={status}
              className="snap-col w-[82vw] max-w-[320px] shrink-0 md:w-auto md:max-w-none md:flex-1 md:min-w-[220px] md:shrink min-h-0 flex flex-col overflow-hidden"
            >
              <Column
                status={status}
                tasks={tasksByColumn[status]}
                onTaskClick={onTaskClick}
                onRetryPR={onRetryPR}
                onUnblock={onUnblock}
                onArchiveDone={onArchiveDone}
                onClearFailed={onClearFailed}
                onRetryAllFailed={onRetryAllFailed}
                selectionMode={selectionMode}
                selectedTaskIds={selectedTaskIds}
                onSelectionModeChange={handleSelectionModeChange}
                onTaskSelectionChange={handleTaskSelectionChange}
                onSelectColumn={handleSelectColumn}
                onDeleteSelected={handleDeleteSelected}
                onDeleteColumn={handleDeleteColumn}
                retryQueueMap={retryQueueMap}
                fillWidth
              />
            </div>
          ))}
        </div>

        <div className="flex gap-2 shrink-0 overflow-x-auto no-scrollbar">
          {hiddenRails.map((rail) => (
            <div
              key={rail.id}
              className="rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-3 py-2 min-w-[160px] shrink-0"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-dimmed">
                  {rail.label}
                </span>
                <span
                  className={`text-[10px] font-bold ${rail.count > 0 ? "text-warning" : "text-dimmed"}`}
                >
                  {rail.count}
                </span>
              </div>
              <p className="text-[10px] text-dimmed mt-1">{rail.hint}</p>
            </div>
          ))}
        </div>
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
