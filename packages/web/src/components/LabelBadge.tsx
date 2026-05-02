import type { Label } from "@vibe-code/shared";

interface LabelBadgeProps {
  label: Label;
  onRemove?: () => void;
  size?: "sm" | "md";
}

export function LabelBadge({ label, onRemove, size = "md" }: LabelBadgeProps) {
  const sizeClass = size === "sm" ? "text-[9px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${sizeClass}`}
      style={{
        backgroundColor: `${label.color}22`,
        borderColor: `${label.color}55`,
        color: label.color,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: label.color }}
      />
      {label.name}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 opacity-60 hover:opacity-100 cursor-pointer leading-none"
          aria-label={`Remove label ${label.name}`}
        >
          ×
        </button>
      )}
    </span>
  );
}
