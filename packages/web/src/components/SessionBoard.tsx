import type {
  SessionCard,
  SessionCardStatus,
  SessionSource,
  WsClientMessage,
} from "@vibe-code/shared";
import {
  SESSION_COLUMNS,
  SESSION_SOURCE_LABELS,
  SESSION_SOURCES,
  SESSION_STATUS_META,
  sessionResumeCommand,
} from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { useSessions } from "../hooks/useSessions";
import { useToast } from "../hooks/useToast";
import { ExternalSessionDock } from "./terminals/ExternalSessions";
import { Button } from "./ui/button";
import { getEngineMeta } from "./ui/engine-icons";

function formatRelativeTime(isoString: string): string {
  const time = Date.parse(isoString);
  if (Number.isNaN(time)) return "—";
  const mins = Math.floor((Date.now() - time) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SourceIcon({ source, size = 14 }: { source: SessionSource; size?: number }) {
  const meta = getEngineMeta(source);
  const Icon = meta.icon;
  return <Icon size={size} className={meta.color} />;
}

function Card({
  card,
  onOpen,
  onCopy,
}: {
  card: SessionCard;
  onOpen: (card: SessionCard) => void;
  onCopy: (card: SessionCard) => void;
}) {
  const status = SESSION_STATUS_META[card.status];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpen(card)}
        title={`${sessionResumeCommand(card)}\n(click to open the terminal)`}
        className={`w-full text-left p-3 pr-9 rounded-xl border bg-white/[0.03] hover:bg-white/[0.06] transition-colors ${status.borderColor}`}
      >
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0">
            <SourceIcon source={card.source} />
          </span>
          <span className="flex-1 min-w-0 text-xs font-semibold text-primary leading-snug break-words">
            {card.title}
          </span>
        </div>

        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] text-dimmed">
          <span className="px-1.5 py-px rounded-md bg-surface-hover border border-strong text-secondary">
            {card.project}
          </span>
          {card.branch && (
            <span className="px-1.5 py-px rounded-md bg-surface-hover border border-strong">
              {card.branch}
            </span>
          )}
          <span>{card.messageCount} msg</span>
          <span className="ml-auto">{formatRelativeTime(card.updatedAt)}</span>
        </div>
      </button>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCopy(card);
        }}
        aria-label={`Copiar comando de ${card.title}`}
        title="Copiar comando de retomada"
        className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md text-dimmed transition-colors hover:bg-white/10 hover:text-primary"
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      </button>
    </div>
  );
}

function ColumnView({
  status,
  cards,
  onOpen,
  onCopy,
}: {
  status: SessionCardStatus;
  cards: SessionCard[];
  onOpen: (card: SessionCard) => void;
  onCopy: (card: SessionCard) => void;
}) {
  const meta = SESSION_STATUS_META[status];

  return (
    <div className="flex flex-col min-w-[240px] flex-1 rounded-2xl border border-white/5 bg-black/20">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/5">
        <span className={`text-[10px] font-black uppercase tracking-widest ${meta.textColor}`}>
          {meta.label}
        </span>
        <span className="text-[10px] font-bold text-dimmed">{cards.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {cards.length === 0 ? (
          <p className="text-[10px] text-dimmed px-1 py-2">No sessions</p>
        ) : (
          cards.map((card) => <Card key={card.id} card={card} onOpen={onOpen} onCopy={onCopy} />)
        )}
      </div>
    </div>
  );
}

interface SessionBoardProps {
  open: boolean;
  onClose: () => void;
  /** WebSocket plumbing, so a session's terminal can be driven from here. */
  connected?: boolean;
  onWsSend?: (message: WsClientMessage) => void;
  onNotify?: (message: string, kind: "success" | "error" | "info") => void;
}

/**
 * Kanban view over the sessions of the local coding CLIs. The board is a
 * read-only projection: columns come from each session's own activity, so
 * cards are not draggable — moving one would mean rewriting a CLI's store.
 *
 * Selecting a card opens its terminal across the whole surface (not a side
 * panel): the operator came here to work in the session, not to browse it.
 */
export function SessionBoard({
  open,
  onClose,
  connected = false,
  onWsSend = () => {},
  onNotify = () => {},
}: SessionBoardProps) {
  const { board, loading, error, refresh, countBySource } = useSessions(open);
  const { toast } = useToast();
  const [sourceFilter, setSourceFilter] = useState<SessionSource | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SessionCard | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return board.cards.filter((card) => {
      if (sourceFilter !== "all" && card.source !== sourceFilter) return false;
      if (!needle) return true;
      return (
        card.title.toLowerCase().includes(needle) || card.project.toLowerCase().includes(needle)
      );
    });
  }, [board.cards, sourceFilter, query]);

  const byColumn = useMemo(() => {
    const groups = {} as Record<SessionCardStatus, SessionCard[]>;
    for (const status of SESSION_COLUMNS) groups[status] = [];
    for (const card of filtered) groups[card.status].push(card);
    return groups;
  }, [filtered]);

  const copyResume = (card: SessionCard) => {
    const command = sessionResumeCommand(card);
    navigator.clipboard
      ?.writeText(command)
      .then(() => toast(`Copied: ${command}`, "success"))
      .catch(() => toast(command, "info"));
  };

  if (!open) return null;

  // A selected session takes over the surface: a real, interactive terminal.
  if (selected) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-bg-app">
        <ExternalSessionDock
          card={selected}
          connected={connected}
          onWsSend={onWsSend}
          onClose={() => setSelected(null)}
          onNotify={(message, kind) => {
            onNotify(message, kind);
            toast(message, kind);
          }}
        />
      </div>
    );
  }

  const missing = board.sources.filter((s) => !s.available);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/10 bg-surface px-4 py-3 sm:px-5">
        <h2 className="text-sm font-black tracking-tight text-primary">Sessions</h2>
        <span className="text-[10px] font-bold uppercase tracking-widest text-dimmed">
          {filtered.length} card{filtered.length === 1 ? "" : "s"}
        </span>
        <span className="hidden text-[10px] text-dimmed sm:inline">
          · toque num card para abrir o terminal
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title or project…"
          className="order-last w-full rounded-md border border-strong bg-black/30 px-2.5 py-1.5 text-xs text-primary placeholder:text-dimmed focus:border-accent/50 focus:outline-none sm:order-none sm:ml-4 sm:w-64 sm:py-1"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? "Scanning…" : "Rescan"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/5 bg-surface/60 px-3 py-2 sm:gap-2 sm:px-5">
        <FilterChip
          active={sourceFilter === "all"}
          label="All"
          count={board.cards.length}
          onClick={() => setSourceFilter("all")}
        />
        {SESSION_SOURCES.map((source) => (
          <FilterChip
            key={source}
            active={sourceFilter === source}
            label={SESSION_SOURCE_LABELS[source]}
            count={countBySource[source] ?? 0}
            icon={<SourceIcon source={source} size={12} />}
            onClick={() => setSourceFilter(source)}
          />
        ))}
      </div>

      {error && (
        <p className="px-5 py-2 text-xs text-danger bg-danger/10 border-b border-danger/20">
          {error}
        </p>
      )}

      <div className="flex-1 flex gap-3 p-4 overflow-x-auto">
        {SESSION_COLUMNS.map((status) => (
          <ColumnView
            key={status}
            status={status}
            cards={byColumn[status]}
            onOpen={setSelected}
            onCopy={copyResume}
          />
        ))}
      </div>

      {missing.length > 0 && (
        <p className="px-5 py-2 text-[10px] text-dimmed border-t border-white/5 bg-surface/60">
          No local store found for {missing.map((s) => SESSION_SOURCE_LABELS[s.source]).join(", ")}.
          Point VIBE_OPENCODE_SESSIONS_DIR / VIBE_CLAUDE_SESSIONS_DIR /
          VIBE_ANTIGRAVITY_SESSIONS_DIR at the right directory if the CLI stores sessions elsewhere.
        </p>
      )}
    </div>
  );
}

function FilterChip({
  active,
  label,
  count,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  icon?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest border transition-colors ${
        active
          ? "bg-accent/15 border-accent/40 text-accent-text"
          : "bg-white/[0.02] border-white/5 text-dimmed hover:text-secondary"
      }`}
    >
      {icon}
      {label}
      <span className="opacity-60">{count}</span>
    </button>
  );
}
