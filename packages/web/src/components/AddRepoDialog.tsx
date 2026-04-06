import type { RemoteRepo } from "@vibe-code/shared";
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
  const [ghRepos, setGhRepos] = useState<RemoteRepo[]>([]);
  const [glRepos, setGlRepos] = useState<RemoteRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const [mode, setMode] = useState<"github" | "gitlab" | "manual" | "create">("github");
  const [createProvider, setCreateProvider] = useState<"github" | "gitlab">("github");

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
    // Also load GitLab repos in background
    api.repos
      .listGitLab()
      .then(setGlRepos)
      .catch(() => {});
  }, [open]);

  const activeRepos = mode === "gitlab" ? glRepos : ghRepos;
  const filtered = search
    ? activeRepos.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.description.toLowerCase().includes(search.toLowerCase())
      )
    : activeRepos;

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
    setNewName("");
    setNewDescription("");
    setNewIsPrivate(true);
    setCreateError(null);
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Adicionar repositório">
      {/* Tabs */}
      <div className="flex gap-1 mb-4 rounded-lg p-1" style={{ background: "var(--bg-input)" }}>
        {(["github", "gitlab", "create", "manual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setMode(t)}
            className="flex-1 text-xs font-medium py-1.5 rounded-md transition-colors cursor-pointer"
            style={{
              background: mode === t ? "var(--bg-surface)" : "transparent",
              color: mode === t ? "var(--text-primary)" : "var(--text-muted)",
            }}
          >
            {t === "github"
              ? "GitHub"
              : t === "gitlab"
                ? "GitLab"
                : t === "create"
                  ? "Novo"
                  : "URL"}
          </button>
        ))}
      </div>

      {mode === "github" || mode === "gitlab" ? (
        <div className="space-y-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar repositórios no ${mode === "gitlab" ? "GitLab" : "GitHub"}...`}
            autoFocus
          />

          <div className="max-h-72 overflow-y-auto rounded-md border border-zinc-800">
            {loading ? (
              <div className="px-3 py-8 text-center text-xs text-zinc-500">
                Carregando repositórios...
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-zinc-500">
                {search
                  ? "Nenhum repositório corresponde à busca"
                  : "Nenhum repositório encontrado. Verifique o token do provedor em Configurações."}
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
                        privado
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
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Provedor
            </label>
            <div className="flex gap-2">
              {(["github", "gitlab"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCreateProvider(p)}
                  className="flex-1 text-xs font-medium py-2 rounded-md border cursor-pointer transition-colors"
                  style={{
                    background: createProvider === p ? "var(--accent-muted)" : "transparent",
                    borderColor: createProvider === p ? "var(--accent)" : "var(--border-default)",
                    color: createProvider === p ? "var(--accent-text)" : "var(--text-muted)",
                  }}
                >
                  {p === "github" ? "GitHub" : "GitLab"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Nome do repositório *
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="my-new-project"
              required
              autoFocus
            />
            <p className="text-xs mt-1" style={{ color: "var(--text-dimmed)" }}>
              Será criado na sua conta {createProvider === "gitlab" ? "GitLab" : "GitHub"} via API
            </p>
          </div>

          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--text-muted)" }}
            >
              Descrição
            </label>
            <Input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Descrição opcional..."
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
              {newIsPrivate ? (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                  <path d="M5.5 7V5.5a2.5 2.5 0 1 1 5 0V7" />
                </svg>
              ) : (
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
                  <path d="M10.5 7V5.5a2.5 2.5 0 1 0-5 0" />
                </svg>
              )}
              {newIsPrivate ? "Privado (recomendado)" : "Público"}
            </span>
          </label>

          {createError && (
            <p className="text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded px-3 py-2">
              {createError}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!newName.trim() || creating}>
              {creating ? "Criando..." : "Criar e adicionar"}
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleManualSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              URL do repositório *
            </label>
            <Input
              value={manualUrl}
              onChange={(e) => setManualUrl(e.target.value)}
              placeholder="https://github.com/user/repo"
              required
              autoFocus
            />
            <p className="text-xs text-zinc-600 mt-1">
              URL GitHub/GitLab ou caminho local. A branch é detectada automaticamente.
            </p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={!manualUrl.trim()}>
              Adicionar
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
