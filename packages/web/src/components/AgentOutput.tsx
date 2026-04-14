import { useVirtualizer } from "@tanstack/react-virtual";
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

interface AgentOutputProps {
  runId: string | null;
  liveLogs: AgentLog[];
  isRunning: boolean;
  onSendInput?: (input: string) => void;
  /** If true, renders in full-height mode (for dedicated terminal view) */
  fullHeight?: boolean;
  /** Latest status from the agent (from run.currentStatus) */
  currentStatus?: string | null;
}

function getStreamColor(stream: string, content: string): string {
  if (stream === "review") {
    if (content.startsWith("BLOCKER:")) return "#f87171";
    if (content.startsWith("WARNING:")) return "#facc15";
    if (content.startsWith("INFO:")) return "#60a5fa";
    if (content.startsWith("LGTM")) return "#34d399";
    if (content.startsWith("[REVIEW:")) return "#c4b5fd";
    return "#a1a1aa";
  }
  switch (stream) {
    case "stderr":
      return "#f87171";
    case "system":
      return "#71717a";
    case "stdin":
      return "#34d399";
    default:
      return "";
  }
}

const PERSONA_BADGE: Record<string, string> = {
  frontend: "bg-blue-900/50 text-blue-300 border border-blue-700/50",
  backend: "bg-emerald-900/50 text-emerald-300 border border-emerald-700/50",
  security: "bg-red-900/50 text-red-300 border border-red-700/50",
  quality: "bg-yellow-900/50 text-yellow-300 border border-yellow-700/50",
};

function ReviewBadge({ content }: { content: string }) {
  const match = content.match(/^\[REVIEW:(\w+)\]/);
  if (!match) return null;
  const persona = match[1];
  const cls = PERSONA_BADGE[persona] ?? "bg-zinc-800 text-zinc-300";
  return (
    <span
      className={`inline-block text-[9px] font-mono px-1.5 py-0.5 rounded mr-1.5 leading-none ${cls}`}
    >
      {persona}
    </span>
  );
}

/** Detects if the last few log lines contain an unanswered question from the agent */
function detectAwaitingInput(logs: AgentLog[]): string | null {
  // Look at the last 5 log lines for a [Question] event
  const recent = logs.slice(-5);
  for (let i = recent.length - 1; i >= 0; i--) {
    const log = recent[i];
    if (log.stream === "stdout" && log.content.includes("[Question]")) {
      return log.content.replace("[Question]", "").trim();
    }
    // If we see a stdin entry, the question was already answered
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
      const m = log.content.match(/tokens used:\s*([\d,]+)/);
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
    if (log.stream !== "stdout") continue;
    const c = log.content.trim();
    if (c.startsWith("Reading")) reads++;
    else if (c.startsWith("Writing") || c.startsWith("Editing") || c.startsWith("Deleting"))
      writes++;
    else if (c.startsWith("Searching")) searches++;
    else if (c.startsWith("Running:") || c.startsWith("Git:")) commands++;
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
}: AgentOutputProps) {
  const [historicLogs, setHistoricLogs] = useState<AgentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [useRegex, setUseRegex] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [pinnedBottom, setPinnedBottom] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");
  const [showTimestamps, setShowTimestamps] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Load historic logs when run changes
  useEffect(() => {
    setHistoricLogs([]);
    if (!runId) return;
    setLoadingLogs(true);
    api.runs
      .logs(runId)
      .then(setHistoricLogs)
      .catch(console.error)
      .finally(() => setLoadingLogs(false));
  }, [runId]);

  // Deduplicate live vs historic
  const allLogs = useMemo(() => {
    if (historicLogs.length === 0) return liveLogs;
    const last = historicLogs[historicLogs.length - 1];
    return [...historicLogs, ...liveLogs.filter((l) => l.timestamp > last.timestamp)];
  }, [historicLogs, liveLogs]);

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

  // Auto-scroll when pinned — rowVirtualizer declared below, after renderedLogs
  // (effects run after render so forward reference is safe at runtime, but TS
  //  needs the virtualizer declared before the useMemo it depends on)
  // See declaration right after renderedLogs useMemo.

  // Auto-focus input only when a new question appears and user is not selecting/copying logs.
  const lastQuestionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!awaitingQuestion || !isRunning) {
      lastQuestionRef.current = awaitingQuestion;
      return;
    }

    const isNewQuestion = awaitingQuestion !== lastQuestionRef.current;
    lastQuestionRef.current = awaitingQuestion;
    if (!isNewQuestion) return;

    const selection = window.getSelection?.()?.toString() ?? "";
    const active = document.activeElement;
    const editingElsewhere =
      active instanceof HTMLInputElement ||
      active instanceof HTMLTextAreaElement ||
      (active as HTMLElement | null)?.isContentEditable === true;
    if (selection.trim() || editingElsewhere) return;

    setTimeout(() => inputRef.current?.focus(), 100);
  }, [awaitingQuestion, isRunning]);

  // Scroll to highlighted match — moved below rowVirtualizer declaration
  // (see effect after renderedLogs + rowVirtualizer)

  // Global Ctrl+F to open search within this component
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchRef.current?.focus(), 0);
      }
      if (e.key === "Escape" && showSearch) {
        setShowSearch(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [showSearch]);

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

  // Apply stream filter then search highlight
  const { renderedLogs, totalMatches } = useMemo(() => {
    const filtered =
      streamFilter === "all" ? allLogs : allLogs.filter((l) => l.stream === streamFilter);

    if (!showSearch || !searchQuery.trim()) {
      return { renderedLogs: filtered.map((l) => ({ log: l, matchNumber: -1 })), totalMatches: 0 };
    }
    let re: RegExp | null = null;
    if (useRegex) {
      try {
        re = new RegExp(searchQuery, "i");
      } catch {
        /* invalid regex */
      }
    }
    const q = searchQuery.toLowerCase();
    let counter = 0;
    const renderedLogs = filtered.map((l) => {
      const hit = re ? re.test(l.content) : l.content.toLowerCase().includes(q);
      return { log: l, matchNumber: hit ? counter++ : -1 };
    });
    return { renderedLogs, totalMatches: counter };
  }, [allLogs, showSearch, searchQuery, streamFilter, useRegex]);

  // Virtual list — declared after renderedLogs to avoid forward-reference TS errors
  const rowVirtualizer = useVirtualizer({
    count: renderedLogs.length + (loadingLogs ? 1 : 0),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 22,
    overscan: 30,
  });

  // Auto-scroll when pinned
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally triggers on log append
  useEffect(() => {
    if (!pinnedBottom || renderedLogs.length === 0) return;
    rowVirtualizer.scrollToIndex(renderedLogs.length - 1, { align: "end" });
  }, [renderedLogs.length, pinnedBottom]);

  // Scroll to highlighted match
  useEffect(() => {
    if (!showSearch || !searchQuery || totalMatches === 0) return;
    const idx = renderedLogs.findIndex((r) => r.matchNumber === matchIdx);
    if (idx >= 0) rowVirtualizer.scrollToIndex(idx, { align: "auto" });
  }, [matchIdx, showSearch, searchQuery, totalMatches, renderedLogs, rowVirtualizer]);

  const containerClass = isFullscreen
    ? "flex flex-col rounded-xl border border-zinc-700 shadow-2xl overflow-hidden bg-zinc-950 h-full"
    : "flex flex-col rounded-lg border border-zinc-800 overflow-hidden";

  if (!runId && liveLogs.length === 0) {
    return (
      <div className="text-center text-zinc-600 py-8 text-sm">Nenhuma saída do agente ainda</div>
    );
  }

  const hasToolActivity =
    toolStats.reads + toolStats.writes + toolStats.searches + toolStats.commands > 0;

  return (
    <div ref={containerRef} className={containerClass}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 bg-zinc-900 border-b border-zinc-800 flex-wrap">
        <span className="text-[10px] text-zinc-600 font-mono shrink-0">
          {allLogs.length} linhas{isRunning ? " · rodando" : ""}
        </span>

        {/* Token counter */}
        {tokenStats.totalTokens > 0 && (
          <span
            className="text-[10px] text-violet-400/70 font-mono shrink-0"
            title={`${tokenStats.totalTokens.toLocaleString()} tokens em ${tokenStats.steps} step${tokenStats.steps !== 1 ? "s" : ""}`}
          >
            · {fmtTokens(tokenStats.totalTokens)} tokens
          </span>
        )}

        {/* Tool stats mini-bar */}
        {hasToolActivity && (
          <span className="text-[10px] text-zinc-600 font-mono shrink-0 hidden sm:inline">
            ·{toolStats.reads > 0 && <span title="Leituras"> 📖{toolStats.reads}</span>}
            {toolStats.writes > 0 && <span title="Escritas"> ✏️{toolStats.writes}</span>}
            {toolStats.searches > 0 && <span title="Buscas"> 🔍{toolStats.searches}</span>}
            {toolStats.commands > 0 && <span title="Comandos"> 💻{toolStats.commands}</span>}
          </span>
        )}

        {awaitingQuestion && (
          <span className="text-[10px] text-amber-400 animate-pulse font-sans not-italic shrink-0">
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
            showSearch ? "text-violet-400 bg-violet-900/30" : "text-zinc-600 hover:text-zinc-300"
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
            showTimestamps
              ? "text-violet-400 bg-violet-900/30"
              : "text-zinc-600 hover:text-zinc-300"
          }`}
        >
          ⏱
        </button>

        {/* Copy */}
        <button
          type="button"
          onClick={copyLogs}
          title="Copiar todos os logs"
          className="p-1 rounded text-xs text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
        >
          ⎘
        </button>

        {/* Download */}
        <button
          type="button"
          onClick={downloadLogs}
          title="Download logs (.txt)"
          className="p-1 rounded text-xs text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
        >
          ⬇
        </button>

        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Sair do modo tela cheia" : "Modo tela cheia (F11)"}
          className="p-1 rounded text-xs text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
        >
          {isFullscreen ? "⊡" : "⊞"}
        </button>

        {/* Scroll to bottom */}
        {!pinnedBottom && (
          <button
            type="button"
            onClick={() => {
              setPinnedBottom(true);
              rowVirtualizer.scrollToIndex(renderedLogs.length - 1, { align: "end" });
            }}
            className="p-1 rounded text-xs text-blue-400 hover:text-blue-300 cursor-pointer animate-pulse"
            title="Rolar para o fim"
          >
            ↓
          </button>
        )}
      </div>

      {/* Current activity bar — shows last status message when running */}
      {isRunning && currentStatus && (
        <div className="flex items-center gap-2 px-3 py-1 bg-blue-950/30 border-b border-blue-900/40">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
          <span className="text-[11px] text-blue-300 font-mono truncate">{currentStatus}</span>
        </div>
      )}

      {/* Stream filter + search bar */}
      <div className="flex items-center gap-2 px-2 py-1 bg-zinc-900/80 border-b border-zinc-800 flex-wrap">
        {/* Stream filter tabs */}
        <div className="flex gap-1 shrink-0">
          {STREAM_TABS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStreamFilter(f)}
              className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${
                streamFilter === f
                  ? "bg-zinc-700 text-zinc-200"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {STREAM_LABEL[f]}
              {streamCounts[f] ? ` (${streamCounts[f]})` : ""}
            </button>
          ))}
        </div>

        {showSearch && (
          <>
            <div className="w-px h-4 bg-zinc-700 shrink-0" />
            <button
              type="button"
              onClick={() => setUseRegex((v) => !v)}
              title="Alternar regex"
              className={`px-1.5 py-0.5 text-[9px] rounded border cursor-pointer font-mono shrink-0 ${
                useRegex
                  ? "border-violet-600 text-violet-300 bg-violet-900/30"
                  : "border-zinc-700 text-zinc-500"
              }`}
            >
              .*
            </button>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setMatchIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") setMatchIdx((i) => (i + 1) % Math.max(totalMatches, 1));
                if (e.key === "Escape") {
                  setShowSearch(false);
                  setSearchQuery("");
                }
              }}
              placeholder={useRegex ? "Regex..." : "Buscar nos logs..."}
              className="flex-1 bg-transparent text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none min-w-0"
            />
            {totalMatches > 0 && (
              <span className="text-[10px] text-zinc-500 shrink-0">
                {matchIdx + 1}/{totalMatches}
              </span>
            )}
            {searchQuery && totalMatches === 0 && (
              <span className="text-[10px] text-red-500 shrink-0">nenhum resultado</span>
            )}
            <button
              type="button"
              onClick={() => setMatchIdx((i) => Math.max(i - 1, 0))}
              disabled={totalMatches === 0}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer text-xs shrink-0"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => setMatchIdx((i) => (i + 1) % Math.max(totalMatches, 1))}
              disabled={totalMatches === 0}
              className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer text-xs shrink-0"
            >
              ↓
            </button>
          </>
        )}
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className={`bg-zinc-950 font-mono text-xs overflow-y-auto cursor-text ${
          isFullscreen || fullHeight ? "flex-1" : "max-h-[480px] min-h-[140px]"
        }`}
      >
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            if (virtualRow.index >= renderedLogs.length) {
              // Loading row
              return (
                <div
                  key="loading"
                  style={{ position: "absolute", top: virtualRow.start, width: "100%" }}
                  className="px-3 py-0.5 text-zinc-600 animate-pulse text-[11px]"
                >
                  Carregando logs...
                </div>
              );
            }
            const { log, matchNumber } = renderedLogs[virtualRow.index];
            const isActive = matchNumber === matchIdx && showSearch && !!searchQuery;
            const isReviewHeader = log.stream === "review" && log.content.startsWith("[REVIEW:");
            const isQuestion = log.stream === "stdout" && log.content.includes("[Question]");
            const color = getStreamColor(log.stream, log.content);

            // Highlight search matches in text, or render ANSI
            let inner: React.ReactNode;
            if (showSearch && searchQuery && matchNumber >= 0) {
              const q = searchQuery.toLowerCase();
              const idx = log.content.toLowerCase().indexOf(q);
              if (idx >= 0) {
                inner = (
                  <>
                    {log.content.slice(0, idx)}
                    <mark
                      className={`rounded px-0.5 ${
                        isActive ? "bg-yellow-400 text-black" : "bg-yellow-900 text-yellow-200"
                      }`}
                    >
                      {log.content.slice(idx, idx + q.length)}
                    </mark>
                    {log.content.slice(idx + q.length)}
                  </>
                );
              } else {
                inner = log.content;
              }
            } else {
              // ANSI rendering — content is XML-escaped by ansi-to-html (escapeXML: true)
              const html = convertAnsi(log.content);
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized via ansi-to-html with escapeXML:true
              inner = <span dangerouslySetInnerHTML={{ __html: html }} />;
            }

            return (
              <div
                key={log.id ?? `live-${virtualRow.index}`}
                style={{
                  position: "absolute",
                  top: virtualRow.start,
                  width: "100%",
                  color: color || undefined,
                }}
                className={`px-3 py-px leading-relaxed ${
                  isActive ? "bg-yellow-900/20" : ""
                } ${isQuestion ? "bg-amber-950/30 border-l-2 border-amber-600 pl-2" : ""}`}
              >
                {showTimestamps && (
                  <span className="text-zinc-700 select-none mr-1">
                    {formatTime(log.timestamp)}
                  </span>
                )}
                {log.stream === "stdin" && <span className="text-emerald-500">$ </span>}
                {isReviewHeader && <ReviewBadge content={log.content} />}
                {isQuestion && <span className="text-amber-400 mr-1">?</span>}
                {inner}
              </div>
            );
          })}
        </div>

        {!loadingLogs && allLogs.length === 0 && (
          <div className="text-zinc-700 p-3">Aguardando saída...</div>
        )}
        {isRunning && !awaitingQuestion && renderedLogs.length > 0 && (
          <div className="flex items-center gap-1.5 text-blue-400 px-3 py-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px]">Agente rodando...</span>
          </div>
        )}
      </div>

      {/* Stdin input */}
      {isRunning && onSendInput && (
        <form
          onSubmit={handleSubmit}
          className={`flex border-t bg-zinc-900 transition-all ${
            awaitingQuestion ? "border-amber-700/60 bg-amber-950/20" : "border-zinc-800"
          }`}
        >
          {awaitingQuestion && (
            <div className="w-full px-3 pt-2 pb-0">
              <p className="text-[10px] text-amber-400 font-mono truncate">⚡ {awaitingQuestion}</p>
            </div>
          )}
          <div className={`flex w-full ${awaitingQuestion ? "pt-1" : ""}`}>
            <span
              className={`pl-3 py-2 text-xs font-mono select-none ${awaitingQuestion ? "text-amber-400" : "text-emerald-500"}`}
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
              className={`flex-1 bg-transparent px-2 py-2 text-xs font-mono placeholder:text-zinc-600 focus:outline-none ${
                awaitingQuestion ? "text-amber-100" : "text-zinc-100"
              }`}
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className={`px-3 py-2 text-xs disabled:opacity-30 cursor-pointer transition-colors ${
                awaitingQuestion
                  ? "text-amber-400 hover:text-amber-200"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              Enviar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
