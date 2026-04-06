import type { AgentLog, LogStream } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { formatTime } from "../utils/date";

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

const streamColor = (stream: string, content: string) => {
  if (stream === "review") {
    if (content.startsWith("BLOCKER:")) return "text-red-400 font-semibold";
    if (content.startsWith("WARNING:")) return "text-yellow-400";
    if (content.startsWith("INFO:")) return "text-blue-400";
    if (content.startsWith("LGTM")) return "text-emerald-400";
    if (content.startsWith("[REVIEW:")) return "text-violet-300 font-mono text-[10px]";
    return "text-zinc-400";
  }
  switch (stream) {
    case "stderr":
      return "text-red-400";
    case "system":
      return "text-zinc-500 italic";
    case "stdin":
      return "text-emerald-400";
    default:
      return "text-zinc-200";
  }
};

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

const STREAM_FILTERS: { id: StreamFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "stdout", label: "Saída" },
  { id: "stderr", label: "Erros" },
  { id: "system", label: "Sistema" },
];

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
  const [showSearch, setShowSearch] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [pinnedBottom, setPinnedBottom] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [streamFilter, setStreamFilter] = useState<StreamFilter>("all");

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
  const awaitingQuestion = useMemo(() => {
    if (!isRunning) return null;
    return detectAwaitingInput(allLogs);
  }, [allLogs, isRunning]);

  // Auto-scroll when pinned
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally triggers on log append
  useEffect(() => {
    if (pinnedBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historicLogs, liveLogs, pinnedBottom]);

  // Auto-focus input when agent asks a question
  useEffect(() => {
    if (awaitingQuestion && isRunning) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [awaitingQuestion, isRunning]);

  // Scroll to highlighted match
  useEffect(() => {
    if (!showSearch || !searchQuery) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-match="${matchIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [matchIdx, showSearch, searchQuery]);

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
      const maxVisible = 500;
      const logsToShow = filtered.length > maxVisible ? filtered.slice(-maxVisible) : filtered;
      return {
        renderedLogs: logsToShow.map((l) => ({ log: l, matchNumber: -1 })),
        totalMatches: 0,
      };
    }
    const q = searchQuery.toLowerCase();
    let counter = 0;
    const renderedLogs = filtered.map((l) => {
      const hit = l.content.toLowerCase().includes(q);
      return { log: l, matchNumber: hit ? counter++ : -1 };
    });
    return { renderedLogs, totalMatches: counter };
  }, [allLogs, showSearch, searchQuery, streamFilter]);

  const containerClass = isFullscreen
    ? "fixed inset-4 z-[60] flex flex-col rounded-xl border border-zinc-700 shadow-2xl overflow-hidden bg-zinc-950"
    : "flex flex-col rounded-lg border border-zinc-800 overflow-hidden";

  if (!runId && liveLogs.length === 0) {
    return (
      <div className="text-center text-zinc-600 py-8 text-sm">Nenhuma saída do agente ainda</div>
    );
  }

  const hasToolActivity =
    toolStats.reads + toolStats.writes + toolStats.searches + toolStats.commands > 0;

  return (
    <div className={containerClass}>
      {isFullscreen && <div className="absolute inset-0 bg-zinc-950/95 -z-10 rounded-xl" />}

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

        {/* Copy */}
        <button
          type="button"
          onClick={copyLogs}
          title="Copiar todos os logs"
          className="p-1 rounded text-xs text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
        >
          ⎘
        </button>

        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={() => setIsFullscreen((v) => !v)}
          title={isFullscreen ? "Sair do modo tela cheia" : "Modo tela cheia"}
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
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
      {(showSearch || streamFilter !== "all") && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900/80 border-b border-zinc-800 flex-wrap">
          {/* Stream filter pills */}
          <div className="flex gap-1 shrink-0">
            {STREAM_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStreamFilter(f.id)}
                className={`px-2 py-0.5 text-[10px] rounded-full cursor-pointer transition-colors ${
                  streamFilter === f.id
                    ? "bg-zinc-700 text-zinc-200"
                    : "text-zinc-600 hover:text-zinc-400"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {showSearch && (
            <>
              <div className="w-px h-4 bg-zinc-700 shrink-0" />
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
                placeholder="Buscar nos logs..."
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
      )}

      {/* Stream filter shortcut bar (when not searching) — show only when collapsed */}
      {!showSearch && streamFilter === "all" && (
        <div className="flex items-center gap-1 px-2 py-1 bg-zinc-900/40 border-b border-zinc-800/50">
          {STREAM_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setStreamFilter(f.id)}
              className={`px-2 py-0.5 text-[9px] rounded-full cursor-pointer transition-colors ${
                streamFilter === f.id
                  ? "bg-zinc-700 text-zinc-200"
                  : "text-zinc-700 hover:text-zinc-400"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={() => inputRef.current?.focus()}
        className={`bg-zinc-950 p-3 font-mono text-xs overflow-y-auto cursor-text ${
          isFullscreen || fullHeight ? "flex-1" : "max-h-[480px] min-h-[140px]"
        } space-y-0.5`}
      >
        {allLogs.length > 500 && !showSearch && (
          <div className="text-zinc-600 text-[9px] mb-2 p-1 bg-zinc-900/50 rounded">
            📋 Mostrando últimos 500 de {allLogs.length} logs (
            {((500 / allLogs.length) * 100).toFixed(0)}%)
          </div>
        )}
        {renderedLogs.map(({ log, matchNumber }, i) => {
          const isActive = matchNumber === matchIdx && showSearch && searchQuery;
          const q = searchQuery.toLowerCase();

          let content: React.ReactNode = log.content;
          if (showSearch && searchQuery && matchNumber >= 0) {
            const idx = log.content.toLowerCase().indexOf(q);
            if (idx >= 0) {
              content = (
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
            }
          }

          const isReviewHeader = log.stream === "review" && log.content.startsWith("[REVIEW:");
          const isQuestion = log.stream === "stdout" && log.content.includes("[Question]");

          return (
            <div
              key={log.id ?? `live-${i}`}
              data-match={matchNumber >= 0 ? matchNumber : undefined}
              className={`${streamColor(log.stream, log.content)} ${
                isActive ? "bg-yellow-900/20 rounded" : ""
              } ${isReviewHeader ? "mt-2" : ""} ${
                isQuestion
                  ? "bg-amber-950/30 border-l-2 border-amber-600 pl-2 py-0.5 rounded-r"
                  : ""
              } leading-relaxed`}
            >
              <span className="text-zinc-700 select-none">{formatTime(log.timestamp)} </span>
              {log.stream === "stdin" && <span className="text-emerald-500">$ </span>}
              {isReviewHeader && <ReviewBadge content={log.content} />}
              {isQuestion && <span className="text-amber-400 mr-1">?</span>}
              {content}
            </div>
          );
        })}

        {loadingLogs && <div className="text-zinc-600 animate-pulse">Carregando logs...</div>}
        {!loadingLogs && allLogs.length === 0 && (
          <div className="text-zinc-700">Aguardando saída...</div>
        )}
        {isRunning && !awaitingQuestion && (
          <div className="flex items-center gap-1.5 text-blue-400 mt-1">
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
