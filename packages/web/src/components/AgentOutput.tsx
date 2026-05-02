import type { AgentLog, LogStream } from "@vibe-code/shared";
import AnsiToHtml from "ansi-to-html";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { formatTime } from "../utils/date";

const ansiConverter = new AnsiToHtml({
  fg: "#e4e4e7",
  bg: "#09090b",
  newline: false,
  escapeXML: true,
  stream: false,
});
function convertAnsi(text: string): string {
  try {
    return ansiConverter.toHtml(text);
  } catch {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape strip
    return text.replace(/\u001b\[[0-9;]*m/g, "");
  }
}

function _stripAnsi(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape strip
  return text.replace(/\u001b\[[\d;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

/* ── Step grouping ─────────────────────────────────────── */

interface StepLog {
  log: AgentLog;
  matchNumber: number;
}

interface StepGroup {
  id: number;
  toolName: string;
  toolIcon: string;
  accentColor: string;
  logs: StepLog[];
  thinkingContent: string | null;
  isComplete: boolean;
  startedAt: number | null;
  finishedAt: number | null;
}

function detectToolIcon(name: string): string {
  const t = name.toLowerCase();
  if (t.includes("read") || t.includes("view_file") || t.includes("cat")) return "📖";
  if (t.includes("write") || t.includes("create") || t.includes("touch")) return "✏️";
  if (t.includes("edit") || t.includes("str_replace") || t.includes("patch")) return "✏️";
  if (t.includes("delete") || t.includes("remove")) return "🗑️";
  if (t.includes("move") || t.includes("rename")) return "🏷️";
  if (
    t.includes("bash") ||
    t.includes("run_command") ||
    t.includes("execute") ||
    t.includes("shell")
  )
    return "💻";
  if (t.includes("list") || t.includes("ls") || t.includes("directory")) return "📂";
  if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob"))
    return "🔍";
  if (t.includes("web") || t.includes("browser") || t.includes("fetch")) return "🌐";
  if (t.includes("git")) return "🔀";
  return "⚙️";
}

function detectToolColor(name: string): string {
  const t = name.toLowerCase();
  if (t.includes("read") || t.includes("view_file") || t.includes("cat")) return "#a78bfa";
  if (t.includes("write") || t.includes("create") || t.includes("touch")) return "#34d399";
  if (t.includes("edit") || t.includes("str_replace") || t.includes("patch")) return "#a78bfa";
  if (t.includes("delete") || t.includes("remove")) return "#f87171";
  if (t.includes("move") || t.includes("rename")) return "#fbbf24";
  if (
    t.includes("bash") ||
    t.includes("run_command") ||
    t.includes("execute") ||
    t.includes("shell")
  )
    return "#22d3ee";
  if (t.includes("list") || t.includes("ls") || t.includes("directory")) return "#60a5fa";
  if (t.includes("grep") || t.includes("search") || t.includes("find") || t.includes("glob"))
    return "#f97316";
  if (t.includes("web") || t.includes("browser") || t.includes("fetch")) return "#e879f9";
  if (t.includes("git")) return "#f87171";
  return "#71717a";
}

function buildStepGroups(logs: AgentLog[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let currentGroup: StepGroup | null = null;
  let stepId = 0;
  let prevTimestamp: number | null = null;

  // Tool name normalizer — converts snake_case/camelCase to readable label
  const normalizeToolName = (name: string): string => {
    const t = name.toLowerCase().replace(/_/g, " ");
    if (t.includes("list_directory") || t.includes("ls") || t.includes("directory_list"))
      return "Listing directory";
    if (t.includes("read_file") || t.includes("file_read") || t.includes("cat"))
      return "Reading file";
    if (t.includes("write_file") || t.includes("file_write") || t.includes("create_file"))
      return "Writing file";
    if (t.includes("glob") || t.includes("list_files")) return "Searching files";
    if (t.includes("bash") || t.includes("run_command") || t.includes("shell"))
      return "Running command";
    if (t.includes("edit_file") || t.includes("str_replace")) return "Editing file";
    if (t.includes("delete") || t.includes("remove")) return "Deleting file";
    if (t.includes("git")) return "Git operation";
    if (t.includes("update_topic") || t.includes("mcp_")) return "Planning step";
    return t.charAt(0).toUpperCase() + t.slice(1);
  };

  for (const log of logs) {
    // Pattern 1: OpenCode humanized tool labels ("Reading...", "Writing...", etc.)
    const humanizedMatch = log.content.match(
      /^(Reading|Writing|Editing|Deleting|Moving|Running:|Listing|Searching|Fetching|Git:|⚙️)/
    );

    // Pattern 2: Gemini-style "[tool] tool_name" system logs
    const geminiToolMatch = log.content.match(/^\[tool\]\s*(.+)/);

    if (humanizedMatch || geminiToolMatch) {
      if (currentGroup) {
        currentGroup.isComplete = true;
        currentGroup.finishedAt = prevTimestamp;
        groups.push(currentGroup);
      }
      stepId++;
      const toolLabel = humanizedMatch
        ? log.content.split(" ")[0].trim()
        : normalizeToolName(geminiToolMatch?.[1] ?? log.content);
      currentGroup = {
        id: stepId,
        toolName: log.content,
        toolIcon: detectToolIcon(toolLabel || log.content),
        accentColor: detectToolColor(toolLabel || log.content),
        logs: [],
        thinkingContent: null,
        isComplete: false,
        startedAt: new Date(log.timestamp).getTime(),
        finishedAt: null,
      };
    }

    // capture thinking
    if (
      (log.stream === "stdout" || log.stream === "system") &&
      (log.content.startsWith("Thinking") ||
        log.content.startsWith("[Thinking]") ||
        log.content.startsWith("💭") ||
        (/^[A-Z]/.test(log.content) && log.content.length < 200 && !log.content.includes("\n")))
    ) {
      if (currentGroup && !currentGroup.thinkingContent) {
        currentGroup.thinkingContent = log.content;
      }
    }

    if (currentGroup) {
      currentGroup.logs.push({ log, matchNumber: -1 });
      prevTimestamp = new Date(log.timestamp).getTime();
    } else if (log.stream !== "system") {
      // orphan log — create implicit group 0
      if (groups.length === 0) {
        stepId++;
        groups.push({
          id: stepId,
          toolName: "Output",
          toolIcon: "📄",
          accentColor: "#71717a",
          logs: [],
          thinkingContent: null,
          isComplete: true,
          startedAt: logs[0] ? new Date(logs[0].timestamp).getTime() : null,
          finishedAt: null,
        });
      }
      groups[groups.length - 1].logs.push({ log, matchNumber: -1 });
    }
  }

  if (currentGroup) {
    currentGroup.isComplete = true;
    currentGroup.finishedAt = prevTimestamp;
    groups.push(currentGroup);
  }

  return groups;
}

/* ── Accordion step renderer ─────────────────────────────── */

interface StepAccordionProps {
  group: StepGroup;
  isExpanded: boolean;
  onToggle: () => void;
  isLast: boolean;
  isRunning: boolean;
  showTimestamps: boolean;
  streamFilter: StreamFilter;
}

function StepAccordion({
  group,
  isExpanded,
  onToggle,
  isLast,
  isRunning,
  showTimestamps,
  streamFilter,
}: StepAccordionProps) {
  const ref = useRef<HTMLDivElement>(null);

  const filteredLogs = useMemo(() => {
    if (streamFilter === "all") return group.logs;
    return group.logs.filter((sl) => sl.log.stream === streamFilter);
  }, [group.logs, streamFilter]);

  const duration = useMemo(() => {
    if (!group.startedAt) return null;
    const end = group.finishedAt ?? (group.isComplete ? Date.now() : null);
    if (!end) return null;
    const diff = end - group.startedAt;
    if (diff < 1000) return `${diff}ms`;
    if (diff < 60_000) return `${(diff / 1000).toFixed(1)}s`;
    return `${Math.floor(diff / 60_000)}m ${Math.round((diff % 60_000) / 1000)}s`;
  }, [group.startedAt, group.finishedAt, group.isComplete]);

  return (
    <div
      ref={ref}
      className="relative border-b border-[var(--border-subtle)] last:border-b-0 group/step"
      data-step-id={group.id}
    >
      {/* Accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-0.5 opacity-80"
        style={{ background: group.accentColor }}
      />

      {/* Header row */}
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer select-none hover:bg-[var(--bg-surface-hover)] ${
          isExpanded ? "bg-[var(--bg-surface)]" : ""
        }`}
      >
        {/* Running indicator */}
        {isLast && isRunning && (
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        )}

        {/* Step number */}
        <span
          className="text-[10px] font-mono font-semibold shrink-0 w-5 h-5 rounded flex items-center justify-center"
          style={{
            background: `${group.accentColor}22`,
            color: group.accentColor,
          }}
        >
          {group.id}
        </span>

        {/* Tool icon */}
        <span className="text-sm shrink-0">{group.toolIcon}</span>

        {/* Tool name — first line of content */}
        <span className="flex-1 text-xs font-mono text-[var(--text-primary)] truncate">
          {group.toolName}
        </span>

        {/* Thinking badge */}
        {group.thinkingContent && (
          <span className="text-[9px] font-mono text-[var(--text-dimmed)] italic border border-[var(--border-subtle)] px-1 py-0.5 rounded shrink-0 truncate max-w-[120px] hidden sm:inline">
            💭
          </span>
        )}

        {/* Duration badge */}
        {duration && (
          <span
            className="text-[9px] font-mono text-[var(--text-dimmed)] border border-[var(--border-subtle)] px-1 py-0.5 rounded shrink-0 hidden sm:inline"
            title={`Step duration: ${duration}`}
          >
            ⏱ {duration}
          </span>
        )}

        {/* Log count badge */}
        {group.logs.length > 0 && (
          <span className="text-[9px] font-mono text-[var(--text-dimmed)] border border-[var(--border-subtle)] px-1 py-0.5 rounded shrink-0">
            {group.logs.length}L
          </span>
        )}

        {/* Chevron */}
        <span
          className={`text-[10px] text-[var(--text-dimmed)] shrink-0 transition-transform duration-200 ${
            isExpanded ? "rotate-90" : ""
          }`}
        >
          ▶
        </span>
      </button>

      {/* Expanded body */}
      <div
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isExpanded ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        {/* Thinking block */}
        {group.thinkingContent && isExpanded && (
          <div className="px-4 py-2 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            <div className="flex items-start gap-2">
              <span className="text-[10px] text-[var(--text-dimmed)] mt-0.5 shrink-0">💭</span>
              <p className="text-[11px] font-mono text-[var(--text-dimmed)] italic leading-relaxed">
                {group.thinkingContent}
              </p>
            </div>
          </div>
        )}

        {/* Log lines */}
        <div className="font-mono text-xs space-y-0.5">
          {filteredLogs.map((sl, idx2) => {
            const log = sl.log;
            if (log.stream === "system" && /^\[tool\]|\[tool result\]/.test(log.content))
              return null;

            const color =
              log.stream === "stderr"
                ? "#f87171"
                : log.stream === "system"
                  ? "#71717a"
                  : log.stream === "stdin"
                    ? "#34d399"
                    : "";

            const html = convertAnsi(log.content);
            // biome-ignore lint/security/noDangerouslySetInnerHtml: ansi-to-html with escapeXML:true
            const inner = <span dangerouslySetInnerHTML={{ __html: html }} />;

            const isToolOutput =
              log.stream === "stdout" &&
              (log.content.startsWith("    ") ||
                log.content.match(/^(✓|✗|Exit|Success|Error|Read|Wrote|Deleted|Running)/));
            const isParamLine =
              log.stream === "stdout" && log.content.match(/^\s{4}[a-zA-Z_]+\s*=/);

            return (
              <div
                key={log.id ?? `log-${idx2}`}
                className={`px-4 py-px leading-relaxed pl-8 ${
                  log.stream === "stdout"
                    ? isToolOutput
                      ? "text-[var(--text-dimmed)]"
                      : "text-[var(--text-secondary)]"
                    : ""
                }${isParamLine ? " text-[var(--accent-text)]/60" : ""}`}
                style={{ color: color || undefined }}
              >
                {showTimestamps && (
                  <span className="text-[var(--text-dimmed)] select-none mr-1 text-[10px]">
                    {formatTime(log.timestamp)}
                  </span>
                )}
                {log.stream === "stdin" && <span className="text-success mr-1">$ </span>}
                {inner}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface AgentOutputProps {
  runId: string | null;
  liveLogs: AgentLog[];
  isRunning: boolean;
  onSendInput?: (input: string) => void;
  /** If true, renders in full-height mode (for dedicated terminal view) */
  fullHeight?: boolean;
  /** Latest status from the agent (from run.currentStatus) */
  currentStatus?: string | null;
  /** Cost statistics from the latest run */
  costStats?: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    cached?: number;
    input?: number;
  } | null;
}

/** Detects if the last few log lines contain an unanswered question from the agent */
function detectAwaitingInput(logs: AgentLog[]): string | null {
  const recent = logs.slice(-5);
  for (let i = recent.length - 1; i >= 0; i--) {
    const log = recent[i];
    if (
      log.stream === "stdout" &&
      (log.content.includes("[?]") || log.content.includes("[Question]"))
    ) {
      return log.content.replace(/\[Question\]|\[(\?)]/gi, (_, q) => q ?? "").trim();
    }
    if (log.stream === "stdin") return null;
  }
  return null;
}

/** Derive token usage and step count from system logs */
function deriveTokenStats(logs: AgentLog[]): { totalTokens: number; steps: number } {
  let totalTokens = 0;
  let steps = 0;
  for (const log of logs) {
    if (log.stream === "system") {
      const m = log.content.match(/tokens (?:used:)?\s*([\d,]+)/);
      if (m) {
        totalTokens += parseInt(m[1].replace(/,/g, ""), 10);
        steps++;
      }
    }
  }
  return { totalTokens, steps };
}

/** Count tool invocations by type from stdout logs */
function deriveToolStats(logs: AgentLog[]) {
  let reads = 0;
  let writes = 0;
  let searches = 0;
  let commands = 0;
  for (const log of logs) {
    if (log.stream !== "stdout" && log.stream !== "system") continue;
    const c = log.content.trim();
    if (c.startsWith("Reading") || c.includes("read_file") || c.includes("Reading file")) reads++;
    else if (
      c.startsWith("Writing") ||
      c.startsWith("Editing") ||
      c.startsWith("Deleting") ||
      c.includes("write_file") ||
      c.includes("edit_file") ||
      c.includes("Writing file")
    )
      writes++;
    else if (
      c.startsWith("Searching") ||
      c.includes("glob") ||
      c.includes("Searching files") ||
      c.includes("list_directory")
    )
      searches++;
    else if (c.startsWith("Running:") || c.startsWith("Git:") || c.includes("Running command"))
      commands++;
  }
  return { reads, writes, searches, commands };
}

/** Format token count as human-readable string */
function fmtTokens(n: number): string {
  if (n === 0) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

type StreamFilter = LogStream | "all";
const STREAM_LABEL: Record<string, string> = {
  all: "Todos",
  stdout: "Saída",
  stderr: "Erros",
  system: "Sistema",
  review: "Review",
  stdin: "Stdin",
};
const STREAM_TABS: StreamFilter[] = ["all", "stdout", "stderr", "system", "review"];

export function AgentOutput({
  runId,
  liveLogs,
  isRunning,
  onSendInput,
  fullHeight = false,
  currentStatus,
  costStats,
}: AgentOutputProps) {
  const [historicLogs, setHistoricLogs] = useState<AgentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [_matchIdx, setMatchIdx] = useState(0);
  const [pinnedBottom, setPinnedBottom] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [splitMode, setSplitMode] = useState<"none" | "right" | "down">("none");

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load historic logs when run changes (with abort to prevent stale responses)
  useEffect(() => {
    setHistoricLogs([]);
    setExpandedSteps(new Set());
    if (!runId) return;
    const abortCtrl = new AbortController();
    setLoadingLogs(true);
    api.runs
      .logs(runId)
      .then((logs) => {
        if (!abortCtrl.signal.aborted) {
          setHistoricLogs(logs);
          // auto-expand last step
          const groups = buildStepGroups(logs);
          if (groups.length > 0) {
            setExpandedSteps(new Set([groups[groups.length - 1].id]));
          }
        }
      })
      .catch((err) => {
        if (!abortCtrl.signal.aborted) console.error(err);
      })
      .finally(() => {
        if (!abortCtrl.signal.aborted) setLoadingLogs(false);
      });
    return () => abortCtrl.abort();
  }, [runId]);

  // Deduplicate live vs historic
  const allLogs = useMemo(() => {
    if (historicLogs.length === 0) return liveLogs;
    const last = historicLogs[historicLogs.length - 1];
    return [...historicLogs, ...liveLogs.filter((l) => l.timestamp > last.timestamp)];
  }, [historicLogs, liveLogs]);

  // Auto-expand last step when new tool activity appears while running
  useEffect(() => {
    if (!isRunning) return;
    const groups = buildStepGroups(allLogs);
    if (groups.length > 0) {
      const last = groups[groups.length - 1];
      setExpandedSteps((prev) => {
        if (prev.has(last.id)) return prev;
        return new Set([...prev, last.id]);
      });
    }
  }, [allLogs, isRunning]);

  // Derived stats (only recomputed when allLogs changes)
  const tokenStats = useMemo(() => deriveTokenStats(allLogs), [allLogs]);
  const toolStats = useMemo(() => deriveToolStats(allLogs), [allLogs]);

  // Detect if agent is waiting for input
  const awaitingQuestion = useMemo(
    () => (isRunning ? detectAwaitingInput(allLogs) : null),
    [allLogs, isRunning]
  );

  // Stream counts for tab badges
  const streamCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allLogs.length };
    for (const log of allLogs) {
      counts[log.stream] = (counts[log.stream] ?? 0) + 1;
    }
    return counts;
  }, [allLogs]);

  // Ctrl+F to open search — scoped to the container element so it doesn't
  // override the browser's global find-in-page when this component is not focused.
  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setSplitMode((prev) => (prev === "right" ? "none" : "right"));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "D" && e.shiftKey) {
        e.preventDefault();
        setSplitMode((prev) => (prev === "down" ? "none" : "down"));
        return;
      }
      if (e.key === "Escape" && showSearch) {
        e.stopPropagation();
        setShowSearch(false);
        setSearchQuery("");
      }
    },
    [showSearch]
  );

  // Detect manual scroll
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setPinnedBottom(atBottom);
  };

  const toggleSearch = () => {
    setShowSearch((v) => {
      if (!v) setTimeout(() => searchRef.current?.focus(), 0);
      else setSearchQuery("");
      return !v;
    });
  };

  const copyLogs = () => {
    const text = allLogs.map((l) => `[${formatTime(l.timestamp)}] ${l.content}`).join("\n");
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const downloadLogs = useCallback(() => {
    const text = allLogs
      .map((l) => `[${formatTime(l.timestamp)}][${l.stream}] ${l.content}`)
      .join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${runId ?? "task"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [allLogs, runId]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.error);
    } else {
      document.exitFullscreen().catch(console.error);
    }
  }, []);

  // Sync isFullscreen state with native fullscreen changes
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !onSendInput) return;
    onSendInput(input);
    setInput("");
    inputRef.current?.focus();
  };

  const stepGroups = useMemo(() => buildStepGroups(allLogs), [allLogs]);

  const toggleStep = useCallback((id: number) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const containerClass = isFullscreen
    ? "flex flex-col rounded-xl border border-strong shadow-2xl overflow-hidden bg-app h-full"
    : `flex flex-col rounded-lg border border-default overflow-hidden${fullHeight ? " flex-1 min-h-0" : ""}`;

  if (!runId && liveLogs.length === 0) {
    return (
      <div className="text-center text-dimmed py-8 text-sm">Nenhuma saída do agente ainda</div>
    );
  }

  const hasToolActivity =
    toolStats.reads + toolStats.writes + toolStats.searches + toolStats.commands > 0;

  const displayTokens = costStats?.total_tokens ?? tokenStats.totalTokens;
  const cost = costStats?.input !== undefined ? costStats.input / 1_000_000 : 0;

  const renderContent = () => (
    <>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-input border-b border-default flex-wrap">
        <span className="text-[10px] text-dimmed font-mono shrink-0">
          {allLogs.length} linhas{isRunning ? " · rodando" : ""}
        </span>

        {/* Token counter */}
        {displayTokens > 0 && (
          <span
            className="text-[10px] text-accent-text/70 font-mono shrink-0"
            title={`${displayTokens.toLocaleString()} tokens em ${tokenStats.steps} step${tokenStats.steps !== 1 ? "s" : ""}`}
          >
            · {fmtTokens(displayTokens)} tokens
          </span>
        )}

        {/* Cost stats */}
        {(cost > 0 ||
          (costStats && (costStats.input_tokens > 0 || costStats.output_tokens > 0))) && (
          <span
            className="text-[10px] text-warning-muted font-mono shrink-0 font-bold"
            title={
              costStats
                ? `In: ${costStats.input_tokens.toLocaleString()}, Out: ${costStats.output_tokens.toLocaleString()}`
                : ""
            }
          >
            · {cost > 0 && `$${cost.toFixed(4)}`}
            {costStats &&
              ` (${fmtTokens(costStats.input_tokens)}in/${fmtTokens(costStats.output_tokens)}out)`}
          </span>
        )}

        {/* Tool stats mini-bar */}
        {hasToolActivity && (
          <span className="text-[10px] text-dimmed font-mono shrink-0 hidden sm:inline">
            ·{toolStats.reads > 0 && <span title="Leituras"> 📖{toolStats.reads}</span>}
            {toolStats.writes > 0 && <span title="Escritas"> ✏️{toolStats.writes}</span>}
            {toolStats.searches > 0 && <span title="Buscas"> 🔍{toolStats.searches}</span>}
            {toolStats.commands > 0 && <span title="Comandos"> 💻{toolStats.commands}</span>}
          </span>
        )}

        {awaitingQuestion && (
          <span className="text-[10px] text-warning animate-pulse font-sans not-italic shrink-0">
            ⚡ aguardando input
          </span>
        )}

        <div className="flex-1" />

        {/* Search toggle */}
        <button
          type="button"
          onClick={toggleSearch}
          title="Buscar nos logs (Ctrl+F)"
          className={`p-1 rounded text-xs cursor-pointer transition-colors ${
            showSearch ? "text-accent-text bg-accent-muted" : "text-dimmed hover:text-secondary"
          }`}
        >
          🔍
        </button>

        {/* Timestamp toggle */}
        <button
          type="button"
          onClick={() => setShowTimestamps((v) => !v)}
          title={showTimestamps ? "Ocultar timestamps" : "Mostrar timestamps"}
          className={`p-1 rounded text-xs cursor-pointer transition-colors ${
            showTimestamps ? "text-accent-text bg-accent-muted" : "text-dimmed hover:text-secondary"
          }`}
        >
          ⏱
        </button>

        {/* Copy */}
        <button
          type="button"
          onClick={copyLogs}
          title="Copiar todos os logs"
          className="p-1 rounded text-xs text-dimmed hover:text-secondary cursor-pointer transition-colors"
        >
          ⎘
        </button>

        {/* Download */}
        <button
          type="button"
          onClick={downloadLogs}
          title="Download logs (.txt)"
          className="p-1 rounded text-xs text-dimmed hover:text-secondary cursor-pointer transition-colors"
        >
          ⬇
        </button>

        {/* Split toggles */}
        <button
          type="button"
          onClick={() => setSplitMode((prev) => (prev === "right" ? "none" : "right"))}
          title={splitMode === "right" ? "Remover split" : "Dividir à direita (Ctrl+D)"}
          className={`p-1 rounded text-xs cursor-pointer transition-colors ${
            splitMode === "right"
              ? "text-accent-text bg-accent-muted"
              : "text-dimmed hover:text-secondary"
          }`}
        >
          ◫
        </button>
        <button
          type="button"
          onClick={() => setSplitMode((prev) => (prev === "down" ? "none" : "down"))}
          title={splitMode === "down" ? "Remover split" : "Dividir abaixo (Ctrl+Shift+D)"}
          className={`p-1 rounded text-xs cursor-pointer transition-colors ${
            splitMode === "down"
              ? "text-accent-text bg-accent-muted"
              : "text-dimmed hover:text-secondary"
          }`}
        >
          ⊟
        </button>

        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Sair do modo tela cheia" : "Modo tela cheia (F11)"}
          className="p-1 rounded text-xs text-dimmed hover:text-secondary cursor-pointer transition-colors"
        >
          {isFullscreen ? "⊡" : "⊞"}
        </button>

        {/* Scroll to bottom */}
        {!pinnedBottom && (
          <button
            type="button"
            onClick={() => {
              setPinnedBottom(true);
              if (stepGroups.length > 0) {
                const last = stepGroups[stepGroups.length - 1];
                setExpandedSteps((prev) => new Set([...prev, last.id]));
              }
            }}
            className="p-1 rounded text-xs text-info hover:text-info cursor-pointer animate-pulse"
            title="Rolar para o fim"
          >
            ↓
          </button>
        )}
      </div>

      {/* Current activity bar — shows last status message when running */}
      {isRunning && currentStatus && (
        <div className="flex items-center gap-2 px-3 py-1 bg-info/15 border-b border-info/30">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="text-[11px] text-info font-mono truncate">{currentStatus}</span>
        </div>
      )}

      {/* Stream filter + search bar */}
      <div className="flex items-center gap-2 px-2 py-1 bg-input/80 border-b border-default flex-wrap">
        {/* Stream filter tabs */}
        <div className="flex gap-1 shrink-0">
          {STREAM_TABS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStreamFilter(f)}
              className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${
                streamFilter === f
                  ? "bg-surface-hover text-primary"
                  : "text-dimmed hover:text-secondary"
              }`}
            >
              {STREAM_LABEL[f]}
              {streamCounts[f] ? ` (${streamCounts[f]})` : ""}
            </button>
          ))}
        </div>

        {showSearch && (
          <>
            <div className="w-px h-4 bg-surface-hover shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setShowSearch(false);
                  setSearchQuery("");
                }
              }}
              placeholder={searchQuery ? "Buscar..." : "Buscar nos logs..."}
              className="flex-1 bg-transparent text-xs font-mono text-secondary placeholder:text-dimmed focus:outline-none min-w-0"
            />
            {searchQuery && <span className="text-[10px] text-primary0 shrink-0">buscar</span>}
            <button
              type="button"
              onClick={() => setMatchIdx((i) => Math.max(i - 1, 0))}
              className="text-primary0 hover:text-secondary cursor-pointer text-xs shrink-0"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => setMatchIdx((i) => i + 1)}
              className="text-primary0 hover:text-secondary cursor-pointer text-xs shrink-0"
            >
              ↓
            </button>
          </>
        )}
      </div>

      {/* Step accordion output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`bg-app overflow-y-auto cursor-text ${
          isFullscreen || fullHeight ? "flex-1" : "max-h-[480px] min-h-[140px]"
        }`}
      >
        {stepGroups.map((group, idx) => (
          <StepAccordion
            key={group.id}
            group={group}
            isExpanded={expandedSteps.has(group.id)}
            onToggle={() => toggleStep(group.id)}
            isLast={idx === stepGroups.length - 1}
            isRunning={isRunning}
            showTimestamps={showTimestamps}
            streamFilter={streamFilter}
          />
        ))}

        {!loadingLogs && allLogs.length === 0 && (
          <div className="text-dimmed p-3">Aguardando saída...</div>
        )}
      </div>

      {/* Running status footer */}
      {isRunning && !awaitingQuestion && stepGroups.length > 0 && (
        <div className="flex items-center gap-1.5 text-info px-3 py-1 border-t border-default bg-input/80 shrink-0">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span className="text-[11px]">Agente rodando...</span>
        </div>
      )}

      {/* Stdin input */}
      {isRunning && onSendInput && (
        <form
          onSubmit={handleSubmit}
          className={`flex border-t bg-input transition-all ${
            awaitingQuestion ? "border-warning/30 bg-warning/15" : "border-default"
          }`}
        >
          {awaitingQuestion && (
            <div className="w-full px-3 pt-2 pb-0">
              <p className="text-[10px] text-warning font-mono truncate">⚡ {awaitingQuestion}</p>
            </div>
          )}
          <div className={`flex w-full ${awaitingQuestion ? "pt-1" : ""}`}>
            <span
              className={`pl-3 py-2 text-xs font-mono select-none ${awaitingQuestion ? "text-warning" : "text-success"}`}
            >
              {awaitingQuestion ? "?" : "$"}
            </span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                awaitingQuestion ? "Digite sua resposta..." : "Enviar input ao agente..."
              }
              className={`flex-1 bg-transparent px-2 py-2 text-xs font-mono placeholder:text-dimmed focus:outline-none ${
                awaitingQuestion ? "text-warning" : "text-primary"
              }`}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className={`px-3 py-2 text-xs disabled:opacity-30 cursor-pointer transition-colors ${
                awaitingQuestion
                  ? "text-warning hover:text-warning"
                  : "text-primary0 hover:text-secondary"
              }`}
            >
              Enviar
            </button>
          </div>
        </form>
      )}
    </>
  );

  return (
    <section
      ref={containerRef}
      className={containerClass}
      onKeyDown={handleContainerKeyDown}
      tabIndex={-1}
      aria-label="Saída do Agente"
    >
      <div
        className={`flex w-full h-full flex-1 min-h-0 ${splitMode === "down" ? "flex-col" : ""}`}
      >
        <div className="flex-1 min-h-0 min-w-0 flex flex-col border-r border-default last:border-r-0">
          {renderContent()}
        </div>
        {splitMode !== "none" && (
          <div
            className={`flex-1 min-h-0 min-w-0 flex flex-col ${splitMode === "down" ? "border-t border-default" : "border-l border-default"}`}
          >
            {renderContent()}
          </div>
        )}
      </div>
    </section>
  );
}
