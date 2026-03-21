import { useState } from "react";
import type { Repository, EngineInfo } from "@vibe-code/shared";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Select } from "./ui/select";
import { Combobox } from "./ui/combobox";

interface NewTaskDialogProps {
  open: boolean;
  onClose: () => void;
  repos: Repository[];
  engines: EngineInfo[];
  onSubmit: (data: { title: string; description: string; repoId: string; engine?: string }) => void;
}

export function NewTaskDialog({ open, onClose, repos, engines, onSubmit }: NewTaskDialogProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [repoId, setRepoId] = useState("");
  const [engine, setEngine] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !repoId) return;
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      repoId,
      engine: engine || undefined,
    });
    setTitle("");
    setDescription("");
    setRepoId("");
    setEngine("");
    onClose();
  };

  return (
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
          <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
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
            {engines
              .filter((e) => e.available)
              .map((eng) => (
                <option key={eng.name} value={eng.name}>
                  {eng.displayName}
                </option>
              ))}
          </Select>
        </div>

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
  );
}
