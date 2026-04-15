import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type Tab = "loaded" | "skills" | "rules" | "agents" | "workflows";
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

// ─── Inline Markdown / YAML → HTML renderer ─────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInline(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+?)\*/g, "<em>$1</em>")
    .replace(
      /`([^`]+)`/g,
      '<code style="background:var(--bg-input);padding:1px 5px;border-radius:3px;font-size:10px;font-family:monospace;color:var(--accent-text)">$1</code>'
    );
}

function toHtml(content: string): string {
  let frontmatter = "";
  let body = content;
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (fmMatch) {
    frontmatter = fmMatch[1];
    body = fmMatch[2].trim();
  }

  let html = "";

  if (frontmatter) {
    html +=
      '<div style="background:var(--bg-input);border:1px solid var(--glass-border);border-radius:8px;padding:12px;margin-bottom:14px;">';
    for (const line of frontmatter.split("\n").filter(Boolean)) {
      const ci = line.indexOf(":");
      if (ci > 0) {
        const k = escapeHtml(line.slice(0, ci).trim());
        const v = escapeHtml(line.slice(ci + 1).trim());
        html += `<div style="display:flex;gap:12px;margin-bottom:5px;font-size:11px"><span style="color:var(--accent-text);font-family:monospace;min-width:90px;flex-shrink:0">${k}</span><span style="color:var(--text-secondary)">${v}</span></div>`;
      } else {
        html += `<div style="color:var(--text-muted);font-size:11px;font-family:monospace">${escapeHtml(line)}</div>`;
      }
    }
    html += "</div>";
  }

  const lines = body.split("\n");
  let inCode = false;
  let codeLines: string[] = [];
  let inList = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        html += `<pre style="background:var(--bg-card);border:1px solid var(--glass-border);border-radius:6px;padding:10px;overflow-x:auto;font-size:10.5px;font-family:monospace;color:var(--text-secondary);margin:8px 0;line-height:1.5">${escapeHtml(codeLines.join("\n"))}</pre>`;
        codeLines = [];
        inCode = false;
      } else {
        if (inList) {
          html += "</ul>";
          inList = false;
        }
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("# ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h1 style="font-size:16px;font-weight:700;color:var(--text-primary);margin:18px 0 8px">${renderInline(line.slice(2))}</h1>`;
    } else if (line.startsWith("## ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h2 style="font-size:14px;font-weight:600;color:var(--text-primary);margin:16px 0 6px;border-bottom:1px solid var(--border-default);padding-bottom:4px">${renderInline(line.slice(3))}</h2>`;
    } else if (line.startsWith("### ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h3 style="font-size:13px;font-weight:600;color:var(--text-secondary);margin:12px 0 4px">${renderInline(line.slice(4))}</h3>`;
    } else if (line.startsWith("#### ")) {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      html += `<h4 style="font-size:12px;font-weight:600;color:var(--text-muted);margin:10px 0 3px">${renderInline(line.slice(5))}</h4>`;
    } else if (/^\s*[-*] /.test(line)) {
      if (!inList) {
        html += '<ul style="margin:6px 0 6px 16px;list-style:disc">';
        inList = true;
      }
      html += `<li style="color:var(--text-secondary);font-size:11.5px;margin-bottom:3px;line-height:1.5">${renderInline(line.trimStart().slice(2))}</li>`;
    } else if (/^\s*\d+\. /.test(line)) {
      if (!inList) {
        html += '<ol style="margin:6px 0 6px 16px;list-style:decimal">';
        inList = true;
      }
      html += `<li style="color:var(--text-secondary);font-size:11.5px;margin-bottom:3px;line-height:1.5">${renderInline(line.trimStart().replace(/^\d+\.\s*/, ""))}</li>`;
    } else if (line.trim() === "") {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
    } else {
      if (inList) {
        html += "</ul>";
        inList = false;
      }
      if (line.startsWith("> ")) {
        html += `<blockquote style="border-left:3px solid var(--border-default);padding-left:10px;margin:6px 0;color:var(--text-muted);font-size:11.5px;font-style:italic">${renderInline(line.slice(2))}</blockquote>`;
      } else {
        html += `<p style="color:var(--text-secondary);font-size:12px;margin:4px 0;line-height:1.6">${renderInline(line)}</p>`;
      }
    }
  }

  if (inList) html += "</ul>";
  if (inCode && codeLines.length > 0) {
    html += `<pre style="background:var(--bg-card);border:1px solid var(--glass-border);border-radius:6px;padding:10px;overflow-x:auto;font-size:10.5px;font-family:monospace;color:var(--text-secondary);margin:8px 0;line-height:1.5">${escapeHtml(codeLines.join("\n"))}</pre>`;
  }

  return html;
}
// ─── End renderer ────────────────────────────────────────────────────────────

export interface SkillsBrowserProps {
  open: boolean;
  onClose: () => void;
  initialSkillName?: string;
  matchedSkills?: string[];
}

/** Parse a prefixed matched skill name like "rule:foo" → { category, name } */
function parseMatchedSkill(s: string): { category: string; name: string } {
  const idx = s.indexOf(":");
  if (idx > 0) return { category: s.slice(0, idx), name: s.slice(idx + 1) };
  return { category: "skill", name: s };
}

const categoryLabel: Record<string, string> = {
  rule: "Regra",
  skill: "Skill",
  agent: "Agente",
  workflow: "Workflow",
};

const categoryColor: Record<string, string> = {
  rule: "#f59e0b",
  skill: "#8b5cf6",
  agent: "#3b82f6",
  workflow: "#10b981",
};

export function SkillsBrowser({
  open,
  onClose,
  initialSkillName,
  matchedSkills,
}: SkillsBrowserProps) {
  const hasLoaded = matchedSkills && matchedSkills.length > 0;
  const [tab, setTab] = useState<Tab>(hasLoaded ? "loaded" : "rules");
  const [index, setIndex] = useState<SkillsIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnyEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<"raw" | "rendered">("rendered");
  const [refreshing, setRefreshing] = useState(false);
  const autoSelectedRef = useRef<string | null>(null);

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

  const handleSelect = useCallback(async (entry: AnyEntry) => {
    setSelected(entry);
    setPreviewContent(null);
    setPreviewLoading(true);
    setPreviewMode("rendered");
    try {
      const result = await api.skills.content(entry.filePath);
      setPreviewContent(result.content);
    } catch (err) {
      setPreviewContent(`Erro ao carregar: ${err instanceof Error ? err.message : err}`);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  // Auto-select entry when initialSkillName is provided and index is loaded
  useEffect(() => {
    if (!open || !initialSkillName || !index) return;
    if (autoSelectedRef.current === initialSkillName) return;
    autoSelectedRef.current = initialSkillName;

    // Support prefixed names like "rule:foo" or plain "foo"
    const parsed = parseMatchedSkill(initialSkillName);
    const allEntries: [Tab, AnyEntry][] = [
      ...index.rules.map((e): [Tab, AnyEntry] => ["rules", e]),
      ...index.skills.map((e): [Tab, AnyEntry] => ["skills", e]),
      ...index.agents.map((e): [Tab, AnyEntry] => ["agents", e]),
      ...index.workflows.map((e): [Tab, AnyEntry] => ["workflows", e]),
    ];
    const found = allEntries.find(([, e]) => e.name === parsed.name);
    if (!found) return;
    const [foundTab, foundEntry] = found;
    setTab(foundTab);
    handleSelect(foundEntry);
  }, [open, initialSkillName, index, handleSelect]);

  // Reset auto-select tracking when dialog closes
  useEffect(() => {
    if (!open) autoSelectedRef.current = null;
  }, [open]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.skills.refresh();
      await loadIndex();
    } finally {
      setRefreshing(false);
    }
  };

  const tabItems: Tab[] = hasLoaded
    ? ["loaded", "rules", "skills", "agents", "workflows"]
    : ["rules", "skills", "agents", "workflows"];
  const tabLabels: Record<Tab, string> = {
    loaded: "Carregadas",
    rules: "Regras",
    skills: "Skills",
    agents: "Agentes",
    workflows: "Workflows",
  };

  // Build loaded entries from matchedSkills + index
  const loadedEntries: (AnyEntry & { _category: string })[] = [];
  if (hasLoaded && index) {
    const allByName = new Map<string, { entry: AnyEntry; category: string }>();
    for (const e of index.rules) allByName.set(e.name, { entry: e, category: "rule" });
    for (const e of index.skills) allByName.set(e.name, { entry: e, category: "skill" });
    for (const e of index.agents) allByName.set(e.name, { entry: e, category: "agent" });
    for (const e of index.workflows) allByName.set(e.name, { entry: e, category: "workflow" });
    for (const ms of matchedSkills) {
      const parsed = parseMatchedSkill(ms);
      const found = allByName.get(parsed.name);
      if (found) {
        loadedEntries.push({ ...found.entry, _category: found.category });
      } else {
        // Skill was loaded but not in global index — show a stub
        loadedEntries.push({
          name: parsed.name,
          description: `Carregada pela CLI (${categoryLabel[parsed.category] ?? parsed.category})`,
          filePath: "",
          _category: parsed.category,
        } as AnyEntry & { _category: string });
      }
    }
  }

  const tabCounts: Record<Tab, number> = {
    loaded: loadedEntries.length,
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

  const currentList: (AnyEntry & { _category?: string })[] =
    tab === "loaded"
      ? lowerSearch
        ? loadedEntries.filter(
            (i) =>
              i.name.toLowerCase().includes(lowerSearch) ||
              i.description.toLowerCase().includes(lowerSearch)
          )
        : loadedEntries
      : index
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
                {tab === "loaded"
                  ? "Nenhuma skill carregada nesta tarefa"
                  : `Nenhum item em ~/.agents/${tab}`}
              </p>
            )}
            {currentList.map((entry) => {
              const isSelected = selected?.filePath === entry.filePath;
              const applyTo = (entry as RuleEntry).applyTo;
              const cat = (entry as AnyEntry & { _category?: string })._category;
              return (
                <button
                  key={entry.filePath || entry.name}
                  type="button"
                  onClick={() => (entry.filePath ? handleSelect(entry) : undefined)}
                  className={`w-full px-2.5 py-2 rounded-lg border cursor-pointer text-left transition-colors`}
                  style={{
                    background: isSelected
                      ? "var(--accent-muted, rgba(139,92,246,0.15))"
                      : "var(--bg-card)",
                    borderColor: isSelected ? "var(--accent)" : "var(--glass-border)",
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    {cat && (
                      <span
                        className="text-[8px] font-semibold uppercase px-1 py-0.5 rounded"
                        style={{
                          background: `${categoryColor[cat] ?? "#666"}22`,
                          color: categoryColor[cat] ?? "#888",
                        }}
                      >
                        {categoryLabel[cat] ?? cat}
                      </span>
                    )}
                    <span
                      className="text-xs font-medium truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {entry.name}
                    </span>
                    {(entry as AnyEntry & { scope?: string }).scope === "workspace" && (
                      <span
                        className="text-[8px] font-semibold uppercase px-1 py-0.5 rounded shrink-0"
                        style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}
                      >
                        workspace
                      </span>
                    )}
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
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                    {selected.name}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {selected.description || "Sem descrição"}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Raw / Rendered toggle */}
                  {previewContent && !previewLoading && (
                    <div
                      className="flex rounded-md overflow-hidden border text-[10px]"
                      style={{ borderColor: "var(--glass-border)" }}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewMode("raw")}
                        className="px-2 py-0.5 cursor-pointer transition-colors"
                        style={{
                          background: previewMode === "raw" ? "var(--bg-surface)" : "transparent",
                          color:
                            previewMode === "raw" ? "var(--text-primary)" : "var(--text-muted)",
                        }}
                      >
                        Raw
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("rendered")}
                        className="px-2 py-0.5 cursor-pointer transition-colors"
                        style={{
                          background:
                            previewMode === "rendered" ? "var(--bg-surface)" : "transparent",
                          color:
                            previewMode === "rendered"
                              ? "var(--text-primary)"
                              : "var(--text-muted)",
                        }}
                      >
                        Renderizado
                      </button>
                    </div>
                  )}
                  <span
                    className="text-[9px] font-mono px-1.5 py-0.5 rounded"
                    style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
                  >
                    {selected.filePath.split("/").pop()}
                  </span>
                </div>
              </div>
              {previewLoading ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>
                    Carregando...
                  </p>
                </div>
              ) : previewMode === "rendered" && previewContent ? (
                <div
                  className="flex-1 overflow-auto p-4 rounded-lg"
                  style={{ background: "var(--bg-input)" }}
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted local ~/.agents/ content
                  dangerouslySetInnerHTML={{ __html: toHtml(previewContent) }}
                />
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
