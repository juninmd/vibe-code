interface Filters {
  engine: string | null;
  priority: number | null;
  hasPR: boolean;
  tags: string[];
}

interface FilterBarProps {
  filters: Filters;
  onFilterChange: (filters: Filters) => void;
  availableEngines: string[];
  availableTags: string[];
  search?: string;
  onSearchChange?: (s: string) => void;
}

const PRIORITIES = [
  { label: "P0", value: 3 },
  { label: "P1", value: 2 },
  { label: "P2", value: 1 },
  { label: "P3", value: 0 },
];

function Chip({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border cursor-pointer transition-all ${
        active
          ? "bg-violet-900/60 border-violet-600 text-violet-200"
          : "bg-zinc-800/60 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
      }`}
    >
      {children}
    </button>
  );
}

export function FilterBar({
  filters,
  onFilterChange,
  availableEngines,
  availableTags,
  search,
  onSearchChange,
}: FilterBarProps) {
  const hasActiveFilter =
    filters.engine !== null ||
    filters.priority !== null ||
    filters.hasPR ||
    filters.tags.length > 0;

  const set = (partial: Partial<Filters>) => onFilterChange({ ...filters, ...partial });

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-zinc-800/60 flex-wrap text-xs">
      {onSearchChange !== undefined && (
        <input
          type="text"
          value={search ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Buscar tarefas..."
          className="bg-zinc-900/60 border border-zinc-700 rounded px-2.5 py-1 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-36 shrink-0"
        />
      )}
      <span className="text-zinc-600 shrink-0">Filtros:</span>

      {availableEngines.map((eng) => (
        <Chip
          key={eng}
          active={filters.engine === eng}
          onClick={() => set({ engine: filters.engine === eng ? null : eng })}
        >
          {eng}
        </Chip>
      ))}

      {PRIORITIES.map((p) => (
        <Chip
          key={p.label}
          active={filters.priority === p.value}
          onClick={() => set({ priority: filters.priority === p.value ? null : p.value })}
        >
          {p.label}
        </Chip>
      ))}

      <Chip active={filters.hasPR} onClick={() => set({ hasPR: !filters.hasPR })}>
        ↗ PR
      </Chip>

      {availableTags.map((tag) => (
        <Chip
          key={tag}
          active={filters.tags.includes(tag)}
          onClick={() =>
            set({
              tags: filters.tags.includes(tag)
                ? filters.tags.filter((t) => t !== tag)
                : [...filters.tags, tag],
            })
          }
        >
          #{tag}
        </Chip>
      ))}

      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => onFilterChange({ engine: null, priority: null, hasPR: false, tags: [] })}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors ml-1"
        >
          ✕ Limpar
        </button>
      )}
    </div>
  );
}

export type { Filters };
