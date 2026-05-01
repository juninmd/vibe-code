import type {
  AgentEntry,
  RuleEntry,
  SkillEntry,
  SkillsIndex,
  WorkflowEntry,
} from "@vibe-code/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type Tab = "loaded" | "skills" | "rules" | "agents" | "workflows" | "market";
type AnyEntry = RuleEntry | SkillEntry | AgentEntry | WorkflowEntry;

interface SkillCardProps {
  entry: AnyEntry & { _category?: string };
  isSelected: boolean;
  onSelect: () => void;
}

const categoryMeta: Record<string, { color: string; bg: string; label: string }> = {
  rule: { color: "#f59e0b", bg: "rgba(245,158,11,0.15)", label: "Rule" },
  skill: { color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", label: "Skill" },
  agent: { color: "#3b82f6", bg: "rgba(59,130,246,0.15)", label: "Agent" },
  workflow: { color: "#10b981", bg: "rgba(16,185,129,0.15)", label: "Workflow" },
};

const SKIPPED_FRONTMATTER_FIELDS = new Set(["name", "description", "applyto"]);

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded px-1 py-0.5 font-mono text-[10px]"
          style={{ background: "var(--bg-card)", color: "var(--accent)" }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch?.[2] ?? "";
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
          style={{ color: "var(--accent)" }}
        >
          {linkMatch?.[1] ?? token}
        </a>
      );
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function extractFrontmatter(content: string): {
  frontmatter: Array<{ key: string; value: string }>;
  body: string;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: [], body: normalized };

  const frontmatter = match[1]
    .split("\n")
    .map((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex <= 0) return null;
      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (SKIPPED_FRONTMATTER_FIELDS.has(key.toLowerCase())) return null;
      return { key, value };
    })
    .filter((item): item is { key: string; value: string } => item !== null);

  return { frontmatter, body: match[2].trim() };
}

function isMarkdownTable(lines: string[], index: number): boolean {
  const current = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";
  return current.startsWith("|") && current.endsWith("|") && /^\|[\s|:-]+\|$/.test(separator);
}

function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderSkillMarkdownPreview(content: string): ReactNode {
  const { frontmatter, body } = extractFrontmatter(content);
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  if (frontmatter.length > 0) {
    blocks.push(
      <div
        key="frontmatter"
        className="mb-4 rounded-lg border p-3 text-[11px]"
        style={{ background: "var(--bg-card)", borderColor: "var(--glass-border)" }}
      >
        {frontmatter.map(({ key, value }) => (
          <div key={key} className="grid grid-cols-[96px_1fr] gap-3 py-0.5">
            <span className="font-mono" style={{ color: "var(--accent)" }}>
              {key}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>{value}</span>
          </div>
        ))}
      </div>
    );
  }

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      blocks.push(
        <pre
          key={`code-${i}`}
          className="my-3 overflow-auto rounded-md border p-3 text-[11px] leading-relaxed"
          style={{
            background: "var(--bg-card)",
            borderColor: "var(--glass-border)",
            color: "var(--text-secondary)",
          }}
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (isMarkdownTable(lines, i)) {
      const rows: string[][] = [splitTableRow(lines[i])];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      const [headers, ...dataRows] = rows;
      blocks.push(
        <div key={`table-${i}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className="border-b px-2 py-1.5 text-left font-semibold"
                    style={{
                      background: "var(--bg-surface)",
                      borderColor: "var(--border-default)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {renderInlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell) => (
                    <td
                      key={cell}
                      className="border-b px-2 py-1.5 align-top"
                      style={{
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-secondary)",
                      }}
                    >
                      {renderInlineMarkdown(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (trimmed.startsWith("# ")) {
      blocks.push(
        <h1 key={`h1-${i}`} className="mb-2 mt-1 text-base font-bold">
          {renderInlineMarkdown(trimmed.slice(2))}
        </h1>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h2
          key={`h2-${i}`}
          className="mb-2 mt-4 border-b pb-1 text-sm font-semibold"
          style={{ borderColor: "var(--border-default)" }}
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${i}`} className="mb-1.5 mt-3 text-xs font-semibold">
          {renderInlineMarkdown(trimmed.slice(4))}
        </h3>
      );
      i += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ""));
        i += 1;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={`list-${i}`}
          className={`my-2 pl-5 text-[12px] leading-relaxed ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item) => (
            <li key={item}>{renderInlineMarkdown(item)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      blocks.push(
        <blockquote
          key={`quote-${i}`}
          className="my-2 border-l-2 pl-3 text-[12px] italic"
          style={{ borderColor: "var(--border-default)", color: "var(--text-muted)" }}
        >
          {renderInlineMarkdown(trimmed.slice(2))}
        </blockquote>
      );
      i += 1;
      continue;
    }

    const paragraphLines = [trimmed];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^#{1,3}\s+/.test(lines[i].trim()) &&
      !/^[-*]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim()) &&
      !lines[i].trim().startsWith("> ") &&
      !lines[i].trim().startsWith("```") &&
      !isMarkdownTable(lines, i)
    ) {
      paragraphLines.push(lines[i].trim());
      i += 1;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-2 text-[12px] leading-relaxed">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>
    );
  }

  return (
    <div className="p-4 text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
      {blocks}
    </div>
  );
}

function SkillCard({ entry, isSelected, onSelect }: SkillCardProps) {
  const cat = (entry as AnyEntry & { _category?: string })._category ?? "";
  const meta = categoryMeta[cat] ?? categoryMeta.skill;
  const applyTo = (entry as RuleEntry).applyTo;
  const scope = (entry as AnyEntry & { scope?: string }).scope;
  const dependencies = entry.category === "skill" ? (entry.dependencies ?? []) : [];

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full p-3.5 rounded-xl border text-left transition-all cursor-pointer group"
      style={{
        background: isSelected ? meta.bg : "var(--bg-card)",
        borderColor: isSelected ? meta.color : "var(--glass-border)",
      }}
    >
      <div className="flex items-start gap-2.5 mb-2">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm font-bold"
          style={{ background: meta.bg, color: meta.color }}
        >
          {cat === "rule" ? "R" : cat === "skill" ? "S" : cat === "agent" ? "A" : "W"}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-xs font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {entry.name}
          </h3>
          {scope && (
            <span
              className="text-[8px] font-medium px-1 py-0.5 rounded"
              style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}
            >
              workspace
            </span>
          )}
        </div>
        <span
          className="text-[9px] font-medium px-1.5 py-0.5 rounded shrink-0"
          style={{ background: meta.bg, color: meta.color }}
        >
          {meta.label}
        </span>
      </div>
      <p
        className="text-[10px] leading-relaxed line-clamp-2 mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        {entry.description || "Sem descrição"}
      </p>
      {applyTo && (
        <div className="flex items-center gap-1">
          <span
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
          >
            {applyTo.length > 35 ? `${applyTo.slice(0, 35)}…` : applyTo}
          </span>
        </div>
      )}
      {dependencies.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5 flex-wrap">
          {dependencies.slice(0, 3).map((dep) => (
            <span
              key={dep}
              className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent font-mono border border-accent/20"
            >
              {dep}
            </span>
          ))}
          {dependencies.length > 3 && (
            <span className="text-[9px]" style={{ color: "var(--text-dimmed)" }}>
              +{dependencies.length - 3}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

export interface SkillsBrowserProps {
  open: boolean;
  onClose: () => void;
  initialSkillName?: string;
  matchedSkills?: string[];
}

function parseMatchedSkill(s: string): { category: string; name: string } {
  const idx = s.indexOf(":");
  if (idx > 0) return { category: s.slice(0, idx), name: s.slice(idx + 1) };
  return { category: "skill", name: s };
}

export function SkillsBrowser({
  open,
  onClose,
  initialSkillName,
  matchedSkills,
}: SkillsBrowserProps) {
  const hasLoaded = matchedSkills && matchedSkills.length > 0;
  const [tab, setTab] = useState<Tab>(hasLoaded ? "loaded" : "skills");
  const [index, setIndex] = useState<SkillsIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnyEntry | null>(null);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState<"raw" | "rendered">("rendered");
  const [refreshing, setRefreshing] = useState(false);
  const [installRepo, setInstallRepo] = useState("");
  const [installing, setInstalling] = useState(false);
  const [registryList, setRegistryList] = useState<string[]>([]);
  const autoSelectedRef = useRef<string | null>(null);

  const loadIndex = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, reg] = await Promise.all([
        api.skills.index(),
        api.skills.registry.list().catch(() => []),
      ]);
      setIndex(data);
      setRegistryList(reg);
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

  useEffect(() => {
    if (!open || !initialSkillName || !index) return;
    if (autoSelectedRef.current === initialSkillName) return;
    autoSelectedRef.current = initialSkillName;

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

  const handleInstall = async () => {
    if (!installRepo) return;
    setInstalling(true);
    try {
      await api.skills.registry.install(installRepo);
      setInstallRepo("");
      await loadIndex();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (name: string) => {
    if (!window.confirm(`Desinstalar "${name}"?`)) return;
    try {
      await api.skills.registry.uninstall(name);
      await loadIndex();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const tabItems: Tab[] = hasLoaded
    ? ["loaded", "rules", "skills", "agents", "workflows", "market"]
    : ["rules", "skills", "agents", "workflows", "market"];

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
      }
    }
  }

  const tabCounts: Record<Tab, number> = {
    loaded: loadedEntries.length,
    rules: index?.rules.length ?? 0,
    skills: index?.skills.length ?? 0,
    agents: index?.agents.length ?? 0,
    workflows: index?.workflows.length ?? 0,
    market: registryList.length,
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
      : tab === "market"
        ? []
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

  const selectedCat = selected
    ? ((selected as AnyEntry & { _category?: string })._category ??
      (index?.rules.find((r) => r.name === selected.name) ? "rule" : null) ??
      (index?.skills.find((s) => s.name === selected.name) ? "skill" : null) ??
      (index?.agents.find((a) => a.name === selected.name) ? "agent" : null) ??
      "workflow")
    : "";

  const selectedMeta = categoryMeta[selectedCat] ?? categoryMeta.skill;
  const selectedDependencies =
    selected?.category === "skill" ? ((selected as SkillEntry).dependencies ?? []) : [];

  return (
    <Dialog open={open} onClose={onClose} title="Skills & Agents" size="5xl">
      <div className="flex gap-4 h-[70vh] -mx-1">
        <div className="flex flex-col w-80 shrink-0 gap-2">
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
                className="flex-1 text-[9px] font-medium py-1.5 rounded-md transition-colors cursor-pointer"
                style={{
                  background: tab === t ? "var(--bg-surface)" : "transparent",
                  color: tab === t ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {t === "loaded"
                  ? "Carregadas"
                  : t === "rules"
                    ? "Regras"
                    : t === "skills"
                      ? "Skills"
                      : t === "agents"
                        ? "Agentes"
                        : t === "workflows"
                          ? "Fluxos"
                          : "Market"}
                {tabCounts[t] > 0 && (
                  <span className="ml-1 text-[8px] opacity-70">{tabCounts[t]}</span>
                )}
              </button>
            ))}
          </div>

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
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? "..." : "↻"}
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {loading && (
              <p className="text-xs text-center py-8" style={{ color: "var(--text-muted)" }}>
                Carregando...
              </p>
            )}
            {error && (
              <div className="text-xs px-3 py-2 rounded-lg border border-danger/30 bg-danger/15 text-danger">
                {error}
              </div>
            )}
            {!loading && currentList.length === 0 && index && (
              <div className="py-8 text-center">
                <p className="text-2xl mb-2">
                  {tab === "loaded" ? "🎯" : tab === "market" ? "📦" : "📁"}
                </p>
                <p className="text-xs" style={{ color: "var(--text-dimmed)" }}>
                  {tab === "loaded"
                    ? "Nenhuma skill carregada"
                    : tab === "market"
                      ? "Nenhuma skill instalada"
                      : `~/.agents/${tab} vazio`}
                </p>
              </div>
            )}
            {currentList.map((entry) => {
              const isSelected = selected?.filePath === entry.filePath;
              return (
                <SkillCard
                  key={entry.filePath || entry.name}
                  entry={entry as AnyEntry & { _category?: string }}
                  isSelected={isSelected}
                  onSelect={() => (entry.filePath ? handleSelect(entry as AnyEntry) : undefined)}
                />
              );
            })}
          </div>
        </div>

        <div className="w-px shrink-0 self-stretch" style={{ background: "var(--glass-border)" }} />

        <div className="flex-1 flex flex-col gap-3 min-w-0">
          {tab === "market" && !selected && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6 p-6">
              <div className="w-full max-w-md">
                <div className="text-center mb-6">
                  <div
                    className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3 text-2xl"
                    style={{ background: "var(--accent-muted)" }}
                  >
                    📦
                  </div>
                  <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
                    Install from GitHub
                  </h3>
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                    Cole o caminho do repositório (ex:{" "}
                    <code
                      className="px-1 py-0.5 rounded text-[10px]"
                      style={{ background: "var(--bg-input)", color: "var(--accent)" }}
                    >
                      usuário/repo/skills/minha-skill
                    </code>
                    )
                  </p>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={installRepo}
                    onChange={(e) => setInstallRepo(e.target.value)}
                    placeholder="usuário/repo/caminho"
                    className="flex-1 text-sm px-3 py-2 rounded-lg border outline-none"
                    style={{
                      background: "var(--bg-input)",
                      borderColor: "var(--glass-border)",
                      color: "var(--text-primary)",
                    }}
                    onKeyDown={(e) => e.key === "Enter" && handleInstall()}
                  />
                  <Button onClick={handleInstall} disabled={installing || !installRepo}>
                    {installing ? "..." : "Install"}
                  </Button>
                </div>
              </div>

              {registryList.length > 0 && (
                <div className="w-full max-w-md">
                  <h4
                    className="text-xs font-semibold mb-3"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    Installed ({registryList.length})
                  </h4>
                  <div className="space-y-1.5">
                    {registryList.map((name) => (
                      <div
                        key={name}
                        className="flex items-center justify-between p-2.5 rounded-lg border"
                        style={{
                          background: "var(--bg-card)",
                          borderColor: "var(--glass-border)",
                        }}
                      >
                        <span
                          className="text-xs font-medium"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {name}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleUninstall(name)}
                          style={{ color: "var(--danger)" }}
                        >
                          ✕
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab !== "market" && !selected && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-3xl mb-2 opacity-30">👆</p>
                <p className="text-sm" style={{ color: "var(--text-dimmed)" }}>
                  Selecione um item para visualizar
                </p>
              </div>
            </div>
          )}

          {selected && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
                    style={{
                      background: selectedMeta.bg,
                      color: selectedMeta.color,
                    }}
                  >
                    {selectedCat === "rule"
                      ? "R"
                      : selectedCat === "skill"
                        ? "S"
                        : selectedCat === "agent"
                          ? "A"
                          : "W"}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3
                        className="text-sm font-semibold"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {selected.name}
                      </h3>
                      {(selected as SkillEntry).version && (
                        <Badge variant="default" className="text-[9px]">
                          v{(selected as SkillEntry).version}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      {selected.description || "Sem descrição"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {previewContent && !previewLoading && (
                    <div
                      className="flex rounded-md overflow-hidden border text-[10px]"
                      style={{ borderColor: "var(--glass-border)" }}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewMode("raw")}
                        className="px-2 py-1 cursor-pointer transition-colors"
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
                        className="px-2 py-1 cursor-pointer transition-colors"
                        style={{
                          background:
                            previewMode === "rendered" ? "var(--bg-surface)" : "transparent",
                          color:
                            previewMode === "rendered"
                              ? "var(--text-primary)"
                              : "var(--text-muted)",
                        }}
                      >
                        Preview
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {selectedDependencies.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[9px] font-semibold uppercase"
                    style={{ color: "var(--text-dimmed)" }}
                  >
                    Dependências:
                  </span>
                  {selectedDependencies.map((dep) => (
                    <span
                      key={dep}
                      className="text-[9px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-mono border border-accent/20"
                    >
                      {dep}
                    </span>
                  ))}
                </div>
              )}

              <div
                className="flex-1 rounded-lg overflow-hidden"
                style={{ background: "var(--bg-input)" }}
              >
                {previewLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>
                      Carregando preview...
                    </p>
                  </div>
                ) : previewMode === "rendered" && previewContent ? (
                  <div className="h-full overflow-auto">
                    {renderSkillMarkdownPreview(previewContent)}
                  </div>
                ) : (
                  <pre
                    className="text-xs p-4 overflow-auto whitespace-pre-wrap font-mono"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {previewContent}
                  </pre>
                )}
              </div>

              <div
                className="flex items-center gap-2 text-[9px]"
                style={{ color: "var(--text-dimmed)" }}
              >
                <span className="font-mono truncate max-w-xs">{selected.filePath}</span>
              </div>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
