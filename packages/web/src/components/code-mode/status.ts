import type { TaskStatus } from "@vibe-code/shared";

export interface SessionStatusMeta {
  label: string;
  dot: string;
  text: string;
  bg: string;
  border: string;
  pulse: boolean;
}

const META: Record<TaskStatus, SessionStatusMeta> = {
  in_progress: {
    label: "Working",
    dot: "bg-info",
    text: "text-info",
    bg: "bg-info/10",
    border: "border-info/25",
    pulse: true,
  },
  review: {
    label: "Review",
    dot: "bg-violet-400",
    text: "text-violet-300",
    bg: "bg-violet-500/10",
    border: "border-violet-500/25",
    pulse: false,
  },
  done: {
    label: "Done",
    dot: "bg-success",
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/25",
    pulse: false,
  },
  failed: {
    label: "Failed",
    dot: "bg-danger",
    text: "text-danger",
    bg: "bg-danger/10",
    border: "border-danger/25",
    pulse: false,
  },
  blocked: {
    label: "Blocked",
    dot: "bg-warning",
    text: "text-warning",
    bg: "bg-warning/10",
    border: "border-warning/25",
    pulse: false,
  },
  backlog: {
    label: "Queued",
    dot: "bg-muted",
    text: "text-secondary",
    bg: "bg-surface-hover",
    border: "border-default",
    pulse: false,
  },
  scheduled: {
    label: "Scheduled",
    dot: "bg-info/70",
    text: "text-secondary",
    bg: "bg-surface-hover",
    border: "border-default",
    pulse: false,
  },
  archived: {
    label: "Archived",
    dot: "bg-dimmed",
    text: "text-dimmed",
    bg: "bg-surface-hover",
    border: "border-subtle",
    pulse: false,
  },
};

export function sessionStatusMeta(status: TaskStatus): SessionStatusMeta {
  return META[status] ?? META.backlog;
}
