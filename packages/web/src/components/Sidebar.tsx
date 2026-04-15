import type { Repository } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { getProviderFromUrl } from "./ui/git-icons";

const SIDEBAR_WIDTH_KEY = "vibe-code-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "vibe-code-sidebar-collapsed";
const MIN_WIDTH = 200;
const MAX_WIDTH = 460;
const DEFAULT_WIDTH = 280;

function readStoredWidth(): number {
  try {
    const v = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch {}
  return DEFAULT_WIDTH;
}

function readStoredCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {}
  return false;
}

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
  const [width, setWidth] = useState(readStoredWidth);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const selectedRepo = repos.find((repo) => repo.id === selectedRepoId) ?? null;

  const filtered = search
    ? repos.filter(
        (r) =>
          r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.url.toLowerCase().includes(search.toLowerCase())
      )
    : repos;

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [width]
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth.current + e.clientX - startX.current)
      );
      setWidth(next);
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(startWidth.current + 0));
      } catch {}
      // persist latest after drag ends — read from DOM width via ref is simplest:
      setWidth((w) => {
        try {
          localStorage.setItem(SIDEBAR_WIDTH_KEY, String(w));
        } catch {}
        return w;
      });
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const sidebarWidth = collapsed ? 52 : width;

  return (
    <aside
      className="relative shrink-0 border-r flex flex-col glass-panel transition-[width] duration-150"
      style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
    >
      {/* Drag handle */}
      {!collapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: resize handle requires mouse events
        <div
          onMouseDown={onMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-20 group/handle hover:bg-blue-500/30 transition-colors"
          title="Arrastar para redimensionar"
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-10 bg-zinc-700/50 group-hover/handle:bg-blue-400/60 transition-colors" />
        </div>
      )}

      {/* Collapsed icon-rail */}
      {collapsed ? (
        <div className="flex flex-col items-center py-3 gap-2 flex-1 overflow-hidden">
          {/* Expand button */}
          <button
            type="button"
            onClick={toggleCollapse}
            title="Expandir sidebar"
            className="p-2 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/60 transition-all cursor-pointer"
          >
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 3l5 5-5 5" />
            </svg>
          </button>
          <span
            className={`w-1.5 h-1.5 rounded-full mt-1 ${connected ? "bg-emerald-400" : "bg-zinc-600"}`}
            title={connected ? "Conectado" : "Desconectado"}
          />
          <div className="flex-1" />
          {onOpenSkills && (
            <button
              type="button"
              onClick={onOpenSkills}
              title="Skills & Regras"
              className="p-2 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
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
          {onOpenStats && (
            <button
              type="button"
              onClick={onOpenStats}
              title="Estatísticas"
              className="p-2 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
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
          <button
            type="button"
            onClick={onOpenSettings}
            title="Configurações"
            className="p-2 rounded-md text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
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
      ) : (
        <>
          {/* Brand header */}
          <div className="px-4 pt-4 pb-3 border-b border-white/[0.05]">
            <div className="flex items-center gap-2 mb-0.5">
              <button
                type="button"
                onClick={toggleCollapse}
                title="Recolher sidebar"
                className="p-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/60 transition-all cursor-pointer"
              >
                <svg
                  aria-hidden="true"
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M10 3l-5 5 5 5" />
                </svg>
              </button>
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
                  Clone: {selectedRepo.localPath ? "pronto" : "ausente"}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onDeleteLocalClone(selectedRepo.id)}
                  title="Apagar clone local do repositório selecionado"
                  disabled={!selectedRepo.localPath}
                >
                  ✕
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
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg text-xs focus:outline-none transition-colors"
                  style={{
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-default)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            )}

            {/* Repo list */}
            <div className="space-y-0.5 overflow-y-auto flex-1">
              {/* All repos option */}
              <button
                type="button"
                onClick={() => onSelectRepo(null)}
                className="w-full text-left px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer"
                style={{
                  background: selectedRepoId === null ? "var(--accent-muted)" : "transparent",
                  color: selectedRepoId === null ? "var(--text-primary)" : "var(--text-muted)",
                }}
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
                      className="flex flex-1 items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-all cursor-pointer text-left"
                      style={{
                        background: isSelected ? "var(--accent-muted)" : "transparent",
                        color: isSelected ? "var(--text-primary)" : "var(--text-muted)",
                      }}
                      onClick={() => onSelectRepo(repo.id)}
                    >
                      <span
                        className={`shrink-0 ${isSelected ? prov.color : ""}`}
                        style={isSelected ? {} : { color: "var(--text-muted)" }}
                      >
                        <ProvIcon size={13} />
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="block truncate font-medium">{repo.name}</span>
                        {repo.status === "error" && repo.errorMessage && (
                          <span className="block text-[9px] text-red-400/80 truncate mt-0.5">
                            {repo.errorMessage}
                          </span>
                        )}
                      </div>
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
        </>
      )}
    </aside>
  );
}
