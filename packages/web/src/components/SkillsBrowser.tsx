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

const categoryMeta: Record<string, { color: string; bg: string; label: string; icon: string }> = {
  rule: { color: "#f59e0b", bg: "rgba(245,158,11,0.15)", label: "Rule", icon: "R" },
  skill: { color: "#8b5cf6", bg: "rgba(139,92,246,0.15)", label: "Skill", icon: "S" },
  agent: { color: "#3b82f6", bg: "rgba(59,130,246,0.15)", label: "Agent", icon: "A" },
  workflow: { color: "#10b981", bg: "rgba(16,185,129,0.15)", label: "Workflow", icon: "W" },
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
      nodes.push(
        <strong key={key} className="text-white font-bold">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*")) {
      nodes.push(
        <em key={key} className="italic text-dimmed">
          {token.slice(1, -1)}
        </em>
      );
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = linkMatch?.[2] ?? "";
      nodes.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 text-accent hover:text-accent-hover transition-colors"
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
        className="mb-4 rounded-xl border p-4 text-[11px] bg-white/[0.02] border-white/5"
      >
        {frontmatter.map(({ key, value }) => (
          <div
            key={key}
            className="grid grid-cols-[120px_1fr] gap-4 py-1 border-b border-white/5 last:border-0"
          >
            <span className="font-mono text-accent font-bold uppercase tracking-widest text-[9px]">
              {key}
            </span>
            <span className="text-secondary font-medium">{value}</span>
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
          className="my-4 overflow-x-auto rounded-xl border p-4 text-[11px] leading-relaxed bg-black/40 border-white/5 text-secondary custom-scrollbar shadow-inner"
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
        <div
          key={`table-${i}`}
          className="my-4 overflow-x-auto rounded-xl border border-white/5 custom-scrollbar"
        >
          <table className="w-full border-collapse text-[11px] bg-white/[0.02]">
            <thead>
              <tr>
                {headers.map((header) => (
                  <th
                    key={header}
                    className="border-b border-white/10 px-3 py-2.5 text-left font-black uppercase tracking-widest text-primary bg-white/5"
                  >
                    {renderInlineMarkdown(header)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row) => (
                <tr key={row.join("|")} className="hover:bg-white/5 transition-colors">
                  {row.map((cell) => (
                    <td
                      key={cell}
                      className="border-b border-white/5 px-3 py-2.5 align-top text-secondary"
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
        <h1 key={`h1-${i}`} className="mb-3 mt-6 text-xl font-black tracking-tight text-primary">
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
          className="mb-3 mt-5 border-b border-white/5 pb-2 text-sm font-black uppercase tracking-widest text-primary"
        >
          {renderInlineMarkdown(trimmed.slice(3))}
        </h2>
      );
      i += 1;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h3 key={`h3-${i}`} className="mb-2 mt-4 text-xs font-bold text-accent">
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
          className={`my-3 pl-6 text-xs leading-relaxed text-secondary ${ordered ? "list-decimal" : "list-disc marker:text-accent"}`}
        >
          {items.map((item) => (
            <li key={item} className="mb-1.5">
              {renderInlineMarkdown(item)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      blocks.push(
        <blockquote
          key={`quote-${i}`}
          className="my-3 border-l-4 border-accent bg-accent/5 pl-4 py-2 rounded-r-xl text-xs italic text-muted"
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
      <p key={`p-${i}`} className="my-3 text-xs leading-relaxed text-secondary text-balance">
        {renderInlineMarkdown(paragraphLines.join(" "))}
      </p>
    );
  }

  return <div className="text-xs leading-relaxed text-secondary">{blocks}</div>;
}

function SkillCard({
  entry,
  isSelected,
  onSelect,
}: {
  entry: AnyEntry & { _category?: string; filePath?: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  const cat = entry._category || "skill";
  const meta = categoryMeta[cat] ?? categoryMeta.skill;
  const applyTo = (entry as RuleEntry).applyTo;
  const scope = (entry as AnyEntry & { scope?: string }).scope;
  const dependencies = entry.category === "skill" ? ((entry as SkillEntry).dependencies ?? []) : [];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-2xl border transition-all active-shrink cursor-pointer group ${
        isSelected
          ? "bg-accent/10 border-accent shadow-lg shadow-accent/10"
          : "bg-surface/30 border-white/5 hover:border-white/10 hover:bg-surface/50"
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full shadow-[0_0_8px_currentColor]"
            style={{ backgroundColor: meta.color, color: meta.color }}
          />
          <span
            className="text-[10px] font-black uppercase tracking-widest opacity-70"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
          {scope && (
            <span className="text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              Workspace
            </span>
          )}
        </div>
        {isSelected && (
          <div className="w-5 h-5 rounded-full bg-accent flex items-center justify-center shadow-lg animate-in zoom-in duration-200">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-white"
              aria-hidden="true"
            >
              <title>Selected</title>
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
        )}
      </div>
      <h4 className="text-sm font-black tracking-tight text-primary truncate group-hover:text-accent transition-colors">
        {entry.name}
      </h4>
      <p className="text-[11px] text-muted line-clamp-2 mt-1 leading-relaxed">
        {entry.description || "No description provided"}
      </p>

      {applyTo && (
        <div className="mt-2">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-white/5 text-dimmed border border-white/5 truncate block">
            {applyTo.length > 35 ? `${applyTo.slice(0, 35)}…` : applyTo}
          </span>
        </div>
      )}

      {dependencies.length > 0 && (
        <div className="flex items-center gap-1 mt-2 flex-wrap">
          {dependencies.slice(0, 3).map((dep) => (
            <span
              key={dep}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/20"
            >
              {dep}
            </span>
          ))}
          {dependencies.length > 3 && (
            <span className="text-[9px] text-dimmed font-bold">+{dependencies.length - 3}</span>
          )}
        </div>
      )}
    </button>
  );
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
  matchedSkills = [],
}: {
  open: boolean;
  onClose: () => void;
  initialSkillName?: string;
  matchedSkills?: string[];
}) {
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

  const handleSelect = useCallback(async (entry: AnyEntry & { filePath?: string }) => {
    setSelected(entry);
    setPreviewContent(null);
    setPreviewLoading(true);
    setPreviewMode("rendered");
    if (!entry.filePath) {
      setPreviewContent("Internal module, no source file available.");
      setPreviewLoading(false);
      return;
    }
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
        i.description?.toLowerCase().includes(lowerSearch)
    );
  }

  const currentList: (AnyEntry & { _category?: string })[] =
    tab === "loaded"
      ? lowerSearch
        ? loadedEntries.filter(
            (i) =>
              i.name.toLowerCase().includes(lowerSearch) ||
              i.description?.toLowerCase().includes(lowerSearch)
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
      (index?.rules.find((r) => r.name === selected.name)
        ? "rule"
        : index?.skills.find((s) => s.name === selected.name)
          ? "skill"
          : index?.agents.find((a) => a.name === selected.name)
            ? "agent"
            : index?.workflows.find((w) => w.name === selected.name)
              ? "workflow"
              : "skill"))
    : "";

  const selectedMeta = categoryMeta[selectedCat] ?? categoryMeta.skill;
  const selectedDependencies =
    selected?.category === "skill" ? ((selected as SkillEntry).dependencies ?? []) : [];

  return (
    <Dialog open={open} onClose={onClose} title="Intelligence Registry" size="5xl">
      <div className="flex h-[75vh] -mx-8 -mb-8 mt-4 overflow-hidden border-t border-white/5 bg-black/20">
        {/* Modern Sidebar Nav */}
        <div className="w-72 shrink-0 border-r border-white/5 flex flex-col">
          <div className="p-4 space-y-1">
            {tabItems.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setSelected(null);
                  setPreviewContent(null);
                }}
                className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all active-shrink cursor-pointer ${
                  tab === t
                    ? "bg-accent text-white shadow-lg shadow-accent/25"
                    : "text-muted hover:text-primary hover:bg-white/5"
                }`}
              >
                <span>{t}</span>
                {tabCounts[t] > 0 && (
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9px] ${tab === t ? "bg-white/20" : "bg-white/5"}`}
                  >
                    {tabCounts[t]}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="px-4 pb-4">
            <div className="relative group">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <title>Search icon</title>
                  <circle cx="7" cy="7" r="5" />
                  <path d="M11 11l4 4" strokeLinecap="round" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-9 pl-9 pr-8 rounded-xl text-xs bg-input/50 border border-white/5 focus:border-accent/40 transition-all outline-none"
              />
              <button
                type="button"
                onClick={handleRefresh}
                disabled={refreshing}
                className="absolute inset-y-0 right-1 px-2 text-muted hover:text-primary transition-colors cursor-pointer flex items-center"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className={refreshing ? "animate-spin" : ""}
                  aria-hidden="true"
                >
                  <title>Refresh icon</title>
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 pt-0 space-y-2 custom-scrollbar">
            <div className="h-px bg-white/5 mb-4" />

            {loading && (
              <div className="space-y-2 animate-pulse">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="h-20 rounded-2xl bg-white/5" />
                ))}
              </div>
            )}

            {error && (
              <div className="text-xs px-3 py-2 rounded-xl border border-danger/30 bg-danger/10 text-danger font-bold">
                {error}
              </div>
            )}

            {!loading && currentList.length === 0 && index && tab !== "market" && (
              <div className="py-12 text-center opacity-30 space-y-3">
                <p className="text-5xl">∅</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
                  {tab === "loaded" ? "No skills loaded" : `No ${tab} available`}
                </p>
              </div>
            )}

            {currentList.map((entry) => {
              const isSelected =
                (selected as AnyEntry & { filePath?: string })?.filePath ===
                  (entry as AnyEntry & { filePath?: string }).filePath ||
                selected?.name === entry.name;

              // Infer _category from active tab when not already set
              const tabCategoryMap: Partial<Record<Tab, string>> = {
                rules: "rule",
                skills: "skill",
                agents: "agent",
                workflows: "workflow",
              };
              const entryWithCategory = {
                ...entry,
                _category:
                  (entry as AnyEntry & { _category?: string })._category ??
                  tabCategoryMap[tab] ??
                  "skill",
              };

              return (
                <SkillCard
                  key={(entry as AnyEntry & { filePath?: string }).filePath || entry.name}
                  entry={entryWithCategory}
                  isSelected={isSelected}
                  onSelect={() => handleSelect(entry as AnyEntry)}
                />
              );
            })}
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-hidden flex flex-col bg-black/10 relative">
          {tab === "market" && !selected ? (
            <div className="flex-1 overflow-y-auto p-10 custom-scrollbar animate-in fade-in duration-500">
              <div className="max-w-2xl mx-auto space-y-8">
                <div className="p-8 rounded-[2.5rem] bg-white/[0.02] border border-white/5 shadow-2xl text-center space-y-4">
                  <div className="w-16 h-16 rounded-[1.5rem] bg-accent/10 border border-accent/20 flex items-center justify-center mx-auto text-3xl shadow-xl shadow-accent/10">
                    📦
                  </div>
                  <h3 className="text-2xl font-black tracking-tight text-primary">Skill Market</h3>
                  <p className="text-sm text-muted leading-relaxed max-w-md mx-auto">
                    Install intelligence modules directly from GitHub repositories to expand agent
                    capabilities.
                  </p>

                  <div className="flex items-center gap-3 pt-4">
                    <input
                      type="text"
                      value={installRepo}
                      onChange={(e) => setInstallRepo(e.target.value)}
                      placeholder="user/repo/path/to/skill"
                      className="flex-1 h-12 px-5 rounded-2xl bg-input/40 border border-white/5 focus:border-accent/40 text-sm outline-none transition-all"
                      onKeyDown={(e) => e.key === "Enter" && handleInstall()}
                    />
                    <Button
                      variant="primary"
                      onClick={handleInstall}
                      disabled={installing || !installRepo}
                      className="h-12 px-8 rounded-2xl shadow-xl shadow-accent/20 font-black uppercase tracking-widest text-[10px]"
                    >
                      {installing ? "Installing..." : "Install Module"}
                    </Button>
                  </div>
                </div>

                {registryList.length > 0 && (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent/80">
                        Installed Modules
                      </h4>
                      <span className="text-[10px] font-black bg-white/5 px-2 py-0.5 rounded-md text-dimmed border border-white/5">
                        {registryList.length}
                      </span>
                    </div>
                    <div className="grid gap-2">
                      {registryList.map((name) => (
                        <div
                          key={name}
                          className="flex items-center justify-between p-4 rounded-2xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors group"
                        >
                          <span className="text-sm font-bold tracking-tight text-primary">
                            {name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUninstall(name)}
                            className="text-danger hover:bg-danger/10 hover:text-danger opacity-0 group-hover:opacity-100 transition-all font-black uppercase tracking-widest text-[9px] h-8 px-4 rounded-xl border border-danger/20"
                          >
                            Uninstall
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : !selected ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-center space-y-4">
              <p className="text-6xl">✦</p>
              <p className="text-xs font-black uppercase tracking-widest">
                Select an intelligence module
              </p>
            </div>
          ) : (
            <div className="flex flex-col h-full animate-in fade-in duration-500">
              <div className="p-8 pb-0 shrink-0">
                <div className="flex items-start justify-between gap-6 mb-6">
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div
                      className="w-14 h-14 rounded-[1.25rem] flex items-center justify-center text-2xl font-black shadow-lg"
                      style={{ background: selectedMeta.bg, color: selectedMeta.color }}
                    >
                      {selectedMeta.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-black tracking-tight text-primary truncate">
                          {selected.name}
                        </h2>
                        {(selected as SkillEntry).version && (
                          <Badge
                            variant="default"
                            className="text-[10px] font-black uppercase tracking-widest rounded-lg border-white/10 shadow-sm"
                          >
                            v{(selected as SkillEntry).version}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1.5 leading-relaxed">
                        {selected.description || "No description provided"}
                      </p>
                    </div>
                  </div>

                  {previewContent && !previewLoading && (
                    <div className="flex items-center rounded-xl overflow-hidden bg-input/40 border border-white/5 p-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setPreviewMode("raw")}
                        className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                          previewMode === "raw"
                            ? "bg-white text-black shadow-sm"
                            : "text-muted hover:text-primary"
                        }`}
                      >
                        Raw
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode("rendered")}
                        className={`px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all cursor-pointer ${
                          previewMode === "rendered"
                            ? "bg-white text-black shadow-sm"
                            : "text-muted hover:text-primary"
                        }`}
                      >
                        Preview
                      </button>
                    </div>
                  )}
                </div>

                {selectedDependencies.length > 0 && (
                  <div className="flex items-center gap-2 mb-6">
                    <span className="text-[9px] font-black uppercase tracking-widest text-dimmed mr-2">
                      Dependencies
                    </span>
                    {selectedDependencies.map((dep) => (
                      <span
                        key={dep}
                        className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-accent/10 text-accent border border-accent/20"
                      >
                        {dep}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-hidden p-8 pt-4 flex flex-col">
                <div className="flex-1 overflow-hidden rounded-[2rem] border border-white/5 bg-white/[0.02] shadow-inner relative">
                  {previewLoading ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 opacity-50 animate-pulse">
                      <div className="w-10 h-10 border-4 border-accent/20 border-t-accent rounded-full animate-spin" />
                      <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
                        Loading blueprint...
                      </p>
                    </div>
                  ) : previewMode === "rendered" && previewContent ? (
                    <div className="h-full overflow-y-auto custom-scrollbar p-4">
                      {renderSkillMarkdownPreview(previewContent)}
                    </div>
                  ) : (
                    <pre className="h-full overflow-y-auto custom-scrollbar p-8 text-xs font-mono whitespace-pre-wrap leading-relaxed text-secondary selection:bg-accent/30">
                      {previewContent}
                    </pre>
                  )}
                </div>
                {(selected as AnyEntry & { filePath?: string }).filePath && (
                  <div className="mt-4 flex items-center justify-center">
                    <span className="text-[9px] font-mono font-bold tracking-widest text-dimmed opacity-50 uppercase bg-white/5 px-3 py-1 rounded-full border border-white/5">
                      {(selected as AnyEntry & { filePath?: string }).filePath}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
