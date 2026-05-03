import type { Repository, TaskWithRun } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon: string;
  group: string;
  /** Indexes in label that match the query (for highlight rendering) */
  matchIdxs?: number[];
  onSelect: () => void;
}

interface CommandPaletteProps {
  tasks: TaskWithRun[];
  repos: Repository[];
  onClose: () => void;
  onSelectTask: (task: TaskWithRun) => void;
  onSelectRepo?: (repoId: string) => void;
  onNewTask: () => void;
  onAddRepo: () => void;
  onOpenSettings: () => void;
  onOpenSkills?: () => void;
  onOpenEngines?: () => void;
  onOpenStats?: () => void;
  onOpenRuntimes?: () => void;
  onOpenInbox?: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  backlog: "○",
  in_progress: "◉",
  review: "◎",
  done: "●",
  failed: "✕",
};

const MAX_RESULTS = 30;

function fuzzyScore(text: string, query: string): { score: number; matchIdxs: number[] } {
  if (!query) return { score: 1, matchIdxs: [] };
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  const exactIdx = t.indexOf(q);
  if (exactIdx >= 0) {
    const idxs = Array.from({ length: q.length }, (_, i) => exactIdx + i);
    return { score: 2, matchIdxs: idxs };
  }
  const matchIdxs: number[] = [];
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      matchIdxs.push(i);
      qi++;
    }
  }
  const score = qi === q.length ? matchIdxs.length / q.length : 0;
  return { score, matchIdxs };
}

function HighlightedLabel({ label, matchIdxs }: { label: string; matchIdxs?: number[] }) {
  if (!matchIdxs || matchIdxs.length === 0) {
    return (
      <span className="text-sm font-bold tracking-tight text-primary block truncate">{label}</span>
    );
  }
  const idxSet = new Set(matchIdxs);
  return (
    <span className="text-sm font-bold tracking-tight text-primary block truncate">
      {label.split("").map((ch, i) => {
        const key = `${i}-${ch}`;
        return idxSet.has(i) ? (
          <span key={key} className="text-accent underline underline-offset-2 decoration-2">
            {ch}
          </span>
        ) : (
          <span key={key}>{ch}</span>
        );
      })}
    </span>
  );
}

export function CommandPalette({
  tasks,
  repos,
  onClose,
  onSelectTask,
  onSelectRepo,
  onNewTask,
  onAddRepo,
  onOpenSettings,
  onOpenSkills,
  onOpenEngines,
  onOpenStats,
  onOpenRuntimes,
  onOpenInbox,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo(() => {
    const q = query.trim();

    const staticActions: Action[] = [
      {
        id: "new-task",
        label: "New Task",
        description: "Create a new agent task",
        icon: "+",
        group: "General",
        onSelect: () => {
          onNewTask();
          onClose();
        },
      },
      {
        id: "add-repo",
        label: "Add Repository",
        description: "Clone a new Git repository",
        icon: "⊕",
        group: "General",
        onSelect: () => {
          onAddRepo();
          onClose();
        },
      },
      {
        id: "settings",
        label: "Settings",
        description: "System configuration",
        icon: "⚙",
        group: "General",
        onSelect: () => {
          onOpenSettings();
          onClose();
        },
      },
      ...(onOpenSkills
        ? [
            {
              id: "open-skills",
              label: "Skills Registry",
              description: "Manage rules and agent skills",
              icon: "✦",
              group: "Intelligence",
              onSelect: () => {
                onOpenSkills();
                onClose();
              },
            },
          ]
        : []),
      ...(onOpenEngines
        ? [
            {
              id: "open-engines",
              label: "AI Engines",
              description: "View AI providers and status",
              icon: "◈",
              group: "Intelligence",
              onSelect: () => {
                onOpenEngines();
                onClose();
              },
            },
          ]
        : []),
      ...(onOpenStats
        ? [
            {
              id: "open-stats",
              label: "Operational Stats",
              description: "Usage and effectiveness metrics",
              icon: "▦",
              group: "Intelligence",
              onSelect: () => {
                onOpenStats();
                onClose();
              },
            },
          ]
        : []),
      ...(onOpenRuntimes
        ? [
            {
              id: "open-runtimes",
              label: "Compute Runtimes",
              description: "Local compute and capacity",
              icon: "▣",
              group: "General",
              onSelect: () => {
                onOpenRuntimes();
                onClose();
              },
            },
          ]
        : []),
      ...(onOpenInbox
        ? [
            {
              id: "open-inbox",
              label: "Operations Inbox",
              description: "Failures, reviews and signals",
              icon: "▤",
              group: "Intelligence",
              onSelect: () => {
                onOpenInbox();
                onClose();
              },
            },
          ]
        : []),
    ];

    const taskItems: Action[] = tasks
      .map((t) => {
        const { score, matchIdxs } = fuzzyScore(
          `${t.title} ${t.description ?? ""} ${t.repo?.name ?? ""}`,
          q
        );
        return {
          score,
          action: {
            id: `task-${t.id}`,
            label: t.title,
            description: `${t.repo?.name ?? ""}${t.branchName ? ` · ${t.branchName}` : ""}`,
            icon: STATUS_ICONS[t.status] ?? "○",
            group: "Tasks",
            matchIdxs,
            onSelect: () => {
              onSelectTask(t);
              onClose();
            },
          },
        };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((x) => x.action);

    const repoItems: Action[] = repos
      .filter((r) => !q || fuzzyScore(r.name, q).score > 0)
      .map((r) => {
        const { matchIdxs } = fuzzyScore(r.name, q);
        return {
          id: `repo-${r.id}`,
          label: r.name,
          description: r.url,
          icon: "⬡",
          group: "Repositories",
          matchIdxs,
          onSelect: () => {
            onSelectRepo?.(r.id);
            onClose();
          },
        };
      });

    const actionItems = q
      ? staticActions
          .map((a) => {
            const { score, matchIdxs } = fuzzyScore(a.label, q);
            return { score, action: { ...a, matchIdxs } };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.action)
      : staticActions;

    return [...actionItems, ...taskItems, ...repoItems];
  }, [
    query,
    tasks,
    repos,
    onSelectTask,
    onSelectRepo,
    onClose,
    onNewTask,
    onAddRepo,
    onOpenSettings,
    onOpenSkills,
    onOpenEngines,
    onOpenStats,
    onOpenRuntimes,
    onOpenInbox,
  ]);

  useEffect(() => setActiveIdx(0), []);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, items.length - 1));
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    }
    if (e.key === "Enter") {
      e.preventDefault();
      items[activeIdx]?.onSelect();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const grouped = useMemo(() => {
    const groups: { label: string; items: (Action & { idx: number })[] }[] = [];
    let globalIdx = 0;
    for (const item of items) {
      let group = groups.find((g) => g.label === item.group);
      if (!group) {
        group = { label: item.group, items: [] };
        groups.push(group);
      }
      group.items.push({ ...item, idx: globalIdx++ });
    }
    return groups;
  }, [items]);

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[12vh] p-4">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/70 backdrop-blur-md transition-all animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl glass-panel border border-white/10 rounded-[2.5rem] shadow-2xl shadow-black/80 overflow-hidden animate-in slide-in-from-top-4 duration-300 ease-out">
        <div className="flex items-center gap-4 px-6 py-5 border-b border-white/5 bg-white/[0.02]">
          <span className="text-accent text-lg font-black shrink-0 ml-1">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search tasks, repositories, or commands..."
            className="flex-1 bg-transparent text-base font-bold text-primary placeholder:text-muted focus:outline-none"
          />
          <kbd className="shrink-0 text-[9px] font-black uppercase tracking-widest text-muted border border-white/10 rounded-lg px-2 py-1 bg-white/5">
            esc
          </kbd>
        </div>

        <div
          ref={listRef}
          className="max-h-[480px] overflow-y-auto py-4 px-3 custom-scrollbar bg-black/10"
        >
          {grouped.length === 0 && (
            <div className="py-20 text-center space-y-2 opacity-40">
              <p className="text-4xl">∅</p>
              <p className="text-xs font-black uppercase tracking-widest">No results found</p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="px-4 py-2 text-[9px] font-black text-accent/70 uppercase tracking-[0.2em] mb-1">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-idx={item.idx}
                    onClick={item.onSelect}
                    onMouseEnter={() => setActiveIdx(item.idx)}
                    className={`w-full flex items-center gap-4 px-4 py-3 rounded-2xl text-left transition-all group active-shrink cursor-pointer ${item.idx === activeIdx ? "bg-accent text-white shadow-lg shadow-accent/20" : "hover:bg-white/5"}`}
                  >
                    <span
                      className={`text-sm font-mono w-6 shrink-0 text-center transition-colors ${item.idx === activeIdx ? "text-white" : "text-accent opacity-70"}`}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1 min-w-0">
                      <HighlightedLabel label={item.label} matchIdxs={item.matchIdxs} />
                      {item.description && (
                        <span
                          className={`text-[11px] block truncate mt-0.5 transition-colors ${item.idx === activeIdx ? "text-white/70" : "text-muted"}`}
                        >
                          {item.description}
                        </span>
                      )}
                    </span>
                    {item.idx === activeIdx && (
                      <span className="text-[10px] font-black uppercase tracking-widest text-white/50 animate-in fade-in slide-in-from-right-1 duration-200">
                        Select ↵
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t border-white/5 bg-white/[0.02] px-6 py-3 flex items-center gap-6 text-[9px] font-black uppercase tracking-widest text-muted">
          <div className="flex items-center gap-1.5">
            <kbd className="border border-white/10 bg-white/5 rounded px-1.5 py-0.5 text-dimmed leading-none">
              ↑↓
            </kbd>
            <span>Navigate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="border border-white/10 bg-white/5 rounded px-1.5 py-0.5 text-dimmed leading-none">
              ↵
            </kbd>
            <span>Select</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="border border-white/10 bg-white/5 rounded px-1.5 py-0.5 text-dimmed leading-none">
              Esc
            </kbd>
            <span>Close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
