import type { AgentLog, EngineInfo, Repository, TaskWithRun } from "@vibe-code/shared";
import { HARNESS_ENGINES, REMOTE_SESSION_TAG } from "@vibe-code/shared";
import { useState } from "react";
import { CodeComposer } from "./CodeComposer";
import { sessionLabel } from "./chat";
import { SessionGrid } from "./SessionGrid";
import { SessionSetup } from "./SessionSetup";
import { SessionSidebar } from "./SessionSidebar";
import { SessionThread } from "./SessionThread";

export interface NewRemoteSession {
  description: string;
  repoId: string;
  engine: string;
  model?: string;
  baseBranch?: string;
}
export interface CodeModeProps {
  tasks: TaskWithRun[];
  repos: Repository[];
  engines: EngineInfo[];
  selectedRepoId: string | null;
  selectedTask: TaskWithRun | null;
  liveLogs: AgentLog[];
  connected: boolean;
  loading: boolean;
  busy: boolean;
  onOpenSession: (task: TaskWithRun) => void;
  onCloseSession: () => void;
  onCreateSession: (input: NewRemoteSession) => Promise<void>;
  onSendInput: (taskId: string, text: string) => void | Promise<void>;
  onStart: (taskId: string) => Promise<void>;
  onStop: (taskId: string) => Promise<void>;
  onDetails: (task: TaskWithRun) => void;
  onManage: () => void;
  onAddRepo: () => void;
}

export function CodeMode(props: CodeModeProps) {
  const { tasks, repos, engines, selectedTask, connected, loading, busy } = props;
  const [overview, setOverview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [setup, setSetup] = useState({ repoId: "", engine: "opencode", model: "", baseBranch: "" });
  const readyRepos = repos.filter((r) => r.status === "ready");
  const repoId = readyRepos.some((r) => r.id === setup.repoId)
    ? setup.repoId
    : (readyRepos.find((r) => r.id === props.selectedRepoId)?.id ?? readyRepos[0]?.id ?? "");
  const repo = selectedTask?.repo ?? repos.find((r) => r.id === repoId);
  const baseBranch = repoId === setup.repoId ? setup.baseBranch : "";
  const engine = engines.find((e) => e.name === setup.engine);
  const running = selectedTask?.status === "in_progress";
  const remote = selectedTask?.tags.includes(REMOTE_SESSION_TAG);
  const active = tasks.filter((t) => t.status === "in_progress");
  const newSession = () => {
    setOverview(false);
    setShowHistory(false);
    props.onCloseSession();
  };
  return (
    <div className="code-workbench flex h-full min-h-0">
      <SessionSidebar
        tasks={tasks}
        selectedId={selectedTask?.id}
        loading={loading}
        connected={connected}
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onNew={newSession}
        onOpen={(task) => {
          setOverview(false);
          setShowHistory(false);
          props.onOpenSession(task);
        }}
        onOverview={() => {
          setOverview(true);
          setShowHistory(false);
        }}
        onManage={props.onManage}
      />
      <section aria-label="Coding workspace" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-default px-4">
          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="code-icon-button md:hidden"
            aria-label="Session history"
          >
            ☰
          </button>
          <span className="min-w-0 flex-1 truncate text-sm text-secondary">
            {overview
              ? "Session overview"
              : selectedTask
                ? sessionLabel(selectedTask)
                : "New session"}
          </span>
          <span className="hidden text-xs text-muted sm:block">
            {selectedTask?.latestRun?.engine ?? "Remote development"}
          </span>
          <button
            type="button"
            onClick={() => setShowContext(!showContext)}
            aria-expanded={showContext}
            className="code-icon-button xl:hidden"
            aria-label="Toggle session context"
          >
            ◫
          </button>
        </header>
        {overview ? (
          <SessionGrid
            tasks={tasks}
            loading={loading}
            connected={connected}
            onOpen={(task) => {
              setOverview(false);
              props.onOpenSession(task);
            }}
            onStop={(id) => void props.onStop(id)}
          />
        ) : selectedTask ? (
          <>
            <SessionThread
              task={selectedTask}
              logs={props.liveLogs}
              connected={connected}
              busy={busy}
              onBack={newSession}
              onStop={() => void props.onStop(selectedTask.id)}
              onStart={() => void props.onStart(selectedTask.id)}
              onDetails={() => props.onDetails(selectedTask)}
            />
            <div className="code-composer-slot">
              <CodeComposer
                key={selectedTask.id}
                placeholder={
                  remote
                    ? running
                      ? "Agent is working…"
                      : "Continue this session…"
                    : running
                      ? "Reply to the agent…"
                      : "Session is idle"
                }
                hint={
                  !connected
                    ? "Reconnecting to the server…"
                    : remote
                      ? running
                        ? "Wait for the response, or stop the turn to change direction."
                        : "Your next message continues in the same workspace."
                      : "Use Start to resume the autonomous run."
                }
                busy={busy}
                disabled={!connected || (remote ? running : !running)}
                onSubmit={(text) => props.onSendInput(selectedTask.id, text)}
              />
              <div className="code-composer-meta">
                <span>
                  {repo?.name} /{" "}
                  {selectedTask.branchName ?? selectedTask.baseBranch ?? repo?.defaultBranch}
                </span>
                <span>{selectedTask.model ?? "Default model"}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-5 py-8 text-center">
              <span aria-hidden="true" className="mb-6 font-mono text-3xl text-accent-text">
                [ / ]
              </span>
              <h1 className="text-2xl font-medium tracking-tight text-primary sm:text-3xl">
                What will you build?
              </h1>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
                Choose a repository. Describe a change.
                <br />
                Continue coding from wherever you are.
              </p>
              <div className="mt-8 flex items-center gap-2 rounded-lg border border-default px-4 py-3 text-xs text-secondary">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-success" : "bg-warning"}`}
                />
                {connected
                  ? "Connected to your development server"
                  : "Connecting to your development server…"}
              </div>
              {!loading && readyRepos.length === 0 && (
                <button
                  type="button"
                  onClick={props.onAddRepo}
                  className="mt-5 text-sm text-accent-text underline underline-offset-4"
                >
                  Add a repository to get started
                </button>
              )}
            </div>
            <div className="code-composer-slot">
              <CodeComposer
                key="new-session"
                placeholder="Describe a task…"
                autoFocus
                busy={busy}
                disabled={
                  !connected ||
                  !repoId ||
                  !engine?.available ||
                  !!engine.setupIssue ||
                  engine?.supportsResume === false
                }
                hint={
                  !connected
                    ? "Reconnecting to the server…"
                    : (engine?.setupIssue ??
                      (engine?.supportsResume === false
                        ? "This engine cannot continue a conversation. Choose a resumable engine below."
                        : !engine?.available
                          ? "Configure OpenCode or select an available engine below."
                          : undefined))
                }
                onSubmit={(description) =>
                  props.onCreateSession({
                    description,
                    repoId,
                    engine: setup.engine,
                    model: setup.model || undefined,
                    baseBranch: baseBranch || repo?.defaultBranch,
                  })
                }
              />
              <SessionSetup
                repos={readyRepos}
                engines={engines.filter((e) => HARNESS_ENGINES.some((name) => name === e.name))}
                value={{ ...setup, repoId, baseBranch }}
                onChange={setSetup}
              />
            </div>
          </>
        )}
      </section>
      <aside
        aria-label="Session context"
        className={`${showContext ? "flex absolute inset-y-0 right-0 z-20 w-72 shadow-xl" : "hidden"} code-context xl:static xl:flex xl:w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-default bg-app p-4`}
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-secondary">Session context</span>
          <button
            type="button"
            className="code-icon-button xl:hidden"
            aria-label="Close session context"
            onClick={() => setShowContext(false)}
          >
            ×
          </button>
        </div>
        <div className="code-context-card">
          <h2>Environment</h2>
          <p>Development server</p>
          <p className="text-muted">{repo?.name ?? "No repository selected"}</p>
          <p className="break-all font-mono text-[11px] text-muted">
            {selectedTask?.branchName ?? (baseBranch || repo?.defaultBranch)}
          </p>
          <span className="mt-2 block text-[11px] text-muted">
            {selectedTask?.latestRun?.engine ?? engine?.displayName ?? "OpenCode"} · isolated
            worktree
          </span>
        </div>
        {selectedTask && (
          <div className="code-context-card">
            <h2>Changes & validation</h2>
            <p className="text-muted">
              {remote
                ? "Ask the agent to run checks and explain its changes before publishing."
                : "Review execution details and validation evidence."}
            </p>
            <button
              type="button"
              onClick={() => props.onDetails(selectedTask)}
              className="mt-3 text-xs text-accent-text"
            >
              Open changes & details →
            </button>
            {selectedTask.prUrl && (
              <a
                className="mt-3 block text-xs text-accent-text"
                href={selectedTask.prUrl}
                target="_blank"
                rel="noreferrer"
              >
                View pull request ↗
              </a>
            )}
          </div>
        )}
        <div className="code-context-card">
          <h2>
            Background sessions <span className="text-muted">{active.length}</span>
          </h2>
          {active.length === 0 ? (
            <p className="text-muted">No agents running.</p>
          ) : (
            active.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  setOverview(false);
                  props.onOpenSession(task);
                  setShowContext(false);
                }}
                className="flex w-full items-center gap-2 py-2 text-left text-xs"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-info" />
                <span className="truncate">{sessionLabel(task)}</span>
              </button>
            ))
          )}
        </div>
        <p className="mt-auto text-[11px] leading-relaxed text-muted">
          Sessions run on your server. Close this window and return to the conversation later.
        </p>
      </aside>
    </div>
  );
}
