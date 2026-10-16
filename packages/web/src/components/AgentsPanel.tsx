import type { AgentTemplate } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api/client";
import { Button } from "./ui/button";

const ACCENT_CLASSES: Record<string, string> = {
  info: "border-info/25 bg-info/10 text-info",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-danger/25 bg-danger/10 text-danger",
  accent: "border-accent/25 bg-accent/10 text-accent-text",
};

function accentClass(accent?: string): string {
  return (accent && ACCENT_CLASSES[accent]) || "border-default bg-white/5 text-secondary";
}

function AgentGlyph({ template, size = "md" }: { template: AgentTemplate; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-lg" : "h-10 w-10 text-sm";
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-2xl border font-black uppercase ${box} ${accentClass(template.accent)}`}
      aria-hidden="true"
    >
      {template.name.charAt(0)}
    </div>
  );
}

function AgentCard({ template, onSelect }: { template: AgentTemplate; onSelect: () => void }) {
  const skillCount = template.skills?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex h-full flex-col rounded-2xl border border-white/6 bg-surface/50 p-4 text-left transition-colors hover:border-white/12 hover:bg-surface-hover"
    >
      <div className="flex items-center gap-3">
        <AgentGlyph template={template} />
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-primary">{template.name}</h3>
          {template.category && (
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {template.category}
            </span>
          )}
        </div>
      </div>
      <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-secondary">
        {template.description}
      </p>
      <div className="mt-auto flex items-center gap-2 pt-3 text-[10px] text-dimmed">
        <span className="font-mono">{template.slug}</span>
        {skillCount > 0 && (
          <span className="ml-auto rounded-md bg-white/5 px-1.5 py-0.5 font-bold tabular-nums">
            {skillCount} skill{skillCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </button>
  );
}

function AgentDetail({ template, onBack }: { template: AgentTemplate; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-white/6 px-6 py-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to agents"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-secondary transition-colors hover:bg-white/5 hover:text-primary"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <AgentGlyph template={template} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate text-base font-bold text-primary">{template.name}</h3>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="font-mono">{template.slug}</span>
            {template.category && <span>· {template.category}</span>}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        <p className="text-sm leading-relaxed text-secondary">{template.description}</p>

        <h4 className="mt-6 text-[10px] font-black uppercase tracking-[0.2em] text-muted">
          Instructions
        </h4>
        <div className="chat-markdown mt-2 rounded-2xl border border-white/6 bg-app/40 p-4 text-secondary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{template.instructions}</ReactMarkdown>
        </div>

        {template.skills?.length > 0 && (
          <>
            <h4 className="mt-6 text-[10px] font-black uppercase tracking-[0.2em] text-muted">
              Skills
            </h4>
            <ul className="mt-2 space-y-2">
              {template.skills.map((skill) => (
                <li
                  key={skill.source_url}
                  className="rounded-xl border border-white/6 bg-surface/40 px-3 py-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-primary">{skill.cached_name}</span>
                    <a
                      href={skill.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto text-[10px] text-accent hover:underline"
                    >
                      Source ↗
                    </a>
                  </div>
                  {skill.cached_description && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted">
                      {skill.cached_description}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Browse the built-in specialised agents (the JSON templates under
 * `agents/templates`). Read-only: the registry lives on disk, so the panel
 * inspects what is available and hands the operator to the New Task dialog.
 */
export function AgentsPanel({
  open,
  onClose,
  onNewTask,
}: {
  open: boolean;
  onClose: () => void;
  onNewTask?: () => void;
}) {
  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentTemplate | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTemplates(await api.agentTemplates.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      setSelected(null);
      setQuery("");
      setCategory(null);
    }
  }, [open]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const t of templates) if (t.category) set.add(t.category);
    return [...set].sort();
  }, [templates]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (category && t.category !== category) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.slug.toLowerCase().includes(needle) ||
        t.description.toLowerCase().includes(needle)
      );
    });
  }, [templates, query, category]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <button
        type="button"
        aria-label="Close agents"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-2xl flex-col overflow-hidden border-l border-white/10 glass-panel shadow-2xl">
        {selected ? (
          <AgentDetail template={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 border-b border-white/6 px-6 py-4">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-primary">Agents</h2>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1 w-6 rounded-full bg-accent" />
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-muted">
                    Specialised agents
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onNewTask && (
                  <Button size="sm" variant="outline" onClick={onNewTask}>
                    New task
                  </Button>
                )}
                <button
                  type="button"
                  onClick={refresh}
                  aria-label="Refresh agents"
                  className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-primary"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    className={loading ? "animate-spin" : ""}
                    aria-hidden="true"
                  >
                    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-primary"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-white/6 px-6 py-3">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents…"
                className="h-9 w-full rounded-lg border border-default bg-input/40 px-3 text-xs text-primary outline-none transition-colors placeholder:text-muted focus:border-accent/40 sm:w-56"
              />
              <button
                type="button"
                onClick={() => setCategory(null)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  category === null
                    ? "border-accent/40 bg-accent/10 text-accent-text"
                    : "border-default text-secondary hover:text-primary"
                }`}
              >
                All
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(category === c ? null : c)}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    category === c
                      ? "border-accent/40 bg-accent/10 text-accent-text"
                      : "border-default text-secondary hover:text-primary"
                  }`}
                >
                  {c}
                </button>
              ))}
              <span className="ml-auto text-[11px] tabular-nums text-muted">
                {filtered.length} of {templates.length}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              {error && (
                <p className="mb-4 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              )}
              {loading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-[150px] animate-pulse rounded-2xl bg-white/5" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
                  <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/8 bg-surface/60 text-accent">
                    <svg
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="4" y="8" width="16" height="12" rx="3" />
                      <path d="M12 4v4M9 14h.01M15 14h.01" />
                    </svg>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-primary">No agents found</p>
                  <p className="max-w-xs text-xs text-muted">
                    {templates.length === 0
                      ? "No agent templates are available on the server."
                      : "Try a different search or category."}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {filtered.map((t) => (
                    <AgentCard key={t.slug} template={t} onSelect={() => setSelected(t)} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
