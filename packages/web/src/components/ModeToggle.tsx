import type { AppMode } from "../hooks/useAppMode";

interface ModeToggleProps {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  className?: string;
}

const OPTIONS: { value: AppMode; label: string; icon: string }[] = [
  { value: "code", label: "Code", icon: "M4 17l6-6-6-6M12 19h8" },
  { value: "kanban", label: "Board", icon: "M4 4h4v16H4zM10 4h4v10h-4zM16 4h4v13h-4z" },
];

/** Segmented control that switches between code mode and the kanban board. */
export function ModeToggle({ mode, onChange, className = "" }: ModeToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="View mode"
      className={`inline-flex items-center gap-0.5 rounded-xl border border-default bg-input/30 p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = mode === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors sm:px-2.5 ${
              active
                ? "bg-accent text-white shadow-sm shadow-accent/25"
                : "text-secondary hover:text-primary"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <title>{option.label}</title>
              <path d={option.icon} />
            </svg>
            {/* Labels are hidden on phones so the header never crowds. */}
            <span className="hidden sm:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
