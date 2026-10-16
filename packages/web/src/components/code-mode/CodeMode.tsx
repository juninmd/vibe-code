import type { AgentLog, Repository, TaskWithRun } from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { CodeComposer } from "./CodeComposer";
import { SessionList } from "./SessionList";
import { SessionThread } from "./SessionThread";

export interface CodeModeProps {
  tasks: TaskWithRun[];
  repos: Repository[];
  selectedRepoId: string | null;
  selectedTask: TaskWithRun | null;
  liveLogs: AgentLog[];
  connected: boolean;
  loading: boolean;
  busy: boolean;
  onSelectRepo: (repoId: string | null) => void;
  onOpenSession: (task: TaskWithRun) => void;
  onCloseSession: () => void;
  onCreateSession: (input: { description: string; repoId: string }) => Promise<void>;
  onSendInput: (taskId: string, text: string) => void;
  onStart: (taskId: string) => Promise<void>;
  onStop: (taskId: string) => Promise<void>;
  onDetails: (task: TaskWithRun) => void;
}

/**
 * Code mode — a mobile-first remote control surface. The operator types a task
 * and the harness creates + names the session; opening a session shows the live
 * transcript with a reply composer.
 */
export function CodeMode({
  tasks,
  repos,
  selectedRepoId,
  selectedTask,
  liveLogs,
  connected,
  loading,
  busy,
  onSelectRepo,
  onOpenSession,
  onCloseSession,
  onCreateSession,
  onSendInput,
  onStart,
  onStop,
  onDetails,
}: CodeModeProps) {
  const readyRepos = useMemo(
    () => repos.filter((repo) => repo.status === "ready" || repo.status === "cloning"),
    [repos]
  );

  const defaultRepoId = useMemo(() => {
    if (selectedRepoId && readyRepos.some((r) => r.id === selectedRepoId)) return selectedRepoId;
    return readyRepos[0]?.id ?? null;
  }, [selectedRepoId, readyRepos]);

  const [composeRepoId, setComposeRepoId] = useState<string | null>(defaultRepoId);
  // Keep the picker in sync when the workspace repo changes.
  const effectiveRepoId = useMemo(
    () =>
      composeRepoId && readyRepos.some((r) => r.id === composeRepoId)
        ? composeRepoId
        : defaultRepoId,
    [composeRepoId, readyRepos, defaultRepoId]
  );

  const running = selectedTask?.status === "in_progress";
  const canCompose = connected && !busy;

  if (selectedTask) {
    return (
      <div className="flex h-full min-h-0 flex-1 flex-col">
        <SessionThread
          task={selectedTask}
          logs={liveLogs}
          connected={connected}
          busy={busy}
          onBack={onCloseSession}
          onStop={() => {
            void onStop(selectedTask.id);
          }}
          onStart={() => {
            void onStart(selectedTask.id);
          }}
          onDetails={() => onDetails(selectedTask)}
        />
        <CodeComposer
          placeholder={running ? "Reply to the agent…" : "Session is idle"}
          hint={running ? undefined : "Press Start to resume this session with the harness."}
          busy={busy}
          disabled={!running || !canCompose}
          onSubmit={(text) => onSendInput(selectedTask.id, text)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-4 pb-1 pt-3">
        <h2 className="text-sm font-semibold text-primary">Sessions</h2>
        <span className="text-[11px] text-muted">{connected ? "Live" : "Reconnecting…"}</span>
      </div>

      <SessionList
        tasks={tasks}
        repos={repos}
        selectedRepoId={selectedRepoId}
        onSelectRepo={onSelectRepo}
        onOpen={onOpenSession}
        loading={loading}
      />

      <CodeComposer
        placeholder="Describe a task…"
        autoFocus
        busy={busy}
        disabled={!canCompose || readyRepos.length === 0}
        hint={readyRepos.length === 0 ? "Add a repository to start a session." : undefined}
        leading={
          readyRepos.length > 0 ? (
            <select
              aria-label="Repository"
              value={effectiveRepoId ?? ""}
              onChange={(e) => setComposeRepoId(e.target.value)}
              className="max-w-[7.5rem] truncate rounded-xl border border-default bg-input/60 px-2 py-2 text-xs text-secondary outline-none focus:border-accent/40"
            >
              {readyRepos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </select>
          ) : null
        }
        onSubmit={(text) => {
          if (!effectiveRepoId) return;
          void onCreateSession({ description: text, repoId: effectiveRepoId });
        }}
      />
    </div>
  );
}
