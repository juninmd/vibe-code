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
  onSubmit: (data: {
    title: string;
    description: string;
    repoId: string;
    engine?: string;
    model?: string;
    autoLaunch: boolean;
  }) => void;
}

export function NewTaskDialog({ open, onClose, repos, engines, onSubmit }: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoId, setRepoId] = useState("");
  const [engine, setEngine] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [autoLaunch, setAutoLaunch] = useState(true);
  const [showPicker, setShowPicker] = useState(false);

  const { templates, addTemplate, removeTemplate } = usePromptTemplates();

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
      autoLaunch,
    });
    setTitle("");
    setDescription("");
    setRepoId("");
    setEngine("");
    setModel("");
    setModels([]);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} title="New Task">
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Repository *</label>
            <Combobox
              value={repoId}
              onChange={setRepoId}
              placeholder="Search repositories..."
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
            <label className="block text-xs font-medium text-zinc-400 mb-1">AI Engine</label>
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

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoLaunch}
              onChange={(e) => setAutoLaunch(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500 cursor-pointer"
            />
            <span className="text-sm text-zinc-300">Launch agent immediately</span>
          </label>

          <div className="flex gap-2 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || !repoId}>
              Create Task
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
