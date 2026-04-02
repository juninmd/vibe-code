import type { EngineInfo, Repository } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { usePromptTemplates } from "../hooks/usePromptTemplates";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
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
    groups.get(provider)!.push(m);
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
    autoLaunch: boolean;
    schedule?: {
      cronExpression: string;
    };
  }) => void;
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

  // Scheduling state
  const [isScheduled, setIsScheduled] = useState(false);
  const [cronExpression, setCronExpression] = useState(CRON_PRESETS[0].value);
  const [isCustomCron, setIsCustomCron] = useState(false);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !repoId) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      repoId,
      engine: engine || undefined,
      model: model || undefined,
      baseBranch: baseBranch || undefined,
      autoLaunch: isScheduled ? false : autoLaunch, // Don't auto-launch if scheduling
      schedule: isScheduled ? { cronExpression } : undefined,
    });
    setTitle("");
    setDescription("");
    setRepoId("");
    setEngine("");
    setModel("");
    setModels([]);
    setBaseBranch("");
    setBranches([]);
    setIsScheduled(false);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="New Task">
        <form
          onSubmit={handleSubmit}
          className="space-y-4 max-h-[80vh] overflow-y-auto pr-2 custom-scrollbar"
        >
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Title *</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What should the agent do?"
              required
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-zinc-400">Description</label>
              <button
                type="button"
                onClick={() => setShowPicker(true)}
                className="text-[10px] font-medium text-violet-400 hover:text-violet-300 flex items-center gap-1 cursor-pointer transition-colors"
              >
                ⚡ Templates
              </button>
            </div>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detailed instructions for the AI agent..."
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Repository *</label>
              <Combobox
                value={repoId}
                onChange={setRepoId}
                placeholder="Search..."
                required
                options={repos
                  .filter((r) => r.status === "ready" || r.status === "pending")
                  .map((repo) => ({
                    value: repo.id,
                    label: repo.name,
                    sublabel: repo.status !== "ready" ? repo.status : undefined,
                  }))}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                AI Engine
                {enginesLoading && <span className="ml-1 text-zinc-600">(carregando...)</span>}
                {enginesError && (
                  <span className="ml-1 text-red-500" title={enginesError}>
                    ⚠ erro
                  </span>
                )}
              </label>
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
          </div>

          {repoId && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">
                Branch base
                <span className="ml-1 text-zinc-600 font-normal">
                  — branch de origem para o agente trabalhar
                </span>
                {loadingBranches && (
                  <span className="ml-1 text-zinc-600 animate-pulse">carregando...</span>
                )}
              </label>
              <Input
                value={baseBranch}
                onChange={(e) => setBaseBranch(e.target.value)}
                placeholder="main"
              />
              {branches.length > 0 && (
                <div className="flex gap-1 flex-wrap mt-1.5">
                  {branches.slice(0, 6).map((b) => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setBaseBranch(b)}
                      className={`text-[10px] px-2 py-0.5 rounded border cursor-pointer transition-colors ${
                        baseBranch === b
                          ? "bg-violet-600/20 border-violet-500/60 text-violet-300"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                      }`}
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
              <label className="block text-xs font-medium text-zinc-400 mb-1">Model</label>
              <Select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={loadingModels}
              >
                <option value="">{loadingModels ? "Carregando models..." : "Default"}</option>
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

          <div className="pt-2 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={isScheduled}
                onChange={(e) => setIsScheduled(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500 cursor-pointer"
              />
              <span className="text-sm font-medium text-zinc-200">Schedule Task (Recurring)</span>
            </label>

            {isScheduled ? (
              <div className="pl-6 space-y-3 border-l-2 border-zinc-700 animate-in slide-in-from-left-2">
                <div>
                  <label className="block text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5">
                    Frequency
                  </label>
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
                    <option value="custom">Custom Cron Expression...</option>
                  </Select>
                </div>

                {isCustomCron && (
                  <div className="animate-in fade-in zoom-in-95 duration-200">
                    <label className="block text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5">
                      Cron Expression
                    </label>
                    <Input
                      value={cronExpression}
                      onChange={(e) => setCronExpression(e.target.value)}
                      placeholder="e.g. 0 12 * * 1-5"
                    />
                    <p className="text-[10px] text-zinc-500 mt-1">
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
                  className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500 cursor-pointer"
                />
                <span className="text-sm text-zinc-400">Launch agent immediately</span>
              </label>
            )}
          </div>

          <div className="flex gap-2 justify-end pt-4 border-t border-zinc-800">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || !repoId}>
              {isScheduled ? "Create Schedule" : "Create Task"}
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
