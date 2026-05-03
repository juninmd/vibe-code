import type { Repository } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { getProviderFromUrl } from "./ui/git-icons";

const SIDEBAR_WIDTH_KEY = "vibe-code-sidebar-width";
const SIDEBAR_COLLAPSED_KEY = "vibe-code-sidebar-collapsed";
const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 320;

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
  onOpenRuntimes?: () => void;
  onOpenTemplates?: () => void;
  onOpenInbox?: () => void;
  onOpenQuickView?: () => void;
  onOpenEngines?: () => void;
  onOpenSchedules?: () => void;
  connected: boolean;
  repoStats?: Record<string, { total: number; done: number; failed: number; running: number }>;
}

export function Sidebar({
  repos,
  selectedRepoId,
  onSelectRepo,
  onAddRepo,
  onRemoveRepo,
  onDeleteLocalClone: _onDeleteLocalClone,
  onDeleteAllLocalClones: _onDeleteAllLocalClones,
  onOpenSettings,
  onOpenStats,
  onOpenSkills,
  onOpenRuntimes,
  onOpenTemplates: _onOpenTemplates,
  onOpenInbox,
  onOpenQuickView: _onOpenQuickView,
  onOpenEngines,
  onOpenSchedules,
  connected,
  repoStats,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [width, setWidth] = useState(readStoredWidth);
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

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
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      } catch {}
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [width]);

  const toggleCollapse = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  const sidebarWidth = collapsed ? 64 : width;

  return (
    <aside
      className="relative shrink-0 border-r flex flex-col glass-panel transition-[width] duration-200 shadow-2xl z-40"
      style={{ width: sidebarWidth, minWidth: sidebarWidth, maxWidth: sidebarWidth }}
    >
      {/* Resizer handle */}
      {!collapsed && (
        <div
          aria-hidden="true"
          onMouseDown={onMouseDown}
          className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize z-50 group hover:bg-accent/40 transition-colors"
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-px h-12 bg-white/5 group-hover:bg-accent/40 transition-colors" />
        </div>
      )}

      {/* Main Container */}
      <div className="flex flex-col h-full overflow-hidden">
        {/* Brand Header */}
        <div className="p-4 flex flex-col gap-5 shrink-0">
          <div className="flex items-center justify-between">
            <div
              className={`flex items-center gap-3 transition-opacity duration-200 ${collapsed ? "opacity-0 invisible w-0" : "opacity-100"}`}
            >
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-accent via-accent to-accent-hover flex items-center justify-center shadow-lg shadow-accent/30 hover:scale-105 transition-transform active-shrink cursor-pointer">
                <span className="text-white font-black text-sm">V</span>
              </div>
              {!collapsed && (
                <div>
                  <h1 className="text-sm font-black tracking-tight text-primary leading-none">
                    Vibe Code
                  </h1>
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-zinc-600"}`}
                    />
                    <span className="text-[9px] font-bold text-muted uppercase tracking-widest leading-none">
                      {connected ? "Connected" : "Offline"}
                    </span>
                  </div>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleCollapse}
              className={`p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-all active-shrink cursor-pointer ${collapsed ? "w-full flex justify-center" : ""}`}
              title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
            >
              {collapsed ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-label="Expand"
                >
                  <path d="M6 3l5 5-5 5" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-label="Collapse"
                >
                  <path d="M10 3L5 8l5 5" />
                </svg>
              )}
            </button>
          </div>

          {!collapsed && (
            <div className="relative group">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-label="Search"
                >
                  <circle cx="7" cy="7" r="5" />
                  <path d="M11 11l4 4" strokeLinecap="round" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search resources..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 rounded-xl text-xs bg-input/50 border border-default focus:border-accent/40 focus:ring-4 focus:ring-accent/10 transition-all outline-none"
              />
            </div>
          )}
        </div>

        {/* Navigation Section */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-6 space-y-1 custom-scrollbar">
          {!collapsed && (
            <div className="px-2 mb-2 flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-[0.15em] text-dimmed">
                Explorer
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onAddRepo}
                  className="p-1.5 rounded-lg hover:bg-surface-hover text-muted hover:text-accent transition-colors active-shrink cursor-pointer"
                  title="Add Repository"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-label="Add"
                  >
                    <path d="M8 3v10M3 8h10" />
                  </svg>
                </button>
              </div>
            </div>
          )}

          {/* Special Items */}
          <button
            type="button"
            onClick={() => onSelectRepo(null)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all active-shrink cursor-pointer mb-2 ${
              selectedRepoId === null
                ? "bg-accent text-white shadow-lg shadow-accent/25 border border-accent/20"
                : "text-secondary hover:bg-surface-hover hover:text-primary border border-transparent"
            }`}
            title={collapsed ? "All Workspaces" : ""}
          >
            <div className={`${collapsed ? "w-full flex justify-center" : ""}`}>
              <svg
                width="18"
                height="18"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-label="All Workspaces"
              >
                <rect x="2" y="2" width="12" height="12" rx="2" />
                <path d="M2 6h12M6 2v12" />
              </svg>
            </div>
            {!collapsed && <span className="flex-1 text-left">All Workspaces</span>}
          </button>

          {/* Repo List */}
          {filtered.map((repo) => {
            const { icon: ProviderIcon, color: providerColor } = getProviderFromUrl(repo.url);
            const stats = repoStats?.[repo.id];
            const isSelected = selectedRepoId === repo.id;

            return (
              <div key={repo.id} className="relative group/item mb-0.5">
                <button
                  type="button"
                  onClick={() => onSelectRepo(repo.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all active-shrink cursor-pointer border ${
                    isSelected
                      ? "bg-accent/15 text-accent border-accent/20 shadow-sm"
                      : "text-secondary hover:bg-surface-hover hover:text-primary border-transparent"
                  }`}
                  title={collapsed ? repo.name : ""}
                >
                  <div
                    className={`shrink-0 transition-colors ${collapsed ? "w-full flex justify-center" : isSelected ? "text-accent" : providerColor}`}
                  >
                    <ProviderIcon size={18} />
                  </div>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{repo.name}</span>
                      {stats && stats.running > 0 && (
                        <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse shadow-[0_0_10px_var(--info)]" />
                      )}
                      {stats && stats.total > 0 && !stats.running && (
                        <span className="text-[10px] tabular-nums opacity-40 font-mono">
                          {stats.done}/{stats.total}
                        </span>
                      )}
                    </>
                  )}
                </button>

                {!collapsed && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden group-hover/item:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveRepo(repo.id);
                      }}
                      className="p-1.5 rounded-lg hover:bg-danger/10 text-muted hover:text-danger transition-colors cursor-pointer"
                      title="Remove Repository"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-label="Remove"
                      >
                        <path d="M4 4l8 8M12 4L4 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Secondary Navigation */}
        <div className="p-3 space-y-1.5 border-t border-white/5 bg-surface/30 backdrop-blur-md">
          <SidebarNavItem icon="inbox" label="Inbox" onClick={onOpenInbox} collapsed={collapsed} />
          <SidebarNavItem icon="code" label="Skills" onClick={onOpenSkills} collapsed={collapsed} />
          <SidebarNavItem
            icon="engines"
            label="AI Engines"
            onClick={onOpenEngines}
            collapsed={collapsed}
          />
          <SidebarNavItem
            icon="clock"
            label="Schedules"
            onClick={onOpenSchedules}
            collapsed={collapsed}
          />
          <SidebarNavItem
            icon="grid"
            label="Runtimes"
            onClick={onOpenRuntimes}
            collapsed={collapsed}
          />
          <SidebarNavItem
            icon="stats"
            label="Estatísticas"
            onClick={onOpenStats}
            collapsed={collapsed}
          />
          <SidebarNavItem
            icon="settings"
            label="Configurações"
            onClick={onOpenSettings}
            collapsed={collapsed}
          />
        </div>
      </div>
    </aside>
  );
}

function SidebarNavItem({
  icon,
  label,
  onClick,
  collapsed,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
  collapsed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-bold text-secondary hover:text-primary hover:bg-surface-hover transition-all active-shrink cursor-pointer ${collapsed ? "justify-center" : ""}`}
      title={collapsed ? label : ""}
    >
      <div className="shrink-0 opacity-70">
        {icon === "inbox" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Inbox"
          >
            <path d="M3 3h10l1 5v5H2V8l1-5ZM2 8h4l1 2h2l1-2h4" />
          </svg>
        )}
        {icon === "code" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Skills"
          >
            <path d="M2 3h12M2 7h8M2 11h10M2 15h6" />
          </svg>
        )}
        {icon === "engines" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Engines"
          >
            <path d="M2 4h12M2 8h12M2 12h12M5 4v8M11 4v8" />
          </svg>
        )}
        {icon === "clock" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Schedules"
          >
            <circle cx="8" cy="8" r="7" />
            <path d="M8 3v5l4 2" />
          </svg>
        )}
        {icon === "grid" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Runtimes"
          >
            <rect x="2" y="3" width="12" height="7" rx="1" />
            <path d="M5 13h6M8 10v3" />
          </svg>
        )}
        {icon === "stats" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Stats"
          >
            <path d="M2 13V8h3v5H2ZM6 13V4h3v9H6ZM11 13V1h3v12h-3Z" />
          </svg>
        )}
        {icon === "settings" && (
          <svg
            width="18"
            height="18"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-label="Settings"
          >
            <circle cx="8" cy="8" r="2" />
            <path d="M8 2v1M8 13v1M2 8h1M13 8h1" />
          </svg>
        )}
      </div>
      {!collapsed && <span className="flex-1 text-left">{label}</span>}
    </button>
  );
}
