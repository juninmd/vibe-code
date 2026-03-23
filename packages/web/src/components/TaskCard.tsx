import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TaskWithRun } from "@vibe-code/shared";
import { Badge } from "./ui/badge";
import { getProviderFromUrl } from "./ui/git-icons";
import { useState } from "react";
import { Button } from "./ui/button";

interface TaskCardProps {
  task: TaskWithRun;
  onClick: () => void;
  onRetryPR: (taskId: string) => void;
}

export function TaskCard({ task, onClick, onRetryPR }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, data: { task } });
  
  const [retrying, setRetrying] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleRetryPR = async (e: React.MouseEvent) => {
    // Stop all propagation and prevent card click
    e.preventDefault();
    e.stopPropagation();
    
    if (retrying) return;
    
    setRetrying(true);
    try {
      await onRetryPR(task.id);
    } catch (err) {
      console.error("Failed to retry PR:", err);
      alert(`PR Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRetrying(false);
    }
  };

  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="bg-zinc-800/80 border border-zinc-700/50 rounded-lg p-3 cursor-grab active:cursor-grabbing hover:border-zinc-600 transition-colors group relative"
    >
      {/* Title row */}
      <div className="flex items-start gap-2 mb-2">
        {ProviderIcon && (
          <span className={`mt-0.5 shrink-0 ${provider!.color}`}>
            <ProviderIcon size={13} />
          </span>
        )}
        <h3 className="text-sm font-medium text-zinc-100 line-clamp-2 flex-1 leading-snug">
          {task.title}
        </h3>
      </div>

      {/* Description */}
      {task.description && (
        <p className="text-xs text-zinc-500 line-clamp-2 mb-2 ml-[21px]">{task.description}</p>
      )}

      {/* Footer */}
      <div className="flex items-center gap-2 flex-wrap ml-[21px]">
        {task.repo && (
          <span className="text-xs text-zinc-500 font-medium">{task.repo.name}</span>
        )}
        {task.branchName && (
          <code className="text-xs text-zinc-600 bg-zinc-900/50 px-1.5 py-0.5 rounded hidden sm:inline">
            {task.branchName}
          </code>
        )}
        {task.engine && (
          <Badge variant="purple" className="text-[10px] py-0 px-1.5">{task.engine}</Badge>
        )}
        {task.status === "failed" && (
          <Badge variant="danger" className="text-[10px] py-0 px-1.5">Failed</Badge>
        )}
        {task.status === "review" && !task.prUrl && (
          <div className="relative z-10" 
               onPointerDown={(e) => e.stopPropagation()} 
               onMouseDown={(e) => e.stopPropagation()}>
            <Button 
              size="xs" 
              variant="primary" 
              className="h-6 text-[10px] px-2 shadow-sm shadow-black/20"
              onClick={handleRetryPR}
              disabled={retrying}
            >
              {retrying ? "Retrying..." : "Retry PR"}
            </Button>
          </div>
        )}
        {task.prUrl && (
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-violet-400 hover:text-violet-300 underline font-medium"
          >
            PR
          </a>
        )}
        {task.latestRun?.status === "running" && (
          <span className="flex items-center gap-1.5 text-[10px] font-medium text-blue-400 ml-auto whitespace-nowrap overflow-hidden max-w-[120px]">
            <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="truncate">
              {task.latestRun.currentStatus || "Running..."}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
