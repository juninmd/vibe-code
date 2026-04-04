import type { GitHubRepo } from "@vibe-code/shared";
import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { url: string }) => void;
}

export function AddRepoDialog({ open, onClose, onSubmit }: AddRepoDialogProps) {
  const [ghRepos, setGhRepos] = useState<GitHubRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [mode, setMode] = useState<"github" | "manual" | "create">("github");

  // Create new repo state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsPrivate, setNewIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.repos
      .listGitHub()
      .then(setGhRepos)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open]);

  const filtered = search
    ? ghRepos.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.description.toLowerCase().includes(search.toLowerCase())
      )
    : ghRepos;

  const handleSelect = (repo: GitHubRepo) => {
    onSubmit({ url: repo.url });
    handleClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualUrl.trim()) return;
    onSubmit({ url: manualUrl.trim() });
    handleClose();
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const repo = await api.repos.createGitHub({
        name: newName.trim(),
        description: newDescription.trim(),
        isPrivate: newIsPrivate,
      });
      onSubmit({ url: repo.url });
      handleClose();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setSearch("");
    setManualUrl("");
    setMode("github");
    setNewName("");
    setNewDescription("");
    setNewIsPrivate(true);
    setCreateError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Add Repository">
      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-zinc-800 rounded-lg p-1">
        <button
          type="button"
          onClick={() => setMode("github")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors cursor-pointer ${
            mode === "github" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          GitHub
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors cursor-pointer ${
            mode === "create" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          + New Repo
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors cursor-pointer ${
            mode === "manual" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          Manual URL
        </button>
      </div>

      {mode === "github" ? (
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search your repositories..."
            autoFocus
          />

          <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-800">
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-zinc-500">
                Loading repositories...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-zinc-500">
                {search
                  ? "No repositories match your search"
                  : "No repositories found. Is `gh` authenticated?"}
              </div>
            ) : (
              filtered.map((repo) => (
                <button
                  key={repo.url}
                  type="button"
                  onClick={() => handleSelect(repo)}
                  className="w-full text-left px-3 py-2.5 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-zinc-200 group-hover:text-zinc-100 font-medium truncate flex-1">
                      {repo.name}
                    </span>
                    {repo.isPrivate && (
                      <Badge variant="warning" className="text-[10px]">
                        private
                      </Badge>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">{repo.description}</p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      ) : mode === "create" ? (
        <form onSubmit={handleCreateSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Repository Name *
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-new-project"
              required
              autoFocus
            />
            <p className="text-xs text-zinc-600 mt-1">
              Will be created on your GitHub account via <code className="text-zinc-500">gh</code>
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Description</label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Optional description..."
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={newIsPrivate}
              onChange={(e) => setNewIsPrivate(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800 text-violet-500 focus:ring-violet-500 cursor-pointer"
            />
            <span className="text-sm text-zinc-400 flex items-center gap-1.5">
              {newIsPrivate ? "🔒" : "🔓"}
              {newIsPrivate ? "Private (recommended)" : "Public"}
            </span>
          </label>

          {createError && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
              {createError}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!newName.trim() || creating}>
              {creating ? "Creating..." : "Create & Add"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Repository URL *</label>
            <Input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              required
              autoFocus
            />
            <p className="text-xs text-zinc-600 mt-1">
              GitHub URL or local path. Branch is auto-detected.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!manualUrl.trim()}>
              Add
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
