import type { Repository, TaskWithRun } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";

interface Action {
  id: string;
  label: string;
  description?: string;
  icon: string;
  group: string;
  onSelect: () => void;
}

interface CommandPaletteProps {
  tasks: TaskWithRun[];
  repos: Repository[];
  onClose: () => void;
  onSelectTask: (task: TaskWithRun) => void;
  onNewTask: () => void;
  onAddRepo: () => void;
  onOpenSettings: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  backlog: "○",
  in_progress: "◉",
  review: "◎",
  done: "●",
  failed: "✕",
};

function fuzzyScore(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t.includes(q)) return 2;
  let score = 0;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score++;
      qi++;
    }
  }
  return qi === q.length ? score / q.length : 0;
}

export function CommandPalette({
  tasks,
  repos,
  onClose,
  onSelectTask,
  onNewTask,
  onAddRepo,
  onOpenSettings,
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
    ];

    const taskItems: Action[] = tasks
      .map((t) => ({
        score: fuzzyScore(`${t.title} ${t.description ?? ""} ${t.repo?.name ?? ""}`, q),
        action: {
          id: `task-${t.id}`,
          label: t.title,
          description: `${t.repo?.name ?? ""}${t.branchName ? ` · ${t.branchName}` : ""}`,
          icon: STATUS_ICONS[t.status] ?? "○",
          group: "Tasks",
          onSelect: () => {
            onSelectTask(t);
            onClose();
          },
        },
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.action);

    const repoItems: Action[] = repos
      .filter((r) => !q || fuzzyScore(r.name, q) > 0)
      .map((r) => ({
        id: `repo-${r.id}`,
        label: r.name,
        description: r.url,
        icon: "⬡",
        group: "Repositories",
        onSelect: onClose,
      }));

    const actionItems = q ? staticActions.filter((a) => fuzzyScore(a.label, q) > 0) : staticActions;
    return [...actionItems, ...taskItems, ...repoItems];
  }, [query, tasks, repos, onSelectTask, onClose, onNewTask, onAddRepo, onOpenSettings]);

  // Reset active when results change
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset to 0 whenever query changes
  useEffect(() => setActiveIdx(0), [query]);

  // Scroll active item into view
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

  // Group items for rendering
  const grouped = useMemo(() => {
    const groups: { label: string; items: (Action & { idx: number })[] }[] = [];
    let globalIdx = 0;
    const seen = new Set<string>();
    for (const item of items) {
      if (!seen.has(item.group)) {
        seen.add(item.group);
        groups.push({ label: item.group, items: [] });
      }
      groups[groups.length - 1].items.push({ ...item, idx: globalIdx++ });
    }
    return groups;
  }, [items]);

  return (
    <div className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh]">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <span className="text-zinc-500 text-sm shrink-0">⌘</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search tasks, repos, actions..."
            className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd className="shrink-0 text-[10px] text-zinc-600 border border-zinc-700 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2">
          {grouped.length === 0 && (
            <p className="text-center text-zinc-600 text-sm py-8">No results</p>
          )}
          {grouped.map((group) => (
            <div key={group.label}>
              <p className="px-4 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
                {group.label}
              </p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-idx={item.idx}
                  onClick={item.onSelect}
                  onMouseEnter={() => setActiveIdx(item.idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors cursor-pointer ${
                    item.idx === activeIdx ? "bg-zinc-800" : "hover:bg-zinc-800/50"
                  }`}
                >
                  <span className="text-sm font-mono text-zinc-500 w-4 shrink-0 text-center">
                    {item.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="text-sm text-zinc-200 block truncate">{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-zinc-600 block truncate">
                        {item.description}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="border-t border-zinc-800 px-4 py-2 flex items-center gap-4 text-[10px] text-zinc-600">
          <span>
            <kbd className="border border-zinc-700 rounded px-1">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="border border-zinc-700 rounded px-1">↵</kbd> select
          </span>
          <span>
            <kbd className="border border-zinc-700 rounded px-1">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
