import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskWithRun } from "@vibe-code/shared";
import { Badge } from "./ui/badge";

const statusBadge: Record<string, { variant: "default" | "success" | "warning" | "danger" | "info" | "purple"; label: string }> = {
  backlog: { variant: "default", label: "Backlog" },
  in_progress: { variant: "info", label: "Running" },
  review: { variant: "purple", label: "Review" },
  done: { variant: "success", label: "Done" },
  failed: { variant: "danger", label: "Failed" },
};

interface TaskCardProps {
  task: TaskWithRun;
  onClick: () => void;
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { task } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const badge = statusBadge[task.status] ?? statusBadge.backlog;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-zinc-600 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <h3 className="text-sm font-medium text-zinc-100 line-clamp-2 flex-1">
          {task.title}
        </h3>
        {task.status === "failed" && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>

      {task.description && (
        <p className="text-xs text-zinc-500 line-clamp-2 mb-2">{task.description}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {task.repo && (
          <Badge variant="default">{task.repo.name}</Badge>
        )}
        {task.engine && (
          <Badge variant="purple">{task.engine}</Badge>
        )}
        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-violet-400 hover:text-violet-300 underline"
          >
            PR
          </a>
        )}
        {task.latestRun?.status === "running" && (
          <span className="flex items-center gap-1 text-xs text-blue-400">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Running
          </span>
        )}
      </div>
    </div>
  );
}
