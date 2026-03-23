import { useState } from "react";
import type { TaskWithRun, AgentLog } from "@vibe-code/shared";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { AgentOutput } from "./AgentOutput";
import { getProviderFromUrl } from "./ui/git-icons";

interface TaskDetailProps {
  task: TaskWithRun;
  liveLogs: AgentLog[];
  onClose: () => void;
  onLaunch: (taskId: string, engine?: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (taskId: string) => void;
  onSendInput: (taskId: string, input: string) => void;
}

const statusVariant: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  backlog: "default",
  in_progress: "info",
  review: "purple",
  done: "success",
  failed: "danger",
};

const statusLabel: Record<string, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  review: "In Review",
  done: "Done",
  failed: "Failed",
};

function formatDuration(start: string | null, end: string | null): string | null {
  if (!start) return null;
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function TaskDetail({
  task,
  liveLogs,
  onClose,
  onLaunch,
  onCancel,
  onRetry,
  onDelete,
  onSendInput,
}: TaskDetailProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isRunning = task.status === "in_progress" || task.latestRun?.status === "running";
  const provider = task.repo ? getProviderFromUrl(task.repo.url) : null;
  const ProviderIcon = provider?.icon;
  const duration = formatDuration(task.latestRun?.startedAt ?? null, task.latestRun?.finishedAt ?? null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-zinc-900 border-l border-zinc-800 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 px-6 py-4 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            {ProviderIcon && (
              <div className={`mt-0.5 shrink-0 ${provider!.color}`}>
                <ProviderIcon size={20} />
              </div>
            )}
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight">{task.title}</h2>
              {task.repo && (
                <a
                  href={task.repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors truncate block"
                >
                  {task.repo.url}
                </a>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 cursor-pointer text-xl shrink-0">
            &#x2715;
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Status & Badges */}
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={statusVariant[task.status] ?? "default"}>
              {statusLabel[task.status] ?? task.status}
            </Badge>
            {task.engine && <Badge variant="purple">{task.engine}</Badge>}
            {isRunning && (
              <span className="flex items-center gap-1.5 text-xs text-blue-400">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                Running
              </span>
            )}
          </div>

          {/* Repo + Branch info */}
          {task.repo && (
            <div className="bg-zinc-800/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                {ProviderIcon && <ProviderIcon className={provider!.color} size={14} />}
                <span className="text-xs font-medium text-zinc-400">{provider?.name ?? "Repository"}</span>
                <span className="text-xs text-zinc-500">·</span>
                <a
                  href={task.repo.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-zinc-200 hover:text-white transition-colors"
                >
                  {task.repo.name}
                </a>
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-500">
                <div className="flex items-center gap-1.5">
                  <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                    <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 019 8.5H7a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 017 7h2a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                  </svg>
                  <span className="text-zinc-400">base:</span>
                  <code className="text-zinc-300">{task.repo.defaultBranch}</code>
                </div>
                {task.branchName && (
                  <div className="flex items-center gap-1.5">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                      <path d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 019 8.5H7a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 017 7h2a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                    </svg>
                    <span className="text-zinc-400">task:</span>
                    <code className="text-zinc-300">{task.branchName}</code>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-1.5">Description</h3>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">{task.description}</p>
            </div>
          )}

          {/* PR Link */}
          {task.prUrl && (
            <div>
              <h3 className="text-xs font-medium text-zinc-500 mb-1.5">Pull Request</h3>
              <a
                href={task.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-violet-400 hover:text-violet-300 underline break-all"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className="shrink-0">
                  <path d="M7.177 3.073L9.573.677A.25.25 0 0110 .854v4.792a.25.25 0 01-.427.177L7.177 3.427a.25.25 0 010-.354zM3.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122v5.256a2.251 2.251 0 11-1.5 0V5.372A2.25 2.25 0 011.5 3.25zM11 2.5h-1V4h1a1 1 0 011 1v5.628a2.251 2.251 0 101.5 0V5A2.5 2.5 0 0011 2.5zm1 10.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0zM3.75 12a.75.75 0 100 1.5.75.75 0 000-1.5z" />
                </svg>
                {task.prUrl}
              </a>
            </div>
          )}

          {/* Error message */}
          {task.latestRun?.errorMessage && (
            <div className="bg-red-950/40 border border-red-800/50 rounded-lg p-3">
              <h3 className="text-xs font-medium text-red-400 mb-1.5">Error</h3>
              <pre className="text-xs text-red-300 whitespace-pre-wrap break-all font-mono leading-relaxed">
                {task.latestRun.errorMessage}
              </pre>
            </div>
          )}

          {/* Run Stats */}
          {task.latestRun && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-zinc-500">
              {task.latestRun.startedAt && (
                <div>
                  <span className="text-zinc-600">Started </span>
                  {new Date(task.latestRun.startedAt).toLocaleString()}
                </div>
              )}
              {duration && (
                <div>
                  <span className="text-zinc-600">Duration </span>
                  <span className="text-zinc-400">{duration}</span>
                </div>
              )}
              {task.latestRun.exitCode !== null && (
                <div>
                  <span className="text-zinc-600">Exit code </span>
                  <code className={task.latestRun.exitCode === 0 ? "text-green-400" : "text-red-400"}>
                    {task.latestRun.exitCode}
                  </code>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            {(task.status === "backlog" || task.status === "failed") && (
              <Button
                variant="primary"
                disabled={!!loadingAction}
                onClick={async () => {
                  setLoadingAction("launch");
                  try { await onLaunch(task.id); } finally { setLoadingAction(null); }
                }}
              >
                {loadingAction === "launch" ? "Launching..." : "Launch Agent"}
              </Button>
            )}
            {task.status === "failed" && (
              <Button
                variant="outline"
                disabled={!!loadingAction}
                onClick={async () => {
                  setLoadingAction("retry");
                  try { await onRetry(task.id); } finally { setLoadingAction(null); }
                }}
              >
                {loadingAction === "retry" ? "Retrying..." : "Retry"}
              </Button>
            )}
            {task.status === "in_progress" && (
              <Button
                variant="danger"
                disabled={!!loadingAction}
                onClick={async () => {
                  setLoadingAction("cancel");
                  try { await onCancel(task.id); } finally { setLoadingAction(null); }
                }}
              >
                {loadingAction === "cancel" ? "Cancelling..." : "Cancel"}
              </Button>
            )}
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Are you sure?</span>
                <Button variant="danger" onClick={() => onDelete(task.id)}>
                  Confirm Delete
                </Button>
                <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                  No
                </Button>
              </div>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete
              </Button>
            )}
          </div>

          {/* Agent Output */}
          <div>
            <h3 className="text-xs font-medium text-zinc-500 mb-2">Agent Output</h3>
            <AgentOutput
              runId={task.latestRun?.id ?? null}
              liveLogs={liveLogs}
              isRunning={isRunning}
              onSendInput={(input) => onSendInput(task.id, input)}
            />
          </div>

          {/* Timestamps */}
          <div className="text-xs text-zinc-600 space-y-1 pt-2 border-t border-zinc-800">
            <div>Created: {new Date(task.createdAt).toLocaleString()}</div>
            <div>Updated: {new Date(task.updatedAt).toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
