import { useState, useEffect } from "react";
import type { GitHubRepo } from "@vibe-code/shared";
import { Dialog } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Badge } from "./ui/badge";
import { api } from "../api/client";

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
  const [mode, setMode] = useState<"github" | "manual">("github");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.repos.listGitHub()
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

  const handleClose = () => {
    setSearch("");
    setManualUrl("");
    setMode("github");
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
            mode === "github"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          GitHub
        </button>
        <button
          type="button"
          onClick={() => setMode("manual")}
          className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors cursor-pointer ${
            mode === "manual"
              ? "bg-zinc-700 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-300"
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
                {search ? "No repositories match your search" : "No repositories found. Is `gh` authenticated?"}
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
                      <Badge variant="warning" className="text-[10px]">private</Badge>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-zinc-600 mt-0.5 truncate">
                      {repo.description}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Repository URL *
            </label>
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
