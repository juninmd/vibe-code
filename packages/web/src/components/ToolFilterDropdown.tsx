import { useEffect, useRef, useState } from "react";

export interface ToolFilterOption {
  /** Stable key used for membership in `selected`. */
  key: string;
  /** User-facing label rendered in the menu and chip. */
  label: string;
  /** Icon prefix (emoji). */
  icon?: string;
  /** Count of events matching this option in the current data set. */
  count: number;
}

interface ToolFilterDropdownProps {
  options: ToolFilterOption[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onClear: () => void;
}

/**
 * Compact multi-select dropdown ported from multica's transcript dialog.
 * Renders nothing when there are no options so the toolbar stays tight on
 * fresh runs.
 */
export function ToolFilterDropdown({
  options,
  selected,
  onToggle,
  onClear,
}: ToolFilterDropdownProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (options.length === 0) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-mono transition-colors cursor-pointer ${
          selected.size > 0
            ? "text-info bg-info/10 hover:bg-info/20"
            : "text-dimmed hover:text-secondary hover:bg-input"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>⛛ Filter</span>
        {selected.size > 0 && (
          <span className="rounded-full bg-info/30 px-1 text-[9px]">{selected.size}</span>
        )}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 min-w-[180px] max-h-72 overflow-y-auto rounded-md border border-strong bg-app shadow-lg py-1"
        >
          {options.map((opt) => {
            const checked = selected.has(opt.key);
            return (
              <button
                type="button"
                key={opt.key}
                role="menuitemcheckbox"
                aria-checked={checked}
                onClick={() => onToggle(opt.key)}
                className={`flex items-center w-full gap-2 px-2 py-1 text-left text-xs hover:bg-input cursor-pointer ${
                  checked ? "text-secondary" : "text-dimmed"
                }`}
              >
                <span
                  className={`inline-block w-3 h-3 rounded-sm border ${
                    checked ? "bg-info border-info" : "border-default"
                  }`}
                  aria-hidden
                />
                {opt.icon && <span className="text-sm shrink-0">{opt.icon}</span>}
                <span className="flex-1 truncate">{opt.label}</span>
                <span className="text-[10px] opacity-70 tabular-nums">{opt.count}</span>
              </button>
            );
          })}
          {selected.size > 0 && (
            <>
              <div className="border-t border-default my-1" />
              <button
                type="button"
                onClick={onClear}
                className="w-full text-left px-2 py-1 text-[11px] text-dimmed hover:text-secondary hover:bg-input cursor-pointer"
              >
                Clear filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
