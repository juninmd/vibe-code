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
  // Exact match scores highest
  const exactIdx = t.indexOf(q);
  if (exactIdx >= 0) {
    const idxs = Array.from({ length: q.length }, (_, i) => exactIdx + i);
    return { score: 2, matchIdxs: idxs };
  }
  // Fuzzy match
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
    return <span className="text-sm text-primary block truncate">{label}</span>;
  }
  const idxSet = new Set(matchIdxs);
  return (
    <span className="text-sm text-primary block truncate">
      {label.split("").map((ch, i) => {
        const key = `${i}-${ch}`;
        return idxSet.has(i) ? (
          <span key={key} className="text-accent-text font-semibold">
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
        group: "Actions",
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
        group: "Actions",
        onSelect: () => {
          onAddRepo();
          onClose();
        },
      },
      {
        id: "settings",
        label: "Settings",
        description: "Open settings",
        icon: "⚙",
        group: "Actions",
        onSelect: () => {
          onOpenSettings();
          onClose();
        },
      },
      ...(onOpenSkills
        ? [
            {
              id: "open-skills",
              label: "Skills & Regras",
              description: "Gerenciar skills, regras e agentes",
              icon: "✦",
              group: "Actions",
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
              label: "Engines",
              description: "Ver status dos agentes de IA",
              icon: "◈",
              group: "Actions",
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
              label: "Estatísticas",
              description: "Ver estatísticas de tasks",
              icon: "▦",
              group: "Actions",
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
              label: "Runtimes",
              description: "Ver compute local, engines e capacidade",
              icon: "▣",
              group: "Actions",
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
              label: "Inbox",
              description: "Ver falhas, reviews e sinais operacionais",
              icon: "▤",
              group: "Actions",
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset to 0 whenever query changes
  useEffect(() => setActiveIdx(0), [query]);

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
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      <button
        type="button"
        aria-label="Close command palette"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative w-full max-w-xl glass-dialog border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.07]">
          <span className="text-primary0 text-sm shrink-0">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search tasks, repos, actions..."
            className="flex-1 bg-transparent text-sm text-primary placeholder:text-dimmed focus:outline-none"
          />
          <kbd className="shrink-0 text-[10px] text-dimmed border border-strong rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2">
          {grouped.length === 0 && (
            <p className="text-center text-dimmed text-sm py-8">No results</p>
          )}
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="px-4 py-1.5 text-[10px] font-semibold text-dimmed uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-idx={item.idx}
                  onClick={item.onSelect}
                  onMouseEnter={() => setActiveIdx(item.idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors cursor-pointer ${item.idx === activeIdx ? "bg-surface" : "hover:bg-surface-hover/50"}`}
                >
                  <span className="text-sm font-mono text-primary0 w-4 shrink-0 text-center">
                    {item.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <HighlightedLabel label={item.label} matchIdxs={item.matchIdxs} />
                    {item.description && (
                      <span className="text-xs text-dimmed block truncate">{item.description}</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="border-t border-default px-4 py-2 flex items-center gap-4 text-[10px] text-dimmed">
          <span>
            <kbd className="border border-strong rounded px-1">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="border border-strong rounded px-1">↵</kbd> select
          </span>
          <span>
            <kbd className="border border-strong rounded px-1">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
