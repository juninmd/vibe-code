const TAG_COLORS = [
  "bg-danger/15 text-danger border-danger/30",
  "bg-orange-900/60 text-orange-300 border-orange-700/50",
  "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
  "bg-green-900/60 text-green-300 border-green-700/50",
  "bg-teal-900/60 text-teal-300 border-teal-700/50",
  "bg-info/15 text-info border-info/30",
  "bg-accent-muted text-accent-text border-accent/30",
  "bg-pink-900/60 text-pink-300 border-pink-700/50",
];

function tagColor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = (hash * 31 + tag.charCodeAt(i)) & 0xff_ff_ff_ff;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

interface TagChipProps {
  tag: string;
  onRemove?: () => void;
  small?: boolean;
}

export function TagChip({ tag, onRemove, small }: TagChipProps) {
  const color = tagColor(tag);
  return (
    <span
      className={`inline-flex items-center gap-0.5 border rounded-full font-medium ${color} ${small ? "text-[9px] px-1 py-0" : "text-[11px] px-1.5 py-0.5"}`}
    >
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 cursor-pointer leading-none"
          aria-label={`Remove tag ${tag}`}
        >
          ✕
        </button>
      )}
    </span>
  );
}

interface TaskTagsDisplayProps {
  tags: string[];
  small?: boolean;
}

export function TaskTagsDisplay({ tags, small }: TaskTagsDisplayProps) {
  if (!tags || tags.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} small={small} />
      ))}
    </div>
  );
}

interface TaskTagsEditorProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  compact?: boolean;
}

export function TaskTagsEditor({ tags, onChange, compact }: TaskTagsEditorProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const value = input.value.trim().replace(/,$/, "");
      if (value && !tags.includes(value)) {
        onChange([...tags, value]);
      }
      input.value = "";
    } else if (e.key === "Backspace" && input.value === "" && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div
      className={`flex flex-wrap gap-1 items-center bg-surface-hover border border-strong rounded-md px-2 py-1 focus-within:border-zinc-500 ${compact ? "min-h-[24px]" : "min-h-[28px]"}`}
    >
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <input
        type="text"
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? "Add tag, press Enter…" : ""}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-secondary placeholder-zinc-600 outline-none"
      />
    </div>
  );
}
