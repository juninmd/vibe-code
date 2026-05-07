import { TASK_PRIORITY_LEVELS, TASK_PRIORITY_META, type TaskPriority } from "@vibe-code/shared";

interface Filters {
  engine: string | null;
  priority: TaskPriority | null;
  hasPR: boolean;
  tags: string[];
  labelIds: string[];
}

interface FilterBarProps {
  filters: Filters;
  onFilterChange: (filters: Filters) => void;
  availableEngines: string[];
  availableTags: string[];
  search?: string;
  onSearchChange?: (s: string) => void;
}

const EMPTY_FILTERS: Filters = {
  engine: null,
  priority: null,
  hasPR: false,
  tags: [],
  labelIds: [],
};

function FilterChip({
  active,
  onClick,
  children,
  dot,
  dotColor,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  dot?: boolean;
  dotColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium
        border cursor-pointer transition-all duration-150 select-none
        ${
          active
            ? "bg-violet-500/15 border-violet-500/50 text-violet-300 shadow-sm shadow-violet-500/10"
            : "bg-white/3 border-white/8 text-zinc-400 hover:text-zinc-200 hover:bg-white/6 hover:border-white/15"
        }
      `}
    >
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: dotColor ?? "currentColor" }}
        />
      )}
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-semibold text-zinc-600 uppercase tracking-wider shrink-0 pr-0.5">
        {label}
      </span>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="w-px h-4 bg-white/8 shrink-0" />;
}

const PRIORITY_DOT_COLORS: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#6b7280",
};

export function FilterBar({
  filters,
  onFilterChange,
  availableEngines,
  availableTags,
  search,
  onSearchChange,
}: FilterBarProps) {
  const activeCount = [
    filters.engine !== null,
    filters.priority !== null,
    filters.hasPR,
    filters.tags.length > 0,
    filters.labelIds.length > 0,
  ].filter(Boolean).length;

  const set = (partial: Partial<Filters>) => onFilterChange({ ...filters, ...partial });

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Search */}
      {onSearchChange !== undefined && (
        <div className="relative shrink-0">
          <svg
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-zinc-500 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z"
            />
          </svg>
          <input
            type="text"
            value={search ?? ""}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar tasks..."
            className="bg-white/4 border border-white/10 rounded-lg pl-7 pr-3 py-1 text-[11px] text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-violet-500/50 focus:bg-white/6 transition-all w-40"
          />
        </div>
      )}

      <Divider />

      {/* Engine */}
      {availableEngines.length > 0 && (
        <>
          <FilterGroup label="Engine">
            {availableEngines.map((eng) => (
              <FilterChip
                key={eng}
                active={filters.engine === eng}
                onClick={() => set({ engine: filters.engine === eng ? null : eng })}
              >
                {eng}
              </FilterChip>
            ))}
          </FilterGroup>
          <Divider />
        </>
      )}

      {/* Priority */}
      <FilterGroup label="Prioridade">
        {TASK_PRIORITY_LEVELS.filter((p) => p !== "none").map((p) => {
          const meta = TASK_PRIORITY_META[p];
          return (
            <FilterChip
              key={p}
              active={filters.priority === p}
              dot
              dotColor={PRIORITY_DOT_COLORS[p]}
              onClick={() => set({ priority: filters.priority === p ? null : p })}
            >
              {meta.label}
            </FilterChip>
          );
        })}
      </FilterGroup>

      <Divider />

      {/* Status */}
      <FilterGroup label="Status">
        <FilterChip active={filters.hasPR} onClick={() => set({ hasPR: !filters.hasPR })}>
          <svg
            className="w-3 h-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
            />
          </svg>
          Com PR
        </FilterChip>
      </FilterGroup>

      {/* Tags */}
      {availableTags.length > 0 && (
        <>
          <Divider />
          <FilterGroup label="Tags">
            {availableTags.map((tag) => (
              <FilterChip
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
              </FilterChip>
            ))}
          </FilterGroup>
        </>
      )}

      {/* Clear */}
      {activeCount > 0 && (
        <>
          <Divider />
          <button
            type="button"
            onClick={() => onFilterChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border border-red-500/30 bg-red-500/8 text-red-400 hover:bg-red-500/15 hover:border-red-500/50 transition-all duration-150 cursor-pointer"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            Limpar
            <span className="bg-red-500/20 text-red-300 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
              {activeCount}
            </span>
          </button>
        </>
      )}
    </div>
  );
}

export type { Filters };
