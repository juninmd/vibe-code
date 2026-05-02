import {
  TASK_COMPLEXITY_LEVELS,
  TASK_COMPLEXITY_META,
  TASK_PRIORITY_LEVELS,
  TASK_PRIORITY_META,
  TASK_TYPE_META,
  TASK_TYPES,
  type TaskComplexity,
  type TaskPriority,
  type TaskType,
} from "@vibe-code/shared";

interface Filters {
  engine: string | null;
  priority: TaskPriority | null;
  taskType: TaskType | null;
  taskComplexity: TaskComplexity | null;
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

function Chip({
  active,
  onClick,
  children,
  accentColor,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  accentColor?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border cursor-pointer transition-all ${
        active
          ? "bg-accent-muted border-violet-600 text-accent-text"
          : "bg-surface-hover border-strong text-secondary hover:text-primary hover:border-strong"
      }`}
      style={active && accentColor ? { borderColor: accentColor, color: accentColor } : undefined}
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
    filters.taskType !== null ||
    filters.taskComplexity !== null ||
    filters.hasPR ||
    filters.tags.length > 0 ||
    filters.labelIds.length > 0;

  const set = (partial: Partial<Filters>) => onFilterChange({ ...filters, ...partial });

  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-default flex-wrap text-xs">
      {onSearchChange !== undefined && (
        <input
          type="text"
          value={search ?? ""}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search tasks..."
          className="bg-input border border-strong rounded px-2.5 py-1 text-xs text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500 w-36 shrink-0"
        />
      )}
      <span className="text-dimmed shrink-0">Filtros:</span>

      {availableEngines.map((eng) => (
        <Chip
          key={eng}
          active={filters.engine === eng}
          onClick={() => set({ engine: filters.engine === eng ? null : eng })}
        >
          {eng}
        </Chip>
      ))}

      {TASK_PRIORITY_LEVELS.filter((p) => p !== "none").map((p) => {
        const meta = TASK_PRIORITY_META[p];
        return (
          <Chip
            key={p}
            active={filters.priority === p}
            accentColor={filters.priority === p ? undefined : undefined}
            onClick={() => set({ priority: filters.priority === p ? null : p })}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${meta.bgColor.replace("bg-", "bg-").replace("/10", "")}`}
            />
            {meta.label}
          </Chip>
        );
      })}

      {TASK_TYPES.map((t) => {
        const meta = TASK_TYPE_META[t];
        return (
          <Chip
            key={t}
            active={filters.taskType === t}
            onClick={() => set({ taskType: filters.taskType === t ? null : t })}
          >
            {meta.icon} {meta.label}
          </Chip>
        );
      })}

      {TASK_COMPLEXITY_LEVELS.map((c) => {
        const meta = TASK_COMPLEXITY_META[c];
        return (
          <Chip
            key={c}
            active={filters.taskComplexity === c}
            onClick={() => set({ taskComplexity: filters.taskComplexity === c ? null : c })}
          >
            <span className={`${meta.textColor}`}>{meta.icon}</span>
            {meta.label}
          </Chip>
        );
      })}

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
          onClick={() =>
            onFilterChange({
              engine: null,
              priority: null,
              taskType: null,
              taskComplexity: null,
              hasPR: false,
              tags: [],
              labelIds: [],
            })
          }
          className="text-[11px] text-primary0 hover:text-secondary cursor-pointer transition-colors ml-1"
        >
          ✕ Limpar
        </button>
      )}
    </div>
  );
}

export type { Filters };
