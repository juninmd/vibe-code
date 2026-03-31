import type { AgentLog } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";

interface AgentOutputProps {
  runId: string | null;
  liveLogs: AgentLog[];
  isRunning: boolean;
  onSendInput?: (input: string) => void;
}

const streamColor = (stream: string) => {
  switch (stream) {
    case "stderr":
      return "text-red-400";
    case "system":
      return "text-zinc-500";
    case "stdin":
      return "text-emerald-400";
    default:
      return "text-zinc-300";
  }
};

export function AgentOutput({ runId, liveLogs, isRunning, onSendInput }: AgentOutputProps) {
  const [historicLogs, setHistoricLogs] = useState<AgentLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [input, setInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [matchIdx, setMatchIdx] = useState(0);
  const [pinnedBottom, setPinnedBottom] = useState(true);

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

  // Auto-scroll when pinned
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally triggers on log append
  useEffect(() => {
    if (pinnedBottom && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [historicLogs, liveLogs, pinnedBottom]);

  // Scroll to highlighted match
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to match when index changes
  useEffect(() => {
    if (!showSearch || !searchQuery) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-match="${matchIdx}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [matchIdx, showSearch, searchQuery]);

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
    const text = allLogs
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] ${l.content}`)
      .join("\n");
    navigator.clipboard.writeText(text).catch(console.error);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !onSendInput) return;
    onSendInput(input);
    setInput("");
    inputRef.current?.focus();
  };

  // Build filtered/highlighted log lines
  const { renderedLogs, totalMatches } = useMemo(() => {
    if (!showSearch || !searchQuery.trim()) {
      return { renderedLogs: allLogs.map((l) => ({ log: l, matchNumber: -1 })), totalMatches: 0 };
    }
    const q = searchQuery.toLowerCase();
    let counter = 0;
    const renderedLogs = allLogs.map((l) => {
      const hit = l.content.toLowerCase().includes(q);
      return { log: l, matchNumber: hit ? counter++ : -1 };
    });
    return { renderedLogs, totalMatches: counter };
  }, [allLogs, showSearch, searchQuery]);

  if (!runId && liveLogs.length === 0) {
    return <div className="text-center text-zinc-600 py-8 text-sm">No agent output yet</div>;
  }

  return (
    <div className="flex flex-col rounded-lg border border-zinc-800 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-zinc-900 border-b border-zinc-800">
        <span className="text-[10px] text-zinc-600 flex-1 font-mono">
          {allLogs.length} lines{isRunning ? " · running" : ""}
        </span>

        {/* Search toggle */}
        <button
          type="button"
          onClick={toggleSearch}
          title="Search logs (Ctrl+F)"
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
          title="Copy all logs"
          className="p-1 rounded text-xs text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
        >
          ⎘
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
            title="Scroll to bottom"
          >
            ↓
          </button>
        )}
      </div>

      {/* Search bar */}
      {showSearch && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900/80 border-b border-zinc-800">
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
            placeholder="Search in logs..."
            className="flex-1 bg-transparent text-xs font-mono text-zinc-300 placeholder:text-zinc-600 focus:outline-none"
          />
          {totalMatches > 0 && (
            <span className="text-[10px] text-zinc-500 shrink-0">
              {matchIdx + 1}/{totalMatches}
            </span>
          )}
          {searchQuery && totalMatches === 0 && (
            <span className="text-[10px] text-red-500 shrink-0">no matches</span>
          )}
          <button
            type="button"
            onClick={() => {
              setMatchIdx((i) => Math.max(i - 1, 0));
            }}
            disabled={totalMatches === 0}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer text-xs"
          >
            ↑
          </button>
          <button
            type="button"
            onClick={() => {
              setMatchIdx((i) => (i + 1) % Math.max(totalMatches, 1));
            }}
            disabled={totalMatches === 0}
            className="text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer text-xs"
          >
            ↓
          </button>
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onClick={() => inputRef.current?.focus()}
        className="bg-zinc-950 p-3 font-mono text-xs overflow-y-auto max-h-[400px] min-h-[120px] space-y-0.5 cursor-text"
      >
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

          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no stable id
              key={log.id ?? `live-${i}`}
              data-match={matchNumber >= 0 ? matchNumber : undefined}
              className={`${streamColor(log.stream)} ${isActive ? "bg-yellow-900/20 rounded" : ""}`}
            >
              <span className="text-zinc-700 select-none">
                {new Date(log.timestamp).toLocaleTimeString()}{" "}
              </span>
              {log.stream === "stdin" && <span className="text-emerald-500">$ </span>}
              {content}
            </div>
          );
        })}

        {loadingLogs && <div className="text-zinc-600 animate-pulse">Loading logs...</div>}
        {!loadingLogs && allLogs.length === 0 && (
          <div className="text-zinc-700">Waiting for output...</div>
        )}
        {isRunning && (
          <div className="flex items-center gap-1 text-blue-400 mt-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            <span>Agent is running...</span>
          </div>
        )}
      </div>

      {/* Stdin input */}
      {isRunning && onSendInput && (
        <form onSubmit={handleSubmit} className="flex border-t border-zinc-800 bg-zinc-900">
          <span className="pl-3 py-2 text-xs font-mono text-emerald-500 select-none">$</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send input to the agent..."
            className="flex-1 bg-transparent px-2 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-30 cursor-pointer"
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
