import type { EngineInfo, Repository, SkillsIndex, TaskSpec } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePromptTemplates } from "../hooks/usePromptTemplates";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import { EMPTY_TASK_SPEC, TaskSpecEditor, taskSpecToDescription } from "./TaskSpecEditor";
import { TaskTagsEditor } from "./TaskTags";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { Dialog } from "./ui/dialog";
import { EngineMeta, getEngineMeta } from "./ui/engine-icons";
import { GitGenericIcon, GitHubIcon, GitLabIcon } from "./ui/git-icons";
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
    tags?: string[];
    agentId?: string;
    workflowId?: string;
    autoLaunch: boolean;
    schedule?: {
      cronExpression: string;
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

function EngineCard({
  engine,
  selected,
  onSelect,
}: {
  engine: EngineInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const meta = getEngineMeta(engine.name);
  const Icon = meta.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="relative flex flex-col items-center justify-center p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 text-left w-full"
      style={{
        background: selected ? "var(--accent-muted)" : "var(--bg-card)",
        borderColor: selected ? "var(--accent)" : "var(--border-default)",
        opacity: engine.available ? 1 : 0.5,
      }}
    >
      {selected && (
        <div
          className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
          style={{ background: "var(--accent)" }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path
              d="M2 5L4 7L8 3"
              stroke="var(--accent-text)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      )}
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mb-2"
        style={{ background: meta.bgColor }}
      >
        <Icon size={28} className={meta.color} />
      </div>
      <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
        {engine.displayName}
      </span>
      <span className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
        {meta.provider}
      </span>
      {!engine.available && (
        <span
          className="absolute bottom-1 right-2 text-[9px] px-1.5 py-0.5 rounded"
          style={{ background: "var(--danger)", color: "white" }}
        >
          unavailable
        </span>
      )}
    </button>
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

  if (models.length === 0 && !loading) return null;

  return (
    <div className="mt-3 animate-in fade-in slide-in-from-top-1 duration-200">
      <div
        className="text-[10px] uppercase font-bold tracking-wider mb-2"
        style={{ color: "var(--text-dimmed)" }}
      >
        Select Model
      </div>
      <Select value={model} onChange={(e) => onChange(e.target.value)} disabled={loading}>
        <option value="">{loading ? "Loading models..." : "Default (recommended)"}</option>
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
  engines,
  enginesLoading,
  enginesError,
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
  const [agentId, setAgentId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [skillsIndex, setSkillsIndex] = useState<SkillsIndex | null>(null);

  const [isScheduled, setIsScheduled] = useState(false);
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[0].value);
  const [isCustomCron, setIsCustomCron] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [guidedMode, setGuidedMode] = useState(false);
  const [taskSpec, setTaskSpec] = useState<TaskSpec>(EMPTY_TASK_SPEC);

  const { templates, addTemplate, removeTemplate } = usePromptTemplates();

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
        tags: tags.length > 0 ? tags : undefined,
        agentId: agentId || undefined,
        workflowId: workflowId || undefined,
        autoLaunch: isScheduled ? false : autoLaunch,
        schedule: isScheduled ? { cronExpression } : undefined,
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
      setAgentId("");
      setWorkflowId("");
      setIsScheduled(false);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const selectedEngine = engines.find((e) => e.name === engine);

  return (
    <>
      <Dialog open={open} onClose={onClose} title="New Task" size="5xl">
        <form onSubmit={handleSubmit} className="custom-scrollbar -mr-1 pr-1">
          <div className="grid grid-cols-5 gap-6">
            <div className="col-span-2 space-y-4">
              <div
                className="flex items-center gap-2 p-3 rounded-lg"
                style={{ background: "var(--bg-surface)" }}
              >
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  1
                </div>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Task Details
                </span>
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Title *
                </label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="What should the agent do?"
                  required
                />
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Repository *
                </label>
                <div className="relative z-20">
                  <Combobox
                    value={repoId}
                    onChange={setRepoId}
                    placeholder="Search repositories..."
                    required
                    options={repos
                      .filter((r) => r.status === "ready" || r.status === "pending")
                      .map((repo) => ({
                        value: repo.id,
                        label: `${repo.name}${repo.status === "pending" ? " (cloning…)" : ""}`,
                        sublabel: repo.status !== "ready" ? repo.status : undefined,
                        disabled: repo.status !== "ready",
                      }))}
                  />
                </div>
                {repoId &&
                  (() => {
                    const selectedRepo = repos.find((r) => r.id === repoId);
                    if (!selectedRepo) return null;
                    const ProviderIcon =
                      selectedRepo.provider === "github"
                        ? GitHubIcon
                        : selectedRepo.provider === "gitlab"
                          ? GitLabIcon
                          : GitGenericIcon;
                    return (
                      <div className="flex items-center gap-2 mt-2 px-2">
                        <span style={{ color: "var(--text-muted)" }}>
                          <ProviderIcon size={13} className="shrink-0" />
                        </span>
                        <span
                          className="text-[11px] truncate"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {selectedRepo.url}
                        </span>
                      </div>
                    );
                  })()}

                {repoId && (
                  <div className="mt-3">
                    <label
                      className="block text-xs font-medium mb-2"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Base Branch
                      {loadingBranches && (
                        <span
                          className="ml-1 animate-pulse"
                          style={{ color: "var(--text-dimmed)" }}
                        >
                          loading...
                        </span>
                      )}
                    </label>
                    <Select
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                      disabled={loadingBranches}
                      className="[& option:first-child]:font-semibold"
                    >
                      {loadingBranches ? (
                        <option value="">Loading branches...</option>
                      ) : branches.length > 0 ? (
                        branches.map((b, i) => (
                          <option key={b} value={b}>
                            {b}
                            {i === 0 ? " ★" : ""}
                          </option>
                        ))
                      ) : (
                        <option value={baseBranch || "main"}>{baseBranch || "main"} ★</option>
                      )}
                    </Select>
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    Description
                  </label>
                  <div
                    className="flex rounded-lg overflow-hidden border"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setGuidedMode(false)}
                      className="text-[10px] px-2.5 py-1 cursor-pointer transition-colors font-medium"
                      style={{
                        background: !guidedMode ? "var(--accent-muted)" : "transparent",
                        color: !guidedMode ? "var(--accent-text)" : "var(--text-dimmed)",
                      }}
                    >
                      Simple
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuidedMode(true)}
                      className="text-[10px] px-2.5 py-1 cursor-pointer transition-colors font-medium"
                      style={{
                        background: guidedMode ? "var(--accent-muted)" : "transparent",
                        color: guidedMode ? "var(--accent-text)" : "var(--text-dimmed)",
                      }}
                    >
                      Guided
                    </button>
                  </div>
                </div>
                {guidedMode ? (
                  <TaskSpecEditor value={taskSpec} onChange={setTaskSpec} />
                ) : (
                  <>
                    <Textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Detailed instructions for the AI agent..."
                      rows={8}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPicker(true)}
                      className="text-[10px] font-medium flex items-center gap-1.5 mt-1.5 cursor-pointer transition-colors"
                      style={{ color: "var(--accent-text)" }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M6 1L7.5 4.5L11 6L7.5 7.5L6 11L4.5 7.5L1 6L4.5 4.5Z"
                          fill="currentColor"
                        />
                      </svg>
                      Use Template
                    </button>
                  </>
                )}
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Tags
                </label>
                <TaskTagsEditor tags={tags} onChange={setTags} />
              </div>
            </div>

            <div className="col-span-3 space-y-5">
              <div
                className="flex items-center gap-2 p-3 rounded-lg"
                style={{ background: "var(--bg-surface)" }}
              >
                <div
                  className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
                  style={{ background: "var(--accent)", color: "white" }}
                >
                  2
                </div>
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Configuration
                </span>
              </div>

              <div>
                <label
                  className="block text-xs font-medium mb-2"
                  style={{ color: "var(--text-muted)" }}
                >
                  Agent
                </label>
                {skillsIndex &&
                (skillsIndex.agents.length > 0 || skillsIndex.workflows.length > 0) ? (
                  <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                    <option value="">None</option>
                    {skillsIndex.agents.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name}
                        {a.description ? ` — ${a.description.slice(0, 50)}` : ""}
                      </option>
                    ))}
                    {skillsIndex.workflows.map((w) => (
                      <option key={w.name} value={w.name}>
                        {w.name}
                        {w.description ? ` — ${w.description.slice(0, 50)}` : ""}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <div
                    className="text-xs px-3 py-2 rounded-lg border"
                    style={{
                      background: "var(--bg-input)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-dimmed)",
                    }}
                  >
                    No agents or workflows available
                  </div>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    AI Engine *
                  </label>
                  {enginesLoading && (
                    <span
                      className="text-[10px] animate-pulse"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      loading...
                    </span>
                  )}
                  {enginesError && (
                    <span
                      className="text-[10px]"
                      style={{ color: "var(--danger)" }}
                      title={enginesError}
                    >
                      ⚠ Failed to load
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {engines
                    .filter((e) => e.available)
                    .map((eng) => (
                      <EngineCard
                        key={eng.name}
                        engine={eng}
                        selected={engine === eng.name}
                        onSelect={() => setEngine(eng.name)}
                      />
                    ))}
                </div>
                <ModelSelector
                  models={models}
                  model={model}
                  onChange={setModel}
                  loading={loadingModels}
                />
              </div>
            </div>
          </div>

          <div
            className="mt-6 pt-4 border-t flex items-center gap-3"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="rounded cursor-pointer"
                style={{
                  borderColor: "var(--border-default)",
                  background: "var(--bg-input)",
                  accentColor: "var(--accent)",
                }}
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Schedule recurring task
              </span>
            </label>

            {!isScheduled && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoLaunch}
                  onChange={(e) => setAutoLaunch(e.target.checked)}
                  className="rounded cursor-pointer"
                  style={{
                    borderColor: "var(--border-default)",
                    background: "var(--bg-input)",
                    accentColor: "var(--accent)",
                  }}
                />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  Launch immediately
                </span>
              </label>
            )}

            {isScheduled && (
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
              >
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom...</option>
              </Select>
            )}

            <div className="flex-1" />

            {submitError && (
              <p
                className="text-xs truncate"
                style={{ color: "var(--danger)" }}
                title={submitError}
              >
                ⚠ {submitError}
              </p>
            )}

            <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!title.trim() || !repoId || !engine || submitting}
            >
              {submitting ? "Creating..." : isScheduled ? "Create Schedule" : "Create Task"}
            </Button>
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
