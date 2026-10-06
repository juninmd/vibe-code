import {
  type EngineInfo,
  HARNESS_ENGINES,
  type HarnessEngine,
  type SkillEntry,
  type TaskWithRun,
  type TerminalState,
  type WsClientMessage,
} from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { subscribeTerminal } from "../hooks/terminalBus";
import { useSkillPlan } from "../hooks/useSkillPlan";
import { DiffViewer } from "./DiffViewer";
import { PluginChips } from "./PluginChips";
import { picksOf, SkillPicker } from "./SkillPicker";
import { TaskTerminal, type TaskTerminalHandle } from "./TaskTerminal";
import { Button } from "./ui/button";
import { getEngineMeta } from "./ui/engine-icons";

type Tab = "terminal" | "changes" | "details";
type Choice = HarnessEngine | "shell";

const CHOICES: Choice[] = [...HARNESS_ENGINES, "shell"];
const CHOICE_LABEL: Record<Choice, string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
  shell: "Shell",
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  backlog: { label: "Todo", className: "text-text-secondary" },
  scheduled: { label: "Scheduled", className: "text-warning" },
  in_progress: { label: "Stopped", className: "text-warning" },
  review: { label: "Review", className: "text-accent-text" },
  done: { label: "Done", className: "text-success" },
  failed: { label: "Failed", className: "text-danger" },
  blocked: { label: "Blocked", className: "text-warning" },
};

export interface TaskPanelProps {
  task: TaskWithRun;
  engines: EngineInfo[];
  connected: boolean;
  onWsSend: (message: WsClientMessage) => void;
  onClose: () => void;
  onRetryPR: (taskId: string) => Promise<void> | void;
  /** Opens the legacy execution/reviews/telemetry view. */
  onOpenAdvanced: () => void;
  onClone: (taskId: string) => Promise<void> | void;
  onDelete: (taskId: string) => Promise<void> | void;
  onNotify: (message: string, kind: "success" | "error" | "info") => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function TaskPanel({
  task,
  engines,
  connected,
  onWsSend,
  onClose,
  onRetryPR,
  onOpenAdvanced,
  onClone,
  onDelete,
  onNotify,
}: TaskPanelProps) {
  const terminalRef = useRef<TaskTerminalHandle>(null);
  const [tab, setTab] = useState<Tab>("terminal");
  const [state, setState] = useState<TerminalState | null>(null);
  const [hasOutput, setHasOutput] = useState(false);
  const [busy, setBusy] = useState<"start" | "stop" | "finish" | "pr" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const [catalog, setCatalog] = useState<SkillEntry[]>([]);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");

  const live = state?.live ?? false;
  const skillPlan = useSkillPlan({
    taskId: task.id,
    state,
    onState: setState,
    onError: (err) => onNotify(errorMessage(err), "error"),
  });
  const available = useMemo(
    () => new Set(engines.filter((engine) => engine.available).map((engine) => engine.name)),
    [engines]
  );
  const isAvailable = (value: Choice) => value === "shell" || available.has(value);

  // ── Terminal state ────────────────────────────────────────────────────────
  const refreshState = useCallback(() => {
    api.terminal
      .state(task.id)
      .then(setState)
      .catch(() => {});
  }, [task.id]);

  useEffect(() => {
    setState(null);
    setHasOutput(false);
    setError(null);
    setTab("terminal");
    refreshState();
  }, [refreshState]);

  // The server moves the task/run when the terminal ends; mirror that here.
  useEffect(
    () =>
      subscribeTerminal(task.id, (event) => {
        if (event.kind === "opened" || event.kind === "closed") refreshState();
      }),
    [task.id, refreshState]
  );

  // ── Catalogs (skills, models) ─────────────────────────────────────────────
  useEffect(() => {
    api.skills
      .index()
      .then((index) => setCatalog(index.skills))
      .catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (choice) return;
    const preferred = HARNESS_ENGINES.find((name) => name === task.engine && available.has(name));
    const fallback = HARNESS_ENGINES.find((name) => available.has(name));
    setChoice(preferred ?? fallback ?? (engines.length > 0 ? "shell" : null));
  }, [choice, task.engine, available, engines.length]);

  useEffect(() => {
    setModel("");
    setModels([]);
    if (!choice || choice === "shell" || !available.has(choice)) return;
    let cancelled = false;
    api.engines
      .models(choice)
      .then((list) => !cancelled && setModels(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [choice, available]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const run = async <T,>(kind: NonNullable<typeof busy>, action: () => Promise<T>) => {
    setBusy(kind);
    setError(null);
    try {
      return await action();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      onNotify(message, "error");
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const start = (engine: Choice | null = choice) => {
    if (!engine) return;
    setTab("terminal");
    void run("start", async () => {
      const size = terminalRef.current?.size();
      const next = await api.terminal.start(task.id, {
        engine,
        ...(engine !== "shell" && model ? { model } : {}),
        // Only a hand-picked list is sent; otherwise the server picks from the task text.
        ...(engine !== "shell" && skillPlan.startSkills ? { skills: skillPlan.startSkills } : {}),
        ...size,
      });
      setState(next);
      terminalRef.current?.focus();
    });
  };

  const stop = () => void run("stop", () => api.terminal.stop(task.id).then(refreshState));

  const finish = () =>
    void run("finish", async () => {
      await api.terminal.finish(task.id);
      onNotify("Changes committed. Ready for a pull request.", "success");
      refreshState();
    });

  const createPR = () =>
    void run("pr", async () => {
      await onRetryPR(task.id);
    });

  // ── Derived view state ────────────────────────────────────────────────────
  const status = live
    ? { label: "Running", className: "text-success" }
    : (STATUS_LABEL[task.status] ?? STATUS_LABEL.backlog);
  const showIdle = !live && !hasOutput;
  const hasWorkspace = !!state?.cwd;
  const startLabel = hasWorkspace ? "Resume" : "Start";
  const engineMeta = choice && choice !== "shell" ? getEngineMeta(choice) : null;
  const EngineIcon = engineMeta?.icon;
  const liveEngine = state?.engine && state.engine !== "shell" ? state.engine : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-app">
      {/* Header: what, where it stands, and the one thing to do next */}
      <header className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to board"
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-primary">{task.title}</h2>
          <p className="flex items-center gap-2 truncate text-[11px] text-text-dimmed">
            <span className={`inline-flex items-center gap-1.5 font-medium ${status.className}`}>
              {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-success" />}
              {status.label}
            </span>
            {task.repo && <span className="truncate">· {task.repo.name}</span>}
            {task.branchName && <span className="truncate font-mono">· {task.branchName}</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {live ? (
            <>
              <Button variant="ghost" size="sm" onClick={stop} disabled={busy !== null}>
                Stop
              </Button>
              <Button variant="primary" size="sm" onClick={finish} disabled={busy !== null}>
                {busy === "finish" ? "Committing..." : "Finish"}
              </Button>
            </>
          ) : task.prUrl ? (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-md bg-success/15 px-3 py-1 text-xs font-medium text-success hover:bg-success/25"
            >
              Open PR
            </a>
          ) : task.status === "review" ? (
            <Button variant="primary" size="sm" onClick={createPR} disabled={busy !== null}>
              {busy === "pr" ? "Creating PR..." : "Create PR"}
            </Button>
          ) : null}

          {/* biome-ignore lint/a11y/noStaticElementInteractions: container only intercepts Escape for its menu */}
          <div
            className="relative"
            onKeyDown={(event) => {
              if (event.key === "Escape" && menuOpen) {
                event.stopPropagation();
                setMenuOpen(false);
              }
            }}
          >
            <button
              type="button"
              aria-label="More actions"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
              className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <circle cx="3" cy="8" r="1.3" />
                <circle cx="8" cy="8" r="1.3" />
                <circle cx="13" cy="8" r="1.3" />
              </svg>
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-10 cursor-default"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-white/10 bg-bg-app py-1 text-xs shadow-2xl shadow-black/60">
                  {[
                    {
                      label: "Open in editor",
                      action: () =>
                        api.tasks
                          .openEditor(task.id)
                          .catch((err) => onNotify(errorMessage(err), "error")),
                    },
                    { label: "Advanced view", action: onOpenAdvanced },
                    { label: "Clone task", action: () => onClone(task.id) },
                    { label: "Delete task", action: () => onDelete(task.id), danger: true },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void item.action();
                      }}
                      className={`block w-full px-3 py-1.5 text-left hover:bg-surface-hover ${
                        item.danger ? "text-danger" : "text-text-secondary"
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Tabs + session tools */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4">
        <nav className="flex gap-1" aria-label="Task sections">
          {(["terminal", "changes", "details"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-xs font-medium capitalize transition-colors ${
                tab === id
                  ? "border-accent text-text-primary"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {id}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 py-1.5">
          {live && liveEngine && (
            <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
              {(() => {
                const meta = getEngineMeta(liveEngine);
                const Icon = meta.icon;
                return <Icon size={13} className={meta.color} />;
              })()}
              {CHOICE_LABEL[liveEngine]}
            </span>
          )}
          {(live || hasWorkspace) && !showIdle && (
            <SkillPicker
              skills={catalog}
              plan={skillPlan.plan}
              onChange={skillPlan.choose}
              onAuto={skillPlan.auto}
              notice={live ? "Changes apply the next time the session starts." : undefined}
            />
          )}
        </div>
      </div>

      {/* Body */}
      <main className="relative min-h-0 flex-1">
        {/* Terminal stays mounted across tabs so the session never loses its screen. */}
        <div className={`absolute inset-0 ${tab === "terminal" ? "" : "invisible"}`}>
          <TaskTerminal
            ref={terminalRef}
            taskId={task.id}
            connected={connected}
            onWsSend={onWsSend}
            onActivity={setHasOutput}
          />

          {!live && hasOutput && tab === "terminal" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-[#0b0b0f]/95 px-4 py-2">
              <span className="text-xs text-text-dimmed">Session ended.</span>
              <div className="flex items-center gap-2">
                {error && (
                  <span role="alert" className="text-xs text-danger">
                    {error}
                  </span>
                )}
                <select
                  aria-label="Engine"
                  value={choice ?? ""}
                  onChange={(event) => setChoice(event.target.value as Choice)}
                  className="rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs text-text-secondary"
                >
                  {CHOICES.map((value) => (
                    <option key={value} value={value} disabled={!isAvailable(value)}>
                      {CHOICE_LABEL[value]}
                    </option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!choice || !isAvailable(choice) || busy !== null}
                  onClick={() => start()}
                >
                  {busy === "start"
                    ? "Starting..."
                    : `Resume ${choice ? CHOICE_LABEL[choice] : ""}`.trim()}
                </Button>
              </div>
            </div>
          )}

          {showIdle && tab === "terminal" && (
            <div className="absolute inset-0 flex items-center justify-center overflow-y-auto bg-[#0b0b0f]/95 p-6">
              <div className="w-full max-w-lg space-y-5">
                {task.description && (
                  <p className="line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                    {task.description}
                  </p>
                )}

                <div className="flex gap-1 rounded-lg border border-white/10 p-1">
                  {CHOICES.map((value) => {
                    const ok = isAvailable(value);
                    const active = choice === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!ok}
                        onClick={() => setChoice(value)}
                        title={
                          ok ? undefined : `${CHOICE_LABEL[value]} is not installed on the server`
                        }
                        className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                          active
                            ? "bg-accent text-white"
                            : "text-text-secondary hover:bg-surface-hover"
                        }`}
                      >
                        {CHOICE_LABEL[value]}
                      </button>
                    );
                  })}
                </div>

                {choice && choice !== "shell" && (
                  <PluginChips
                    plan={skillPlan.plan}
                    engine={choice}
                    onRemove={(name) =>
                      skillPlan.choose(
                        picksOf(skillPlan.plan?.applied ?? []).filter((n) => n !== name)
                      )
                    }
                  />
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {choice !== "shell" && (
                    <SkillPicker
                      skills={catalog}
                      plan={skillPlan.plan}
                      onChange={skillPlan.choose}
                      onAuto={skillPlan.auto}
                    />
                  )}
                  {choice !== "shell" && models.length > 0 && (
                    <select
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      aria-label="Model"
                      className="max-w-[16rem] rounded-md border border-white/10 bg-transparent px-2 py-1 text-xs text-text-secondary"
                    >
                      <option value="">Default model</option>
                      {models.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}

                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={!choice || !isAvailable(choice) || busy !== null}
                  onClick={() => start()}
                >
                  {EngineIcon && <EngineIcon size={16} className="text-white" />}
                  {busy === "start"
                    ? "Starting..."
                    : `${startLabel} ${choice ? CHOICE_LABEL[choice] : ""}`.trim()}
                </Button>
                {!choice && engines.length === 0 && (
                  <p className="text-center text-xs text-text-dimmed">Loading engines...</p>
                )}
              </div>
            </div>
          )}
        </div>

        {tab === "changes" && (
          <div className="absolute inset-0 overflow-y-auto p-4">
            {task.branchName ? (
              <DiffViewer taskId={task.id} branchName={task.branchName} />
            ) : (
              <p className="py-12 text-center text-sm text-text-dimmed">
                No changes yet. Start the terminal to create the task branch.
              </p>
            )}
          </div>
        )}

        {tab === "details" && (
          <div className="absolute inset-0 overflow-y-auto p-6">
            <div className="mx-auto max-w-2xl space-y-6">
              <section>
                <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-dimmed">
                  Description
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary">
                  {task.description || "No description."}
                </p>
              </section>
              {task.issueUrl && (
                <a
                  href={task.issueUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-accent-text hover:underline"
                >
                  Linked issue{task.issueNumber ? ` #${task.issueNumber}` : ""} ↗
                </a>
              )}
              <dl className="grid grid-cols-2 gap-4 text-sm">
                {[
                  ["Repository", task.repo?.name],
                  ["Base branch", task.baseBranch ?? task.repo?.defaultBranch],
                  ["Branch", task.branchName],
                  ["Workspace", state?.cwd],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11px] font-semibold uppercase tracking-wider text-text-dimmed">
                      {label}
                    </dt>
                    <dd
                      className="mt-0.5 truncate font-mono text-xs text-text-secondary"
                      title={value ?? undefined}
                    >
                      {value ?? "—"}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
