import type { RemoteRepo } from "@vibe-code/shared";
import { useCallback, useEffect, useId, useRef, useState } from "react";
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
  const manualUrlInputId = useId();
  const [repos, setRepos] = useState<RemoteRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [mode, setMode] = useState<"github" | "gitlab" | "manual" | "create">("github");
  const [createProvider, setCreateProvider] = useState<"github" | "gitlab">("github");
  const [_isSearchResult, setIsSearchResult] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create new repo state
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newIsPrivate, setNewIsPrivate] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const providerLabel = mode === "gitlab" ? "GitLab" : "GitHub";

  const fetchRecent = useCallback(async (provider: "github" | "gitlab") => {
    setLoading(true);
    setError(null);
    setIsSearchResult(false);
    try {
      const list =
        provider === "gitlab" ? await api.repos.listGitLab() : await api.repos.listGitHub();
      setRepos(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRepos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch recent repos when dialog opens or tab changes
  useEffect(() => {
    if (!open) return;
    if (mode === "github" || mode === "gitlab") {
      setSearch("");
      fetchRecent(mode);
    }
  }, [open, mode, fetchRecent]);

  // Debounced server-side search
  useEffect(() => {
    if (mode !== "github" && mode !== "gitlab") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const q = search.trim();
    if (!q) {
      // Restore recent list when search is cleared
      fetchRecent(mode);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      setIsSearchResult(true);
      try {
        const searchFn = mode === "gitlab" ? api.repos.searchGitLab : api.repos.searchGitHub;
        const results = await searchFn(q);
        setRepos(results);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setRepos([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [search, mode, fetchRecent]);

  const handleSelect = (repo: RemoteRepo) => {
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
      const createFn =
        createProvider === "gitlab" ? api.repos.createGitLab : api.repos.createGitHub;
      const repo = await createFn({
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
    setRepos([]);
    setError(null);
    setNewName("");
    setNewDescription("");
    setNewIsPrivate(true);
    setCreateError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Add Repository" size="lg">
      {/* Premium Tabs */}
      <div className="flex gap-2 mb-6 p-1.5 rounded-[1.25rem] bg-input/40 border border-white/5 backdrop-blur-md">
        {(["github", "gitlab", "create", "manual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMode(t)}
            className={`flex-1 text-[11px] font-black uppercase tracking-widest py-2.5 rounded-xl transition-all active-shrink cursor-pointer ${
              mode === t
                ? "bg-accent text-white shadow-lg shadow-accent/25"
                : "text-muted hover:text-primary hover:bg-white/5"
            }`}
          >
            {t === "github" ? "GitHub" : t === "gitlab" ? "GitLab" : t === "create" ? "New" : "URL"}
          </button>
        ))}
      </div>

      {mode === "github" || mode === "gitlab" ? (
        <div className="space-y-4">
          <div className="relative group">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <title>Search icon</title>
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${providerLabel} repositories...`}
              className="pl-12 h-12 rounded-2xl bg-input/50 border-white/5 focus:border-accent/40"
              autoFocus
            />
          </div>

          {!search.trim() && !loading && repos.length > 0 && (
            <div className="flex items-center gap-2 px-2">
              <div className="h-px flex-1 bg-white/5" />
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-dimmed">
                Recent Activity
              </span>
              <div className="h-px flex-1 bg-white/5" />
            </div>
          )}

          <div className="max-h-80 overflow-y-auto rounded-[1.5rem] border border-white/5 bg-surface/20 backdrop-blur-sm custom-scrollbar">
            {loading ? (
              <div className="px-4 py-16 text-center space-y-4">
                <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-bold text-muted uppercase tracking-widest">
                  Fetching {providerLabel}...
                </p>
              </div>
            ) : error ? (
              <div className="px-6 py-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto text-danger shadow-xl shadow-danger/10">
                  <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <title>Error icon</title>
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-bold text-primary">Connection Error</p>
                  <p className="text-xs text-muted leading-relaxed max-w-[240px] mx-auto">
                    {error}
                  </p>
                </div>
              </div>
            ) : repos.length === 0 ? (
              <div className="px-6 py-16 text-center space-y-3">
                <p className="text-2xl opacity-40">∅</p>
                <p className="text-xs font-bold text-muted uppercase tracking-widest">
                  No repositories found
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {repos.map((repo) => (
                  <button
                    key={repo.url}
                    type="button"
                    onClick={() => handleSelect(repo)}
                    className="w-full text-left px-5 py-4 hover:bg-white/5 transition-all cursor-pointer group active:bg-white/10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-white/5 flex items-center justify-center group-hover:scale-110 group-hover:bg-accent/10 group-hover:text-accent transition-all">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          aria-hidden="true"
                        >
                          <title>Repository icon</title>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-primary truncate">
                            {repo.name}
                          </span>
                          {repo.isPrivate && (
                            <Badge
                              variant="warning"
                              className="text-[9px] font-black uppercase py-0 px-1.5 border-warning/30 bg-warning/10"
                            >
                              Private
                            </Badge>
                          )}
                        </div>
                        {repo.description && (
                          <p className="text-[11px] text-muted mt-1 truncate opacity-70 group-hover:opacity-100">
                            {repo.description}
                          </p>
                        )}
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="text-accent"
                          aria-hidden="true"
                        >
                          <title>Select icon</title>
                          <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : mode === "create" ? (
        <form
          onSubmit={handleCreateSubmit}
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="create-provider"
                className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
              >
                Provider Selection
              </label>
              <div
                id="create-provider"
                className="flex gap-2 p-1 rounded-2xl bg-input/40 border border-white/5"
              >
                {(["github", "gitlab"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setCreateProvider(p)}
                    className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active-shrink ${
                      createProvider === p
                        ? "bg-white text-black shadow-lg"
                        : "text-muted hover:text-primary hover:bg-white/5"
                    }`}
                  >
                    {p === "github" ? "GitHub" : "GitLab"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label
                htmlFor="repo-name"
                className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
              >
                Repo Name
              </label>
              <Input
                id="repo-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-cool-project"
                className="h-11 rounded-2xl bg-input/40 border-white/5"
                required
                autoFocus
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="repo-description"
              className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
            >
              Description
            </label>
            <Input
              id="repo-description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What is this repository for?"
              className="h-11 rounded-2xl bg-input/40 border-white/5"
            />
          </div>

          <button
            type="button"
            onClick={() => setNewIsPrivate(!newIsPrivate)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setNewIsPrivate(!newIsPrivate);
              }
            }}
            className={`w-full flex items-center justify-between p-4 rounded-[1.5rem] border transition-all cursor-pointer group active-shrink ${
              newIsPrivate ? "bg-accent/5 border-accent/20" : "bg-white/5 border-white/5"
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all ${
                  newIsPrivate
                    ? "bg-accent text-white shadow-lg shadow-accent/20"
                    : "bg-white/5 text-muted"
                }`}
              >
                {newIsPrivate ? (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <title>Private icon</title>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                ) : (
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <title>Public icon</title>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </div>
              <div>
                <p className="text-sm font-bold text-primary">Private Repository</p>
                <p className="text-[11px] text-muted mt-0.5">Control access to your code</p>
              </div>
            </div>
            <div
              className={`w-10 h-6 rounded-full relative transition-colors ${newIsPrivate ? "bg-accent" : "bg-white/10"}`}
            >
              <div
                className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all shadow-sm ${newIsPrivate ? "left-5" : "left-1"}`}
              />
            </div>
          </button>

          {createError && (
            <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 flex gap-3 items-center animate-in shake-1">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className="text-danger shrink-0"
                aria-hidden="true"
              >
                <title>Error icon</title>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
              <p className="text-xs font-bold text-danger">{createError}</p>
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="rounded-xl h-12 px-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!newName.trim() || creating}
              className="rounded-xl h-12 px-8 shadow-xl shadow-accent/25"
            >
              {creating ? "Creating..." : "Create Repository"}
            </Button>
          </div>
        </form>
      ) : (
        <form
          onSubmit={handleManualSubmit}
          className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
        >
          <div>
            <label
              htmlFor={manualUrlInputId}
              className="block text-[10px] font-black uppercase tracking-widest text-dimmed mb-2 ml-1"
            >
              Repository URL or Path
            </label>
            <Input
              id={manualUrlInputId}
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              className="h-12 rounded-2xl bg-input/40 border-white/5 text-sm font-bold"
              required
              autoFocus
            />
            <div className="mt-4 p-4 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex gap-3">
              <div className="text-blue-400 mt-0.5">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <title>Info icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </div>
              <p className="text-[11px] text-blue-300/80 leading-relaxed font-medium">
                Supports GitHub, GitLab, and local system paths. The default branch and repository
                identity will be automatically discovered.
              </p>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              className="rounded-xl h-12 px-6"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!manualUrl.trim()}
              className="rounded-xl h-12 px-10 shadow-xl shadow-accent/25"
            >
              Add Repository
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
