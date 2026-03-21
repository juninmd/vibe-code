import { useState, useEffect, useCallback } from "react";
import type { TaskWithRun, AgentLog } from "@vibe-code/shared";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AgentOutput } from "./AgentOutput";

interface TaskDetailProps {
  task: TaskWithRun;
  liveLogs: AgentLog[];
  onClose: () => void;
  onLaunch: (taskId: string, engine?: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (taskId: string) => void;
}

const statusVariant: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  backlog: "default",
  in_progress: "info",
  review: "purple",
  done: "success",
  failed: "danger",
};

export function TaskDetail({
  task,
  liveLogs,
  onClose,
  onLaunch,
  onCancel,
  onRetry,
  onDelete,
}: TaskDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-zinc-900 border-l border-zinc-800 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold truncate pr-4">{task.title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 cursor-pointer text-xl">
            &#x2715;
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Status & Meta */}
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant[task.status] ?? "default"}>
              {task.status.replace("_", " ").toUpperCase()}
            </Badge>
            {task.repo && <Badge>{task.repo.name}</Badge>}
            {task.engine && <Badge variant="purple">{task.engine}</Badge>}
          </div>

          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Description</h3>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{task.description}</p>
            </div>
          )}

          {/* PR Link */}
          {task.prUrl && (
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Pull Request</h3>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-violet-400 hover:text-violet-300 underline break-all"
              >
                {task.prUrl}
              </a>
            </div>
          )}

          {/* Branch */}
          {task.branchName && (
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-1">Branch</h3>
              <code className="text-sm text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
                {task.branchName}
              </code>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            {(task.status === "backlog" || task.status === "failed") && (
              <Button variant="primary" onClick={() => onLaunch(task.id)}>
                Launch Agent
              </Button>
            )}
            {task.status === "failed" && (
              <Button variant="outline" onClick={() => onRetry(task.id)}>
                Retry
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button variant="danger" onClick={() => onCancel(task.id)}>
                Cancel
              </Button>
            )}
            <Button variant="ghost" onClick={() => onDelete(task.id)}>
              Delete
            </Button>
          </div>

          {/* Agent Output */}
          <div>
            <h3 className="text-xs font-medium text-zinc-500 mb-2">Agent Output</h3>
            <AgentOutput
              runId={task.latestRun?.id ?? null}
              liveLogs={liveLogs}
            />
          </div>

          {/* Timestamps */}
          <div className="text-xs text-zinc-600 space-y-1">
            <div>Created: {new Date(task.createdAt).toLocaleString()}</div>
            <div>Updated: {new Date(task.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
