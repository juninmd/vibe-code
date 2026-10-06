import type {
  EngineInfo,
  Repository,
  SkillsIndex,
  TaskPriority,
  TaskSpec,
} from "@vibe-code/shared";
import { HARNESS_ENGINES, TASK_PRIORITY_LEVELS, TASK_PRIORITY_META } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePromptTemplates } from "../hooks/usePromptTemplates";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import { EMPTY_TASK_SPEC, TaskSpecEditor, taskSpecToDescription } from "./TaskSpecEditor";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";
import { Textarea } from "./ui/textarea";

function groupModelsByProvider(models: string[]): { provider: string; models: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const m of models) {
    const provider = m.includes("/") ? m.split("/")[0] : "other";
    if (!groups.has(provider)) groups.set(provider, []);
    groups.get(provider)?.push(m);
  }
  return Array.from(groups.entries()).map(([provider, models]) => ({ provider, models }));
}

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  repos: Repository[];
  reposLoading?: boolean;
  initialRepoId?: string | null;
  onLoadRepos?: () => Promise<void> | void;
  engines: EngineInfo[];
  enginesLoading?: boolean;
  enginesError?: string | null;
  onSubmit: (data: {
    title: string;
    description: string;
    repoId: string;
    engine?: string;
    model?: string;
    baseBranch?: string;
    priority?: TaskPriority;
    tags?: string[];
    agentId?: string;
    workflowId?: string;
    autoLaunch: boolean;
    schedule?: {
      cronExpression: string;
    };
    loopConfig?: {
      enabled: boolean;
      maxAttempts: number;
      timeoutMinutes: number;
      feedback?: string;
    };
  }) => Promise<void> | void;
}

const CRON_PRESETS = [
  { label: "Daily (00:00)", value: "0 0 * * *" },
  { label: "Weekly (Sunday 00:00)", value: "0 0 * * 0" },
  { label: "Monthly (1st 00:00)", value: "0 0 1 * *" },
  { label: "Every Hour", value: "0 * * * *" },
  { label: "Every 15 Minutes", value: "*/15 * * * *" },
];

const NEW_TASK_FIELD_IDS = {
  title: "new-task-title",
  repository: "new-task-repository",
  baseBranch: "new-task-base-branch",
  description: "new-task-description",
  agent: "new-task-agent",
  engine: "new-task-engine",
} as const;

const LABEL_CLASS = "mb-1.5 block text-xs font-medium text-muted";

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-primary">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <span className="relative shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <span className="block h-6 w-10 rounded-full bg-white/10 transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function ModelSelector({
  models,
  model,
  onChange,
  loading,
}: {
  models: string[];
  model: string;
  onChange: (v: string) => void;
  loading: boolean;
}) {
  const grouped = groupModelsByProvider(models);
  if (models.length === 0 && !loading) return <div />;

  return (
    <div>
      <label htmlFor="model-select" className={LABEL_CLASS}>
        Model
      </label>
      <Select
        id="model-select"
        value={model}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className="h-10 rounded-lg text-sm"
      >
        <option value="">{loading ? "Loading..." : "Default"}</option>
        {grouped.map(({ provider, models: providerModels }) => (
          <optgroup key={provider} label={provider}>
            {providerModels.map((m) => (
              <option key={m} value={m}>
                {m.includes("/") ? m.split("/").slice(1).join("/") : m}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </div>
  );
}

export function NewTaskDialog({
  open,
  onClose,
  repos,
  reposLoading,
  initialRepoId,
  onLoadRepos,
  engines,
  enginesLoading,
  onSubmit,
}: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoId, setRepoId] = useState("");
  const [engine, setEngine] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [baseBranch, setBaseBranch] = useState("");
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [agentId, setAgentId] = useState("");
  const [skillsIndex, setSkillsIndex] = useState<SkillsIndex | null>(null);

  const [isScheduled, setIsScheduled] = useState(false);
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[0].value);
  const [isCustomCron, setIsCustomCron] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [guidedMode, setGuidedMode] = useState(false);
  const [taskSpec, setTaskSpec] = useState<TaskSpec>(EMPTY_TASK_SPEC);

  const [loopEnabled, setLoopEnabled] = useState(false);
  const [loopMaxAttempts, setLoopMaxAttempts] = useState(3);
  const [loopTimeoutMinutes, setLoopTimeoutMinutes] = useState(60);
  const [loopFeedback, setLoopFeedback] = useState("");

  const { templates, addTemplate, removeTemplate } = usePromptTemplates();

  useEffect(() => {
    if (!open) return;
    onLoadRepos?.();
  }, [onLoadRepos, open]);

  useEffect(() => {
    if (!open || repoId) return;

    const selectableRepos = repos.filter((repo) => repo.status !== "error");
    const initialRepo = selectableRepos.find((repo) => repo.id === initialRepoId);
    const fallbackRepo = selectableRepos.length === 1 ? selectableRepos[0] : null;
    const nextRepoId = initialRepo?.id ?? fallbackRepo?.id;

    if (nextRepoId) setRepoId(nextRepoId);
  }, [initialRepoId, open, repoId, repos]);

  useEffect(() => {
    if (!open) return;
    api.skills
      .index()
      .then(setSkillsIndex)
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!repoId) {
      setBaseBranch("");
      setBranches([]);
      return;
    }
    const repo = repos.find((r) => r.id === repoId);
    setBaseBranch(repo?.defaultBranch ?? "main");
    setLoadingBranches(true);
    api.repos
      .branches(repoId)
      .then(setBranches)
      .catch(() => setBranches([]))
      .finally(() => setLoadingBranches(false));
  }, [repoId, repos]);

  useEffect(() => {
    if (!engine) {
      setModels([]);
      setModel("");
      return;
    }
    setLoadingModels(true);
    setModel("");
    api.engines
      .models(engine)
      .then((list) => setModels(list))
      .catch(() => setModels([]))
      .finally(() => setLoadingModels(false));
  }, [engine]);

  // Claude Code / OpenCode tasks are driven by hand in the task terminal.
  const handsOn = (HARNESS_ENGINES as readonly string[]).includes(engine);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !repoId || submitting) return;
    const finalDescription = guidedMode ? taskSpecToDescription(taskSpec) : description.trim();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        title: title.trim(),
        description: finalDescription,
        repoId,
        engine: engine || undefined,
        model: model || undefined,
        baseBranch: baseBranch || undefined,
        priority: priority !== "none" ? priority : undefined,
        tags: tags.length > 0 ? tags : undefined,
        agentId: agentId && !agentId.startsWith("workflow:") ? agentId : undefined,
        workflowId: agentId.startsWith("workflow:") ? agentId.slice("workflow:".length) : undefined,
        autoLaunch: isScheduled ? false : autoLaunch,
        schedule: isScheduled ? { cronExpression } : undefined,
        loopConfig: loopEnabled
          ? {
              enabled: true,
              maxAttempts: loopMaxAttempts,
              timeoutMinutes: loopTimeoutMinutes,
              feedback: loopFeedback.trim() || undefined,
            }
          : undefined,
      });
      setTitle("");
      setDescription("");
      setTaskSpec(EMPTY_TASK_SPEC);
      setRepoId("");
      setEngine("");
      setModel("");
      setModels([]);
      setBaseBranch("");
      setBranches([]);
      setTags([]);
      setPriority("none");
      setAgentId("");
      setIsScheduled(false);
      setLoopEnabled(false);
      setLoopMaxAttempts(3);
      setLoopTimeoutMinutes(60);
      setLoopFeedback("");
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="New task" size="2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={NEW_TASK_FIELD_IDS.repository} className={LABEL_CLASS}>
                Repository
              </label>
              {reposLoading ? (
                <div className="flex h-10 items-center gap-2 rounded-lg border border-white/5 bg-input/40 px-3 text-sm text-muted">
                  Loading repositories...
                </div>
              ) : repos.length === 0 ? (
                <div className="flex h-10 items-center rounded-lg border border-danger/20 bg-danger/5 px-3 text-sm text-danger">
                  No repositories found
                </div>
              ) : (
                <Combobox
                  inputId={NEW_TASK_FIELD_IDS.repository}
                  value={repoId}
                  onChange={setRepoId}
                  placeholder="Search repositories..."
                  required
                  className="h-10 rounded-lg bg-input/40 border border-white/5 focus-within:border-accent/40"
                  inputClassName="h-full px-3 text-sm"
                  options={repos
                    .filter((r) => r.status !== "error")
                    .map((repo) => {
                      const sublabel =
                        repo.status === "ready"
                          ? repo.url
                          : repo.status === "cloning"
                            ? "cloning…"
                            : repo.status === "pending"
                              ? "pending"
                              : repo.status;
                      return {
                        value: repo.id,
                        label: repo.name,
                        sublabel,
                        searchText: repo.url,
                      };
                    })}
                />
              )}
            </div>

            {repoId && (
              <div>
                <label htmlFor={NEW_TASK_FIELD_IDS.baseBranch} className={LABEL_CLASS}>
                  Base branch
                </label>
                {branches.length > 0 ? (
                  <Select
                    id={NEW_TASK_FIELD_IDS.baseBranch}
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    disabled={loadingBranches}
                    className="h-10 rounded-lg text-sm"
                  >
                    {branches.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={NEW_TASK_FIELD_IDS.baseBranch}
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder={loadingBranches ? "Loading branches..." : "main"}
                    className="h-10 rounded-lg text-sm"
                  />
                )}
              </div>
            )}
          </div>

          <div>
            <label htmlFor={NEW_TASK_FIELD_IDS.title} className={LABEL_CLASS}>
              Title
            </label>
            <Input
              id={NEW_TASK_FIELD_IDS.title}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., refactor: optimize database query performance"
              className="h-10 rounded-lg text-sm"
              required
            />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor={NEW_TASK_FIELD_IDS.description}
                className="text-xs font-medium text-muted"
              >
                Description
              </label>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="text-xs font-medium text-accent hover:text-accent-hover transition-colors"
              >
                Use template
              </button>
            </div>
            {guidedMode ? (
              <TaskSpecEditor value={taskSpec} onChange={setTaskSpec} />
            ) : (
              <Textarea
                id={NEW_TASK_FIELD_IDS.description}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what needs to be changed..."
                className="min-h-[140px] rounded-lg text-sm leading-relaxed p-3"
                required
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor={NEW_TASK_FIELD_IDS.engine} className={LABEL_CLASS}>
                Engine
              </label>
              <Select
                id={NEW_TASK_FIELD_IDS.engine}
                value={engine}
                onChange={(e) => setEngine(e.target.value)}
                disabled={enginesLoading}
                className="h-10 rounded-lg text-sm"
                required
              >
                <option value="" disabled>
                  {enginesLoading ? "Loading..." : "Select engine"}
                </option>
                {engines
                  .filter((e) => e.available)
                  .map((eng) => (
                    <option key={eng.name} value={eng.name}>
                      {eng.displayName}
                    </option>
                  ))}
              </Select>
            </div>

            <ModelSelector
              models={models}
              model={model}
              onChange={setModel}
              loading={loadingModels}
            />

            <div>
              <label htmlFor="priority-select" className={LABEL_CLASS}>
                Priority
              </label>
              <Select
                id="priority-select"
                value={priority}
                onChange={(e) => setPriority(e.target.value as TaskPriority)}
                className="h-10 rounded-lg text-sm"
              >
                {TASK_PRIORITY_LEVELS.map((p) => (
                  <option key={p} value={p}>
                    {TASK_PRIORITY_META[p].label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <details className="group rounded-lg border border-white/5 bg-white/[0.02] px-4 py-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-muted">
              Advanced
            </summary>
            <div className="mt-4 space-y-4">
              {skillsIndex &&
                (skillsIndex.agents.length > 0 || skillsIndex.workflows.length > 0) && (
                  <div>
                    <label htmlFor={NEW_TASK_FIELD_IDS.agent} className={LABEL_CLASS}>
                      Specialized agent
                    </label>
                    <Select
                      id={NEW_TASK_FIELD_IDS.agent}
                      value={agentId}
                      onChange={(e) => setAgentId(e.target.value)}
                      className="h-10 rounded-lg text-sm"
                    >
                      <option value="">Default</option>
                      {skillsIndex.agents.map((a) => (
                        <option key={a.name} value={a.name}>
                          {a.name}
                        </option>
                      ))}
                      {skillsIndex.workflows.map((w) => (
                        <option key={w.name} value={`workflow:${w.name}`}>
                          {w.name} (Workflow)
                        </option>
                      ))}
                    </Select>
                  </div>
                )}

              <Toggle
                label="Structured brief"
                hint="Fill a guided spec instead of free text"
                checked={guidedMode}
                onChange={setGuidedMode}
              />

              <Toggle
                label="Recurring"
                hint="Run this task on a schedule"
                checked={isScheduled}
                onChange={setIsScheduled}
              />
              {isScheduled && (
                <div className="space-y-3">
                  <Select
                    value={isCustomCron ? "custom" : cronExpression}
                    onChange={(e) => {
                      if (e.target.value === "custom") {
                        setIsCustomCron(true);
                      } else {
                        setIsCustomCron(false);
                        setCronExpression(e.target.value);
                      }
                    }}
                    className="h-10 rounded-lg text-sm"
                  >
                    {CRON_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                    <option value="custom">Custom expression...</option>
                  </Select>
                  {isCustomCron && (
                    <Input
                      type="text"
                      placeholder="Cron (e.g., 0 9 * * 1-5)"
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      className="h-10 rounded-lg text-sm font-mono"
                    />
                  )}
                </div>
              )}

              <Toggle
                label="Retry on failure"
                hint="Relaunch until it succeeds or hits max attempts"
                checked={loopEnabled}
                onChange={setLoopEnabled}
              />
              {loopEnabled && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="loop-max-attempts" className={LABEL_CLASS}>
                        Max attempts
                      </label>
                      <Input
                        id="loop-max-attempts"
                        type="number"
                        min={1}
                        max={20}
                        value={loopMaxAttempts}
                        onChange={(e) => setLoopMaxAttempts(Number(e.target.value))}
                        className="h-10 rounded-lg text-sm font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor="loop-timeout" className={LABEL_CLASS}>
                        Timeout
                      </label>
                      <Select
                        id="loop-timeout"
                        value={loopTimeoutMinutes}
                        onChange={(e) => setLoopTimeoutMinutes(Number(e.target.value))}
                        className="h-10 rounded-lg text-sm"
                      >
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={60}>60 min</option>
                        <option value={120}>2 hours</option>
                        <option value={240}>4 hours</option>
                        <option value={480}>8 hours</option>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <label htmlFor="loop-feedback" className={LABEL_CLASS}>
                      Feedback on each retry (optional)
                    </label>
                    <Textarea
                      id="loop-feedback"
                      rows={2}
                      placeholder="Instructions to include on each retry attempt..."
                      value={loopFeedback}
                      onChange={(e) => setLoopFeedback(e.target.value)}
                      className="rounded-lg text-sm"
                    />
                  </div>
                </div>
              )}
            </div>
          </details>

          <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-4">
            <div className="min-w-0 flex-1">
              {submitError ? (
                <p className="truncate text-xs text-danger" role="alert">
                  {submitError}
                </p>
              ) : (
                !isScheduled && (
                  <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-secondary">
                    <input
                      type="checkbox"
                      checked={autoLaunch}
                      onChange={(e) => setAutoLaunch(e.target.checked)}
                      className="h-4 w-4 accent-[var(--accent)]"
                    />
                    {handsOn ? "Open task after creating" : "Start immediately"}
                  </label>
                )
              )}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!title.trim() || !repoId || !engine || submitting}
              >
                {submitting
                  ? "Creating..."
                  : isScheduled
                    ? "Schedule"
                    : autoLaunch
                      ? handsOn
                        ? "Create & open"
                        : "Create & run"
                      : "Create task"}
              </Button>
            </div>
          </div>
        </form>
      </Dialog>

      {showPicker && (
        <PromptTemplatePicker
          templates={templates}
          currentContent={description}
          onSelect={(t) => {
            setDescription(t.content);
            if (!title.trim()) setTitle(t.title);
            setShowPicker(false);
          }}
          onClose={() => setShowPicker(false)}
          onSaveNew={async (data) => {
            await addTemplate(data);
          }}
          onDelete={async (id) => {
            await removeTemplate(id);
          }}
        />
      )}
    </>
  );
}
