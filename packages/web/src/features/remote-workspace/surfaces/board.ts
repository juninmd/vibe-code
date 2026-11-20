import type { TaskStatus, TaskWithRun } from "@vibe-code/shared";

/** Board lanes, in pipeline order; archived tasks never show on the board. */
export const BOARD_LANES: { status: TaskStatus; label: string }[] = [
  { status: "scheduled", label: "Agendadas" },
  { status: "backlog", label: "A fazer" },
  { status: "in_progress", label: "Em execução" },
  { status: "blocked", label: "Bloqueadas" },
  { status: "review", label: "Em revisão" },
  { status: "done", label: "Concluídas" },
  { status: "failed", label: "Falharam" },
];

export function groupByLane(tasks: TaskWithRun[]): Record<TaskStatus, TaskWithRun[]> {
  const lanes = Object.fromEntries(
    BOARD_LANES.map(({ status }) => [status, [] as TaskWithRun[]])
  ) as Record<TaskStatus, TaskWithRun[]>;
  for (const task of tasks) lanes[task.status]?.push(task);
  for (const lane of Object.values(lanes)) lane.sort((a, b) => a.columnOrder - b.columnOrder);
  return lanes;
}

export type MovePlan =
  | { kind: "launch" }
  | { kind: "update"; status: TaskStatus; columnOrder: number };

/**
 * What moving `task` to `status` means: entering "Em execução" starts the agent (the
 * status follows the run), any other lane just updates the task and appends it.
 */
export function planMove(
  task: TaskWithRun,
  status: TaskStatus,
  lanes: Record<TaskStatus, TaskWithRun[]>
): MovePlan | null {
  if (task.status === status) return null;
  if (status === "in_progress") return { kind: "launch" };
  const lane = lanes[status] ?? [];
  const last = lane.reduce((max, t) => Math.max(max, t.columnOrder), -1);
  return { kind: "update", status, columnOrder: last + 1 };
}
