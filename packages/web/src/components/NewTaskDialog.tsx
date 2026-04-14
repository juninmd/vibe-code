import type { EngineInfo, Repository, TaskSpec } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePromptTemplates } from "../hooks/usePromptTemplates";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import { EMPTY_TASK_SPEC, TaskSpecEditor, taskSpecToDescription } from "./TaskSpecEditor";
import { TaskTagsEditor } from "./TaskTags";
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

  // Scheduling state
  const [isScheduled, setIsScheduled] = useState(false);
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[0].value);
  const [isCustomCron, setIsCustomCron] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Guided mode (TaskSpec)
  const [guidedMode, setGuidedMode] = useState(false);
  const [taskSpec, setTaskSpec] = useState<TaskSpec>(EMPTY_TASK_SPEC);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { templates, addTemplate, removeTemplate } = usePromptTemplates();

  // Set baseBranch and fetch branches when repoId changes
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

  // Fetch models when engine changes
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
        autoLaunch: isScheduled ? false : autoLaunch,
        schedule: isScheduled ? { cronExpression } : undefined,
      });
      // Only reset + close on success
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
      <Dialog open={open} onClose={onClose} title="New Task">
        <form
          onSubmit={handleSubmit}
          className="space-y-5 max-h-[75vh] overflow-y-auto pr-1 custom-scrollbar -mr-1"
        >
          {/* ── Basic Info ──────────────────────────────────── */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold"
                style={{ background: "var(--accent-muted)", color: "var(--accent-text)" }}
              >
                1
              </span>
              <span
                className="text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-muted)" }}
              >
                Basic Info
              </span>
            </div>

            <div>
              <div
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                Title *
              </div>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What should the agent do?"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <div className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
                    Description
                  </div>
                  <div
                    className="flex rounded-md overflow-hidden border"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    <button
                      type="button"
                      onClick={() => setGuidedMode(false)}
                      className="text-[10px] px-2 py-0.5 cursor-pointer transition-colors"
                      style={{
                        background: !guidedMode ? "var(--accent-muted)" : "transparent",
                        color: !guidedMode ? "var(--accent-text)" : "var(--text-dimmed)",
                      }}
                    >
                      Simples
                    </button>
                    <button
                      type="button"
                      onClick={() => setGuidedMode(true)}
                      className="text-[10px] px-2 py-0.5 cursor-pointer transition-colors"
                      style={{
                        background: guidedMode ? "var(--accent-muted)" : "transparent",
                        color: guidedMode ? "var(--accent-text)" : "var(--text-dimmed)",
                      }}
                    >
                      Guiado
                    </button>
                  </div>
                </div>
                {!guidedMode && (
                  <button
                    type="button"
                    onClick={() => setShowPicker(true)}
                    className="text-[10px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                    style={{ color: "var(--accent-text)" }}
                  >
                    ⚡ Templates
                  </button>
                )}
              </div>
              {guidedMode ? (
                <TaskSpecEditor value={taskSpec} onChange={setTaskSpec} />
              ) : (
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detailed instructions for the AI agent..."
                  rows={4}
                />
              )}
            </div>

            <div>
              <div
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                Tags
              </div>
              <TaskTagsEditor tags={tags} onChange={setTags} />
            </div>
          </div>

          {/* ── Configuration ──────────────────────────────── */}
          <div className="space-y-4 pt-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
            {/* Repository — always visible */}
            <div className="min-w-0">
              <div
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--text-muted)" }}
              >
                Repository *
              </div>
              <div className="relative z-20">
                <Combobox
                  value={repoId}
                  onChange={setRepoId}
                  placeholder="Search..."
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
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs cursor-pointer transition-colors"
              style={{ color: "var(--text-dimmed)" }}
            >
              <span
                className="transition-transform"
                style={{ transform: showAdvanced ? "rotate(90deg)" : "rotate(0deg)" }}
              >
                ▶
              </span>
              Opções avançadas
              {(engine || model || baseBranch || tags.length > 0) && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              )}
            </button>

            {showAdvanced && (
              <div
                className="space-y-4 pl-3 border-l-2 animate-in slide-in-from-left-2"
                style={{ borderColor: "var(--border-default)" }}
              >
                <div className="min-w-0">
                  <div
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--text-muted)" }}
                  >
                    AI Engine
                    {enginesLoading && (
                      <span className="ml-1" style={{ color: "var(--text-dimmed)" }}>
                        (loading...)
                      </span>
                    )}
                    {enginesError && (
                      <span
                        className="ml-1"
                        style={{ color: "var(--danger)" }}
                        title={enginesError}
                      >
                        ⚠
                      </span>
                    )}
                  </div>
                  <Select value={engine} onChange={(e) => setEngine(e.target.value)}>
                    <option value="">Auto-select</option>
                    {engines.map((eng) => (
                      <option key={eng.name} value={eng.name} disabled={!eng.available}>
                        {eng.displayName}
                        {!eng.available ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>

                {repoId && (
                  <div>
                    <div
                      className="block text-xs font-medium mb-1.5"
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
                    </div>
                    <Input
                      value={baseBranch}
                      onChange={(e) => setBaseBranch(e.target.value)}
                      placeholder="main"
                    />
                    {branches.length > 0 && (
                      <div className="flex gap-1 flex-wrap mt-2">
                        {branches.slice(0, 8).map((b) => (
                          <button
                            key={b}
                            type="button"
                            onClick={() => setBaseBranch(b)}
                            className="text-[10px] px-2 py-0.5 rounded-md border cursor-pointer transition-colors"
                            style={{
                              background: baseBranch === b ? "var(--accent-muted)" : "transparent",
                              borderColor:
                                baseBranch === b ? "var(--accent)" : "var(--border-default)",
                              color: baseBranch === b ? "var(--accent-text)" : "var(--text-muted)",
                            }}
                          >
                            {b}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {engine && (models.length > 0 || loadingModels) && (
                  <div>
                    <div
                      className="block text-xs font-medium mb-1.5"
                      style={{ color: "var(--text-muted)" }}
                    >
                      Model
                    </div>
                    <Select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={loadingModels}
                    >
                      <option value="">{loadingModels ? "Loading models..." : "Default"}</option>
                      {groupModelsByProvider(models).map(({ provider, models: providerModels }) => (
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
                )}
              </div>
            )}

            <div className="pt-2 space-y-3">
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
                <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Schedule Task (Recurring)
                </span>
              </label>

              {isScheduled ? (
                <div
                  className="pl-6 space-y-3 border-l-2 animate-in slide-in-from-left-2"
                  style={{ borderColor: "var(--border-default)" }}
                >
                  <div>
                    <label
                      htmlFor="schedule-frequency"
                      className="block text-[10px] uppercase font-bold tracking-wider mb-1.5"
                      style={{ color: "var(--text-dimmed)" }}
                    >
                      Frequency
                    </label>
                    <Select
                      id="schedule-frequency"
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
                      <option value="custom">Custom Cron Expression...</option>
                    </Select>
                  </div>

                  {isCustomCron && (
                    <div className="animate-in fade-in zoom-in-95 duration-200">
                      <label
                        htmlFor="custom-cron-expression"
                        className="block text-[10px] uppercase font-bold tracking-wider mb-1.5"
                        style={{ color: "var(--text-dimmed)" }}
                      >
                        Cron Expression
                      </label>
                      <Input
                        id="custom-cron-expression"
                        value={cronExpression}
                        onChange={(e) => setCronExpression(e.target.value)}
                        placeholder="e.g. 0 12 * * 1-5"
                      />
                      <p className="text-[10px] mt-1" style={{ color: "var(--text-dimmed)" }}>
                        Format: min hour day month day-of-week
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <label className="flex items-center gap-2 cursor-pointer pl-0.5">
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
                  <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                    Launch agent immediately
                  </span>
                </label>
              )}
            </div>

            <div
              className="flex gap-2 justify-end pt-4 border-t"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              {submitError && (
                <p className="flex-1 text-xs text-red-400 self-center truncate" title={submitError}>
                  ⚠ {submitError}
                </p>
              )}
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={!title.trim() || !repoId || submitting}
              >
                {submitting ? "Criando..." : isScheduled ? "Create Schedule" : "Create Task"}
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
