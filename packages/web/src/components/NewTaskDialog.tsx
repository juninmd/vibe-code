import type {
  EngineInfo,
  Repository,
  SkillsIndex,
  TaskPriority,
  TaskSpec,
} from "@vibe-code/shared";
import { TASK_COMPLEXITY_META, TASK_PRIORITY_LEVELS, TASK_PRIORITY_META } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePromptTemplates } from "../hooks/usePromptTemplates";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import { EMPTY_TASK_SPEC, TaskSpecEditor, taskSpecToDescription } from "./TaskSpecEditor";
import { Button } from "./ui/button";
import { Combobox } from "./ui/combobox";
import { Dialog } from "./ui/dialog";
import { getEngineMeta } from "./ui/engine-icons";
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
} as const;

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
      className={`relative flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all duration-300 text-left w-full active-shrink group ${
        selected
          ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
          : "bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50"
      }`}
      style={{
        opacity: engine.available ? 1 : 0.4,
      }}
    >
      {selected && (
        <div className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center bg-accent shadow-lg animate-in zoom-in duration-200">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
            aria-hidden="true"
          >
            <title>Selected</title>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </div>
      )}
      <div
        className={`w-14 h-14 flex items-center justify-center mb-3 transition-transform duration-300 ${selected ? "scale-110" : "group-hover:scale-105"}`}
      >
        <Icon size={42} className={meta.color} />
      </div>
      <span className="text-sm font-bold tracking-tight text-primary">{engine.displayName}</span>
      <span className="text-[10px] font-black uppercase tracking-widest text-dimmed mt-1 opacity-70">
        {meta.provider}
      </span>
      {!engine.available && (
        <span className="absolute bottom-2 right-2 text-[9px] font-bold uppercase px-2 py-0.5 rounded-md bg-danger text-white shadow-lg">
          offline
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
    <div className="mt-4 animate-in fade-in slide-in-from-top-1 duration-200">
      <label
        htmlFor="model-select"
        className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
      >
        Intelligence Model
      </label>
      <Select
        id="model-select"
        value={model}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        className="h-11 rounded-2xl bg-input/40 border-white/5 font-bold text-sm"
      >
        <option value="">{loading ? "Searching models..." : "Default (recommended)"}</option>
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
  const [_branches, setBranches] = useState<string[]>([]);
  const [_loadingBranches, setLoadingBranches] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [priority, setPriority] = useState<TaskPriority>("none");
  const [taskComplexity, setTaskComplexity] = useState<string>("low");
  const [agentId, setAgentId] = useState("");
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
        priority: priority !== "none" ? priority : undefined,
        tags: tags.length > 0 ? tags : undefined,
        agentId: agentId || undefined,
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
      setPriority("none");
      setAgentId("");
      setIsScheduled(false);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="Neural Task Construction" size="5xl">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="grid grid-cols-5 gap-10">
            {/* Main Info Column */}
            <div className="col-span-3 space-y-8 animate-in fade-in slide-in-from-left-4 duration-500">
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-black">
                    1
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-primary">
                    Core Objective
                  </h3>
                </div>

                <div className="space-y-4">
                  <div>
                    <label
                      htmlFor={NEW_TASK_FIELD_IDS.repository}
                      className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
                    >
                      Target Repository
                    </label>
                    <div className="relative group">
                      <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors z-30">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          aria-hidden="true"
                        >
                          <title>Select icon</title>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <div className="relative z-20 h-12 rounded-2xl bg-input/50 border border-white/5 focus-within:border-accent/40 overflow-hidden">
                        {reposLoading ? (
                          <div className="px-3 py-3 text-sm text-primary0 flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-accent/40 animate-pulse" />
                            Loading repositories...
                          </div>
                        ) : repos.length === 0 ? (
                          <div className="px-3 py-3 text-sm text-danger flex items-center gap-2">
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              aria-hidden="true"
                            >
                              <title>Alert</title>
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                            No repositories found
                          </div>
                        ) : (
                          <Combobox
                            inputId={NEW_TASK_FIELD_IDS.repository}
                            value={repoId}
                            onChange={setRepoId}
                            placeholder="Search repositories..."
                            required
                            options={repos
                              .filter((r) => r.status !== "error")
                              .map((repo) => {
                                const sublabel =
                                  repo.status === "ready"
                                    ? undefined
                                    : repo.status === "cloning"
                                      ? "cloning…"
                                      : repo.status === "pending"
                                        ? "pending"
                                        : repo.status;
                                return {
                                  value: repo.id,
                                  label: repo.name,
                                  sublabel,
                                  disabled: repo.status !== "ready",
                                };
                              })}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={NEW_TASK_FIELD_IDS.title}
                      className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
                    >
                      Task Title
                    </label>
                    <Input
                      id={NEW_TASK_FIELD_IDS.title}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g., refactor: optimize database query performance"
                      className="h-12 rounded-2xl bg-input/50 border-white/5 focus:border-accent/40 text-sm font-bold"
                      required
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2 ml-1">
                      <label
                        htmlFor={NEW_TASK_FIELD_IDS.description}
                        className="block text-[10px] font-black uppercase tracking-widest text-dimmed"
                      >
                        Implementation Brief
                      </label>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowPicker(true)}
                          className="text-[10px] font-black uppercase tracking-widest text-accent hover:text-accent-hover transition-colors"
                        >
                          Use Template ✦
                        </button>
                        <div className="h-4 w-px bg-white/10" />
                        <div className="flex rounded-lg overflow-hidden bg-white/5 p-0.5 border border-white/5">
                          <button
                            type="button"
                            onClick={() => setGuidedMode(false)}
                            className={`text-[9px] px-2 py-1 rounded-md font-black uppercase tracking-widest transition-all ${!guidedMode ? "bg-white text-black shadow-sm" : "text-muted hover:text-primary"}`}
                          >
                            Simple
                          </button>
                          <button
                            type="button"
                            onClick={() => setGuidedMode(true)}
                            className={`text-[9px] px-2 py-1 rounded-md font-black uppercase tracking-widest transition-all ${guidedMode ? "bg-white text-black shadow-sm" : "text-muted hover:text-primary"}`}
                          >
                            Guided
                          </button>
                        </div>
                      </div>
                    </div>
                    {guidedMode ? (
                      <TaskSpecEditor value={taskSpec} onChange={setTaskSpec} />
                    ) : (
                      <Textarea
                        id={NEW_TASK_FIELD_IDS.description}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Describe exactly what needs to be changed..."
                        className="min-h-[160px] rounded-[1.5rem] bg-input/50 border-white/5 focus:border-accent/40 text-sm leading-relaxed p-5"
                        required
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label
                    htmlFor="complexity-select"
                    className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-3 ml-1"
                  >
                    Complexity Mapping
                  </label>
                  <div id="complexity-select" className="flex flex-wrap gap-2">
                    {(["trivial", "low", "medium", "high", "critical"] as const).map((c) => {
                      const meta = TASK_COMPLEXITY_META[c];
                      const isActive = taskComplexity === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setTaskComplexity(c)}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all active-shrink ${
                            isActive
                              ? "bg-white text-black border-white shadow-lg"
                              : "bg-white/5 border-transparent text-muted hover:border-white/10 hover:text-primary"
                          }`}
                        >
                          {meta.icon} {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="priority-select"
                    className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-3 ml-1"
                  >
                    Priority Signal
                  </label>
                  <div id="priority-select" className="flex flex-wrap gap-2">
                    {TASK_PRIORITY_LEVELS.map((p) => {
                      const meta = TASK_PRIORITY_META[p];
                      const isActive = priority === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setPriority(p)}
                          className={`px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all active-shrink ${
                            isActive
                              ? "bg-accent border-accent text-white shadow-lg shadow-accent/25"
                              : "bg-white/5 border-transparent text-muted hover:border-white/10 hover:text-primary"
                          }`}
                        >
                          {meta.icon} {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Configuration Column */}
            <div className="col-span-2 space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="space-y-6">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-center text-accent font-black">
                    2
                  </div>
                  <h3 className="text-sm font-black uppercase tracking-widest text-primary">
                    Intelligence & Context
                  </h3>
                </div>

                <div className="space-y-5">
                  <div>
                    <label
                      htmlFor={NEW_TASK_FIELD_IDS.agent}
                      className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-3 ml-1"
                    >
                      Specialized Agent
                    </label>
                    {skillsIndex &&
                    (skillsIndex.agents.length > 0 || skillsIndex.workflows.length > 0) ? (
                      <Select
                        value={agentId}
                        onChange={(e) => setAgentId(e.target.value)}
                        className="h-11 rounded-2xl bg-input/40 border-white/5 font-bold text-sm"
                      >
                        <option value="">Generalist Orchestrator</option>
                        {skillsIndex.agents.map((a) => (
                          <option key={a.name} value={a.name}>
                            {a.name}
                          </option>
                        ))}
                        {skillsIndex.workflows.map((w) => (
                          <option key={w.name} value={w.name}>
                            {w.name} (Workflow)
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <div className="p-3 rounded-2xl border border-white/5 bg-input/20 text-[10px] font-black uppercase tracking-widest text-dimmed text-center italic">
                        No specialized assets available
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-3 ml-1">
                      <label
                        htmlFor="engine-matrix"
                        className="block text-[10px] font-black uppercase tracking-widest text-dimmed"
                      >
                        AI Engine Matrix
                      </label>
                      {enginesLoading && (
                        <span className="text-[10px] font-black uppercase tracking-widest text-accent animate-pulse">
                          Syncing...
                        </span>
                      )}
                    </div>
                    <div id="engine-matrix" className="grid grid-cols-2 gap-3">
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
                  </div>

                  <ModelSelector
                    models={models}
                    model={model}
                    onChange={setModel}
                    loading={loadingModels}
                  />

                  <div className="pt-4 p-5 rounded-[2rem] bg-white/[0.02] border border-white/5 space-y-4">
                    <label className="flex items-center justify-between cursor-pointer group">
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-primary">Automated Scheduling</p>
                        <p className="text-[10px] text-muted font-medium">
                          Run this operation on a interval
                        </p>
                      </div>
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={isScheduled}
                          onChange={(e) => setIsScheduled(e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-12 h-7 rounded-full transition-all active-shrink ${isScheduled ? "bg-accent shadow-lg shadow-accent/25" : "bg-white/10"}`}
                        >
                          <div
                            className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${isScheduled ? "left-6" : "left-1"}`}
                          />
                        </div>
                      </div>
                    </label>

                    {!isScheduled && (
                      <label className="flex items-center justify-between cursor-pointer group">
                        <div className="space-y-0.5">
                          <p className="text-sm font-bold text-primary">Instant Execution</p>
                          <p className="text-[10px] text-muted font-medium">
                            Launch agent immediately after creation
                          </p>
                        </div>
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={autoLaunch}
                            onChange={(e) => setAutoLaunch(e.target.checked)}
                            className="sr-only"
                          />
                          <div
                            className={`w-12 h-7 rounded-full transition-all active-shrink ${autoLaunch ? "bg-accent shadow-lg shadow-accent/25" : "bg-white/10"}`}
                          >
                            <div
                              className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${autoLaunch ? "left-6" : "left-1"}`}
                            />
                          </div>
                        </div>
                      </label>
                    )}

                    {isScheduled && (
                      <div className="pt-2 space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
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
                          className="h-10 rounded-xl bg-input/50 border-white/10 text-xs font-bold"
                        >
                          {CRON_PRESETS.map((p) => (
                            <option key={p.value} value={p.value}>
                              {p.label}
                            </option>
                          ))}
                          <option value="custom">Custom Expression...</option>
                        </Select>
                        {isCustomCron && (
                          <Input
                            type="text"
                            placeholder="Cron (e.g., 0 9 * * 1-5)"
                            value={cronExpression}
                            onChange={(e) => setCronExpression(e.target.value)}
                            className="h-10 rounded-xl bg-input/50 border-white/10 text-xs font-mono"
                          />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-12 pt-8 border-t border-white/5 flex items-center justify-between gap-6">
            <div className="flex-1 min-w-0">
              {submitError && (
                <div className="flex items-center gap-3 text-danger animate-in shake-1">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    aria-hidden="true"
                  >
                    <title>Error icon</title>
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                  <p className="text-[10px] font-black uppercase tracking-widest truncate">
                    {submitError}
                  </p>
                </div>
              )}{" "}
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={submitting}
                className="rounded-2xl h-12 px-8 font-black uppercase tracking-widest text-[10px]"
              >
                Discard
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!title.trim() || !repoId || !engine || submitting}
                className="rounded-2xl h-12 px-12 shadow-2xl shadow-accent/30 font-black uppercase tracking-[0.15em] text-[10px] min-w-[200px]"
              >
                {submitting
                  ? "Engaging System..."
                  : isScheduled
                    ? "Establish Schedule"
                    : "Deploy AI Agent"}
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
