import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type Tab = "skills" | "rules" | "agents" | "workflows";

function CountBadge({ count }: { count: number }) {
  return (
    <span
      className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full"
      style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}
    >
      {count}
    </span>
  );
}

function EntryCard({
  name,
  description,
  extra,
  onView,
}: {
  name: string;
  description: string;
  extra?: string;
  onView?: () => void;
}) {
  return (
    <button
      type="button"
      className="w-full px-3 py-2.5 rounded-lg border cursor-pointer hover:border-[var(--accent)]/50 transition-colors text-left"
      style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
      onClick={onView}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
          {name}
        </span>
        {extra && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
          >
            {extra}
          </span>
        )}
      </div>
      <p className="text-xs leading-relaxed line-clamp-2" style={{ color: "var(--text-muted)" }}>
        {description || "Sem descrição"}
      </p>
    </button>
  );
}

interface SkillsBrowserProps {
  open: boolean;
  onClose: () => void;
}

export function SkillsBrowser({ open, onClose }: SkillsBrowserProps) {
  const [tab, setTab] = useState<Tab>("rules");
  const [index, setIndex] = useState<SkillsIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewContent, setViewContent] = useState<{ name: string; content: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.skills.index();
      setIndex(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadIndex();
  }, [open, loadIndex]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.skills.refresh();
      await loadIndex();
    } finally {
      setRefreshing(false);
    }
  };

  const handleViewFile = async (filePath: string, name: string) => {
    try {
      const result = await api.skills.content(filePath);
      setViewContent({ name, content: result.content });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (!index && !loading && !error) return null;

  const tabItems: Tab[] = ["rules", "skills", "agents", "workflows"];
  const tabLabels: Record<Tab, string> = {
    rules: "Regras",
    skills: "Skills",
    agents: "Agentes",
    workflows: "Workflows",
  };
  const tabCounts: Record<Tab, number> = {
    rules: index?.rules.length ?? 0,
    skills: index?.skills.length ?? 0,
    agents: index?.agents.length ?? 0,
    workflows: index?.workflows.length ?? 0,
  };

  const lowerSearch = search.toLowerCase();
  const filterBySearch = <T extends { name: string; description: string }>(items: T[]): T[] =>
    lowerSearch
      ? items.filter(
          (i) =>
            i.name.toLowerCase().includes(lowerSearch) ||
            i.description.toLowerCase().includes(lowerSearch)
        )
      : items;

  return (
    <Dialog
      open={open}
      onClose={viewContent ? () => setViewContent(null) : onClose}
      title={viewContent ? viewContent.name : "Skills & Regras"}
    >
      {viewContent ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setViewContent(null)}>
            ← Voltar
          </Button>
          <pre
            className="text-xs p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap"
            style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
          >
            {viewContent.content}
          </pre>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex gap-1 rounded-lg p-1" style={{ background: "var(--bg-input)" }}>
            {tabItems.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 text-xs font-medium py-2 rounded-md transition-colors cursor-pointer ${tab === t ? "shadow-sm" : ""}`}
                style={{
                  background: tab === t ? "var(--bg-surface)" : "transparent",
                  color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {tabLabels[t]}
                <CountBadge count={tabCounts[t]} />
              </button>
            ))}
          </div>

          {/* Search + refresh */}
          <div className="flex gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="flex-1 text-sm px-3 py-1.5 rounded-lg border outline-none"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--glass-border)",
                color: "var(--text-primary)",
              }}
            />
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? "..." : "↻"}
            </Button>
          </div>

          {loading && (
            <p className="text-xs text-center py-4" style={{ color: "var(--text-muted)" }}>
              Carregando...
            </p>
          )}

          {error && (
            <div className="text-xs px-3 py-2 rounded-lg border border-red-800/40 bg-red-950/30 text-red-400">
              {error}
            </div>
          )}

          {index && !loading && (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {tab === "rules" &&
                filterBySearch(index.rules).map((r: RuleEntry) => (
                  <EntryCard
                    key={r.filePath}
                    name={r.name}
                    description={r.description}
                    extra={r.applyTo}
                    onView={() => handleViewFile(r.filePath, r.name)}
                  />
                ))}

              {tab === "skills" &&
                filterBySearch(index.skills).map((s: SkillEntry) => (
                  <EntryCard
                    key={s.filePath}
                    name={s.name}
                    description={s.description}
                    onView={() => handleViewFile(s.filePath, s.name)}
                  />
                ))}

              {tab === "agents" &&
                filterBySearch(index.agents).map((a: AgentEntry) => (
                  <EntryCard
                    key={a.filePath}
                    name={a.name}
                    description={a.description}
                    onView={() => handleViewFile(a.filePath, a.name)}
                  />
                ))}

              {tab === "workflows" &&
                filterBySearch(index.workflows).map((w: WorkflowEntry) => (
                  <EntryCard
                    key={w.filePath}
                    name={w.name}
                    description={w.description}
                    onView={() => handleViewFile(w.filePath, w.name)}
                  />
                ))}

              {index[tab].length === 0 && (
                <p className="text-xs text-center py-6" style={{ color: "var(--text-dimmed)" }}>
                  Nenhum item encontrado em ~/.agents/{tab}
                </p>
              )}
            </div>
          )}

          <p className="text-xs" style={{ color: "var(--text-dimmed)" }}>
            Skills e regras são lidas de{" "}
            <code style={{ color: "var(--text-muted)" }}>~/.agents</code> e injetadas
            automaticamente nos prompts.
          </p>
        </div>
      )}
    </Dialog>
  );
}
