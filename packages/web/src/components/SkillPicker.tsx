import type { SkillEntry } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";

interface SkillPickerProps {
  skills: SkillEntry[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
}

/** Compact popover to toggle the skills injected into a task workspace. */
export function SkillPicker({ skills, selected, onChange, disabled }: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter(
      (skill) =>
        !q || skill.name.toLowerCase().includes(q) || skill.description.toLowerCase().includes(q)
    );
  }, [skills, query]);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: container only intercepts Escape for its popover
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          // Close only the popover, not the whole task panel behind it.
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover disabled:opacity-50"
      >
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        >
          <path d="M8 2v12M2 8h12" />
        </svg>
        Skills
        {selected.length > 0 && (
          <span className="rounded bg-accent/20 px-1.5 text-[10px] font-semibold text-accent-text">
            {selected.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 overflow-hidden rounded-lg border border-white/10 bg-bg-app shadow-2xl shadow-black/60">
          {skills.length > 6 && (
            <input
              // biome-ignore lint/a11y/noAutofocus: opened on demand by the user
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search skills..."
              className="w-full border-b border-white/10 bg-transparent px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-dimmed"
            />
          )}
          <ul className="max-h-64 overflow-y-auto py-1">
            {visible.length === 0 && (
              <li className="px-3 py-3 text-xs text-text-dimmed">
                {skills.length === 0 ? "No skills installed yet." : "No match."}
              </li>
            )}
            {visible.map((skill) => {
              const active = selected.includes(skill.name);
              return (
                <li key={skill.name}>
                  <button
                    type="button"
                    onClick={() => toggle(skill.name)}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-hover"
                  >
                    <span
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        active ? "border-accent bg-accent text-white" : "border-white/20"
                      }`}
                    >
                      {active && (
                        <svg
                          aria-hidden="true"
                          width="9"
                          height="9"
                          viewBox="0 0 16 16"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M3 8.5l3.2 3L13 4.5" />
                        </svg>
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-xs font-medium text-text-primary">
                        {skill.name}
                      </span>
                      {skill.description && (
                        <span className="block truncate text-[11px] text-text-dimmed">
                          {skill.description}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
