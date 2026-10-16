import { useMemo, useState } from "react";

export interface AgentPickerOption {
  name: string;
  description: string;
}

interface AgentPickerProps {
  agents: AgentPickerOption[];
  workflows: AgentPickerOption[];
  /** "" for the default agent, a name, or `workflow:<name>` for a workflow. */
  value: string;
  onChange: (value: string) => void;
}

interface Row {
  key: string;
  label: string;
  hint: string;
  badge?: string;
}

/** Visual list picker for the specialized agent / workflow of a task. */
export function AgentPicker({ agents, workflows, value, onChange }: AgentPickerProps) {
  const [query, setQuery] = useState("");

  const rows = useMemo<Row[]>(() => {
    const all: Row[] = [
      { key: "", label: "Default", hint: "Let the harness choose the agent for this task." },
      ...agents.map((a) => ({
        key: a.name,
        label: a.name,
        hint: a.description,
        badge: "Agent",
      })),
      ...workflows.map((w) => ({
        key: `workflow:${w.name}`,
        label: w.name,
        hint: w.description,
        badge: "Workflow",
      })),
    ];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (r) =>
        r.key !== "" &&
        (r.label.toLowerCase().includes(needle) || r.hint.toLowerCase().includes(needle))
    );
  }, [agents, workflows, query]);

  const showSearch = agents.length + workflows.length > 5;

  return (
    <div className="overflow-hidden rounded-lg border border-default bg-input/30">
      {showSearch && (
        <div className="border-b border-white/5 p-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter agents…"
            className="h-8 w-full rounded-md border border-default bg-surface/40 px-2.5 text-xs text-primary outline-none placeholder:text-muted focus:border-accent/40"
          />
        </div>
      )}
      <div role="listbox" aria-label="Specialized agent" className="max-h-56 overflow-y-auto p-1">
        {rows.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted">No agents match “{query}”.</p>
        ) : (
          rows.map((row) => {
            const selected = value === row.key;
            return (
              <button
                key={row.key || "default"}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => onChange(row.key)}
                className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors ${
                  selected ? "bg-accent/15" : "hover:bg-surface-hover"
                }`}
              >
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                    selected ? "bg-accent" : "bg-white/15"
                  }`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={`truncate text-xs font-semibold ${
                        selected ? "text-accent-text" : "text-primary"
                      }`}
                    >
                      {row.label}
                    </span>
                    {row.badge && (
                      <span className="shrink-0 rounded bg-white/5 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-muted">
                        {row.badge}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] leading-relaxed text-muted">
                    {row.hint}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
