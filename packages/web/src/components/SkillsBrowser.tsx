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
type AnyEntry = RuleEntry | SkillEntry | AgentEntry | WorkflowEntry;

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
  const [selected, setSelected] = useState<AnyEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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

  const handleSelect = async (entry: AnyEntry) => {
    setSelected(entry);
    setPreviewContent(null);
    setPreviewLoading(true);
    try {
      const result = await api.skills.content(entry.filePath);
      setPreviewContent(result.content);
    } catch (err) {
      setPreviewContent(`Erro ao carregar: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPreviewLoading(false);
    }
  };

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
  function filterBySearch<T extends { name: string; description: string }>(items: T[]): T[] {
    if (!lowerSearch) return items;
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(lowerSearch) ||
        i.description.toLowerCase().includes(lowerSearch)
    );
  }

  const currentList: AnyEntry[] = index
    ? filterBySearch(
        tab === "rules"
          ? (index.rules as AnyEntry[])
          : tab === "skills"
            ? (index.skills as AnyEntry[])
            : tab === "agents"
              ? (index.agents as AnyEntry[])
              : (index.workflows as AnyEntry[])
      )
    : [];

  return (
    <Dialog open={open} onClose={onClose} title="Skills, Regras & Agentes" size="5xl">
      <div className="flex gap-4 h-[70vh] -mx-1">
        {/* Left panel */}
        <div className="flex flex-col w-72 shrink-0 gap-2">
          {/* Tabs */}
          <div className="flex gap-0.5 rounded-lg p-0.5" style={{ background: "var(--bg-input)" }}>
            {tabItems.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setSelected(null);
                  setPreviewContent(null);
                }}
                className={`flex-1 text-[10px] font-medium py-1.5 rounded-md transition-colors cursor-pointer`}
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
          <div className="flex gap-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border outline-none"
              style={{
                background: "var(--bg-input)",
                borderColor: "var(--glass-border)",
                color: "var(--text-primary)",
              }}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Recarregar"
            >
              {refreshing ? "..." : "↻"}
            </Button>
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto space-y-1 pr-1">
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
            {!loading && currentList.length === 0 && index && (
              <p className="text-xs text-center py-6" style={{ color: "var(--text-dimmed)" }}>
                Nenhum item em ~/.agents/{tab}
              </p>
            )}
            {currentList.map((entry) => {
              const isSelected = selected?.filePath === entry.filePath;
              const applyTo = (entry as RuleEntry).applyTo;
              return (
                <button
                  key={entry.filePath}
                  type="button"
                  onClick={() => handleSelect(entry)}
                  className={`w-full px-2.5 py-2 rounded-lg border cursor-pointer text-left transition-colors`}
                  style={{
                    background: isSelected
                      ? "var(--accent-muted, rgba(139,92,246,0.15))"
                      : "var(--bg-card)",
                    borderColor: isSelected ? "var(--accent)" : "var(--glass-border)",
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span
                      className="text-xs font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {entry.name}
                    </span>
                    {applyTo && (
                      <span
                        className="text-[9px] px-1 py-0.5 rounded shrink-0"
                        style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
                      >
                        {applyTo.length > 30 ? `${applyTo.slice(0, 30)}…` : applyTo}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-[10px] leading-relaxed line-clamp-2"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {entry.description || "Sem descrição"}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="w-px shrink-0 self-stretch" style={{ background: "var(--glass-border)" }} />

        {/* Right panel — preview */}
        <div className="flex-1 flex flex-col gap-2 min-w-0">
          {!selected && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: "var(--text-dimmed)" }}>
                ← Selecione um item para visualizar
              </p>
            </div>
          )}
          {selected && (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {selected.name}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {selected.description || "Sem descrição"}
                  </p>
                </div>
                <span
                  className="text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
                >
                  {selected.filePath.split("/").pop()}
                </span>
              </div>
              {previewLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>
                    Carregando...
                  </p>
                </div>
              ) : (
                <pre
                  className="flex-1 text-xs p-3 rounded-lg overflow-auto whitespace-pre-wrap font-mono"
                  style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}
                >
                  {previewContent}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
