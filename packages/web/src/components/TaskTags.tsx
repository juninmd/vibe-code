const TAG_COLORS = [
  "bg-red-900/60 text-red-300 border-red-700/50",
  "bg-orange-900/60 text-orange-300 border-orange-700/50",
  "bg-yellow-900/60 text-yellow-300 border-yellow-700/50",
  "bg-green-900/60 text-green-300 border-green-700/50",
  "bg-teal-900/60 text-teal-300 border-teal-700/50",
  "bg-blue-900/60 text-blue-300 border-blue-700/50",
  "bg-violet-900/60 text-violet-300 border-violet-700/50",
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
}

export function TaskTagsEditor({ tags, onChange }: TaskTagsEditorProps) {
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
    <div className="flex flex-wrap gap-1 items-center min-h-[28px] bg-zinc-800/60 border border-zinc-700 rounded-md px-2 py-1 focus-within:border-zinc-500">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} onRemove={() => onChange(tags.filter((t) => t !== tag))} />
      ))}
      <input
        type="text"
        onKeyDown={handleKeyDown}
        placeholder={tags.length === 0 ? "Add tag, press Enter…" : ""}
        className="flex-1 min-w-[80px] bg-transparent text-xs text-zinc-300 placeholder-zinc-600 outline-none"
      />
    </div>
  );
}
