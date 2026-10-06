import type { AppliedSkill, SkillEntry, SkillPlan } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";

interface SkillPickerProps {
  /** Every installed skill. */
  skills: SkillEntry[];
  /** What is applied now and why; null while loading. */
  plan: SkillPlan | null;
  /** The operator's complete list of picks (built-ins excluded). Makes the plan manual. */
  onChange: (picks: string[]) => void;
  /** Hand the choice back to vibe-code. */
  onAuto: () => void;
  /** Shown under the list, e.g. "Applies when the session restarts". */
  notice?: string;
  /** Which edge of the button the popover lines up with (default: right). */
  align?: "left" | "right";
  disabled?: boolean;
}

function SparkIcon({ size = 11 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className="shrink-0"
    >
      <path d="M8 1l1.6 4.4L14 7l-4.4 1.6L8 13l-1.6-4.4L2 7l4.4-1.6z" />
    </svg>
  );
}

function LockIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className="shrink-0"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </svg>
  );
}

export function picksOf(applied: AppliedSkill[]): string[] {
  return applied.filter((skill) => skill.source !== "always").map((skill) => skill.name);
}

export function ModeBadge({ mode }: { mode: SkillPlan["mode"] }) {
  return mode === "auto" ? (
    <span className="inline-flex items-center gap-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-text">
      <SparkIcon size={9} />
      Auto
    </span>
  ) : (
    <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-secondary">
      Manual
    </span>
  );
}

/** Popover to review and change the skills of a task's agent plugin. */
export function SkillPicker({
  skills,
  plan,
  onChange,
  onAuto,
  notice,
  align = "right",
  disabled,
}: SkillPickerProps) {
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

  const applied = plan?.applied ?? [];
  const appliedByName = useMemo(
    () => new Map(applied.map((skill) => [skill.name, skill])),
    [applied]
  );
  const picks = picksOf(applied);

  // Applied skills first, so the operator sees what is on before what could be.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (name: string, description: string) =>
      !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
    const installed = new Set(skills.map((skill) => skill.name));
    const missing = applied
      .filter((skill) => !installed.has(skill.name))
      .map((skill) => ({ name: skill.name, description: "" }));
    return [...skills, ...missing]
      .filter((skill) => matches(skill.name, skill.description))
      .sort(
        (a, b) =>
          Number(appliedByName.has(b.name)) - Number(appliedByName.has(a.name)) ||
          a.name.localeCompare(b.name)
      );
  }, [skills, applied, appliedByName, query]);

  const toggle = (name: string) =>
    onChange(picks.includes(name) ? picks.filter((n) => n !== name) : [...picks, name]);

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
        <SparkIcon />
        Skills
        {applied.length > 0 && (
          <span className="rounded bg-accent/20 px-1.5 text-[10px] font-semibold text-accent-text">
            {applied.length}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute ${align === "left" ? "left-0" : "right-0"} top-full z-30 mt-1.5 w-80 overflow-hidden rounded-lg border border-white/10 bg-bg-app shadow-2xl shadow-black/60`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-primary">Agent plugin</span>
              {plan && <ModeBadge mode={plan.mode} />}
            </div>
            {plan?.mode === "manual" && (
              <button
                type="button"
                onClick={onAuto}
                className="text-[11px] font-medium text-accent-text hover:underline"
              >
                Reset to auto
              </button>
            )}
          </div>
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
            {rows.length === 0 && (
              <li className="px-3 py-3 text-xs text-text-dimmed">
                {skills.length === 0 ? "No skills installed yet." : "No match."}
              </li>
            )}
            {rows.map((skill) => {
              const entry = appliedByName.get(skill.name);
              const active = !!entry;
              const locked = entry?.source === "always";
              const detail = entry ? entry.reasons.join(", ") : skill.description;
              return (
                <li key={skill.name}>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => toggle(skill.name)}
                    aria-pressed={active}
                    title={locked ? "Built in: applied to every task" : undefined}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-surface-hover disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <span
                      className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        active
                          ? `border-accent bg-accent text-white ${locked ? "opacity-60" : ""}`
                          : "border-white/20"
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
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
                        <span className="truncate">{skill.name}</span>
                        {entry?.source === "auto" && (
                          <span className="text-accent-text">
                            <SparkIcon size={9} />
                          </span>
                        )}
                        {locked && (
                          <span className="text-text-dimmed">
                            <LockIcon />
                          </span>
                        )}
                      </span>
                      {detail && (
                        <span className="block truncate text-[11px] text-text-dimmed">
                          {detail}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="border-t border-white/10 px-3 py-2 text-[11px] leading-snug text-text-dimmed">
            {notice ?? "Picked from the task text. Edit the list to take over."}
          </p>
        </div>
      )}
    </div>
  );
}
