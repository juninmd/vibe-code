import type { Repository } from "@vibe-code/shared";
import { useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getProviderFromUrl } from "./ui/git-icons";

const statusMeta: Record<
  string,
  { variant: "default" | "success" | "warning" | "danger" | "info"; label: string }
> = {
  pending: { variant: "warning", label: "pending" },
  cloning: { variant: "info", label: "cloning" },
  ready: { variant: "success", label: "ready" },
  error: { variant: "danger", label: "error" },
};

interface SidebarProps {
  repos: Repository[];
  selectedRepoId: string | null;
  onSelectRepo: (id: string | null) => void;
  onAddRepo: () => void;
  onRemoveRepo: (id: string) => void;
  onDeleteLocalClone: (id: string) => void;
  onDeleteAllLocalClones: () => void;
  onOpenSettings: () => void;
  onOpenStats?: () => void;
  onOpenSkills?: () => void;
  connected: boolean;
  repoStats?: Record<string, { total: number; done: number; failed: number; running: number }>;
}

export function Sidebar({
  repos,
  selectedRepoId,
  onSelectRepo,
  onAddRepo,
  onRemoveRepo,
  onDeleteLocalClone,
  onDeleteAllLocalClones,
  onOpenSettings,
  onOpenStats,
  onOpenSkills,
  connected,
  repoStats,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;

  const filtered = search
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.url.toLowerCase().includes(search.toLowerCase())
      )
    : repos;

  return (
    <aside className="w-64 shrink-0 border-r flex flex-col glass-panel">
      {/* Brand header */}
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
        <div className="flex items-center gap-2 mb-0.5">
          <h1
            className="text-[15px] font-bold flex-1 tracking-tight"
            style={{
              background: "linear-gradient(90deg, #e4e4e7 0%, #a1a1aa 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Vibe Code
          </h1>
          <span
            className={`w-1.5 h-1.5 rounded-full transition-colors ${connected ? "bg-emerald-400" : "bg-zinc-600"}`}
            title={connected ? "Conectado" : "Desconectado"}
          />
          {onOpenStats && (
            <button
              type="button"
              onClick={onOpenStats}
              aria-label="Abrir estatísticas"
              title="Estatísticas"
              className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="8" width="3" height="6" rx="0.5" />
                <rect x="6.5" y="4" width="3" height="10" rx="0.5" />
                <rect x="11" y="2" width="3" height="12" rx="0.5" />
              </svg>
            </button>
          )}
          {onOpenSkills && (
            <button
              type="button"
              onClick={onOpenSkills}
              aria-label="Abrir skills e regras"
              title="Skills & Regras"
              className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 3h12M2 7h8M2 11h10M2 15h6" />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Abrir configurações"
            title="Configurações"
            className="p-1 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="8" cy="8" r="2" />
              <path d="M8 2v1M8 13v1M2 8h1M13 8h1M3.93 3.93l.7.7M11.37 11.37l.7.7M3.93 12.07l.7-.7M11.37 4.63l.7-.7" />
            </svg>
          </button>
        </div>
        <p className="text-[11px] text-zinc-600">AI Agent Task Manager</p>
      </div>

      <div className="p-3 flex-1 flex flex-col overflow-hidden gap-2">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider px-0.5">
            Repositórios
          </h2>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={onDeleteAllLocalClones}
              title="Apagar todos os clones locais"
            >
              ⌫
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onAddRepo}
              title="Adicionar repositório (Ctrl+O)"
            >
              +
            </Button>
          </div>
        </div>

        {selectedRepo && (
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800/70 bg-zinc-900/40 px-2 py-1.5">
            <span className="truncate flex-1 text-[11px] text-zinc-500">
              Clone local: {selectedRepo.localPath ? "pronto" : "ausente"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDeleteLocalClone(selectedRepo.id)}
              title="Apagar clone local do repositório selecionado"
              disabled={!selectedRepo.localPath}
            >
              Apagar clone
            </Button>
          </div>
        )}

        {/* Filter input */}
        {repos.length > 1 && (
          <div className="relative">
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-600 pointer-events-none"
            >
              <circle cx="7" cy="7" r="4" />
              <path d="M11 11l3 3" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrar..."
              className="w-full pl-7 pr-3 py-1.5 rounded-lg border border-zinc-800/80 bg-zinc-900/60 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-700 transition-colors"
            />
          </div>
        )}

        {/* Repo list */}
        <div className="space-y-0.5 overflow-y-auto flex-1">
          {/* All repos option */}
          <button
            type="button"
            onClick={() => onSelectRepo(null)}
            className={`w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer ${
              selectedRepoId === null
                ? "bg-zinc-800/80 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 flex items-center justify-center text-zinc-600 text-[11px]">
                ◈
              </span>
              <span className="font-medium">Todos</span>
              {repos.length > 0 && (
                <span className="ml-auto text-[10px] text-zinc-600">{repos.length}</span>
              )}
            </div>
          </button>

          {filtered.map((repo) => {
            const prov = getProviderFromUrl(repo.url);
            const ProvIcon = prov.icon;
            const meta = statusMeta[repo.status] ?? {
              variant: "default" as const,
              label: repo.status,
            };
            const isSelected = selectedRepoId === repo.id;

            return (
              <div key={repo.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  className={`flex flex-1 items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer text-left ${
                    isSelected
                      ? "bg-zinc-800/80 text-zinc-100 shadow-sm"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
                  onClick={() => onSelectRepo(repo.id)}
                >
                  <span className={`shrink-0 ${isSelected ? prov.color : "text-zinc-600"}`}>
                    <ProvIcon size={13} />
                  </span>
                  <span className="truncate flex-1 font-medium">{repo.name}</span>
                  {repo.status !== "ready" && (
                    <Badge variant={meta.variant} className="text-[9px] py-0 px-1 shrink-0">
                      {meta.label}
                    </Badge>
                  )}
                  {repoStats?.[repo.id] && repo.status === "ready" && (
                    <span className="text-[9px] text-zinc-600 shrink-0 tabular-nums">
                      {repoStats[repo.id].total > 0 &&
                        `${repoStats[repo.id].done}/${repoStats[repo.id].total}`}
                      {repoStats[repo.id].running > 0 && ` ⚡`}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Remover repositório ${repo.name}`}
                  onClick={() => onRemoveRepo(repo.id)}
                  className="opacity-0 group-hover:opacity-100 shrink-0 text-zinc-700 hover:text-red-400 transition-all cursor-pointer ml-0.5"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {repos.length === 0 && (
            <div className="text-zinc-700 px-2.5 py-6 text-center text-[11px] space-y-1">
              <p className="text-xl">📂</p>
              <p>Nenhum repositório</p>
            </div>
          )}

          {repos.length > 0 && filtered.length === 0 && (
            <p className="text-xs text-zinc-700 px-2.5 py-4 text-center">Nenhum resultado</p>
          )}
        </div>
      </div>
    </aside>
  );
}
