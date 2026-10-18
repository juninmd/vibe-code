import type {
  ExternalTerminal,
  SessionCard,
  SessionSource,
  WsClientMessage,
} from "@vibe-code/shared";
import {
  SESSION_SOURCE_LABELS,
  SESSION_STATUS_META,
  sessionResumeCommand,
} from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { subscribeTerminal } from "../../hooks/terminalBus";
import { formatRelativeTime } from "../../utils/relative-time";
import { TaskTerminal, type TaskTerminalHandle } from "../TaskTerminal";
import { Button } from "../ui/button";
import { getEngineMeta } from "../ui/engine-icons";

type NotifyKind = "success" | "error" | "info";

function SourceIcon({ source, size = 13 }: { source: SessionSource; size?: number }) {
  const meta = getEngineMeta(source);
  const Icon = meta.icon;
  return <Icon size={size} className={`shrink-0 ${meta.color}`} />;
}

function statusDot(status: SessionCard["status"]): string {
  switch (status) {
    case "active":
      return "bg-cyan-400 animate-pulse";
    case "idle":
      return "bg-amber-400";
    case "failed":
      return "bg-danger";
    default:
      return "bg-success";
  }
}

/** Compact chip for a session that runs outside vibe-code (shown in the Terminals strip). */
function ExternalChip({
  card,
  active,
  onClick,
}: {
  card: SessionCard;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${SESSION_SOURCE_LABELS[card.source]} · ${card.project}\n${sessionResumeCommand(card)}`}
      className={`flex w-56 shrink-0 flex-col rounded-xl border p-2.5 text-left transition-colors ${
        active
          ? "border-accent/40 bg-accent/10"
          : "border-white/8 bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
      }`}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted">
        <SourceIcon source={card.source} size={12} />
        <span className="truncate font-medium text-secondary">{card.project}</span>
        <span className={`ml-auto h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(card.status)}`} />
      </div>
      <span className="mt-1.5 line-clamp-2 text-[11px] font-semibold leading-snug text-primary">
        {card.title}
      </span>
      <span className="mt-1.5 flex items-center gap-1.5 text-[10px] text-dimmed">
        {card.branch && <span className="truncate font-mono">{card.branch}</span>}
        <span className="ml-auto shrink-0 tabular-nums">{card.messageCount} msg</span>
        <span className="shrink-0">{formatRelativeTime(card.updatedAt)}</span>
      </span>
    </button>
  );
}

export function ExternalSessionsStrip({
  cards,
  openId,
  onOpen,
}: {
  cards: SessionCard[];
  openId: string | null;
  onOpen: (card: SessionCard) => void;
}) {
  if (cards.length === 0) return null;
  return (
    <section className="shrink-0 border-t border-white/6 bg-black/25">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-1 pt-2.5">
        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
          Detectados fora do vibe-code
        </h3>
        <span className="rounded-md bg-white/6 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted">
          {cards.length}
        </span>
        <span className="text-[10px] text-dimmed">
          lido dos stores do OpenCode / Claude Code / Antigravity
        </span>
      </div>
      <div className="flex gap-2 overflow-x-auto px-4 pb-3 pt-1">
        {cards.map((card) => (
          <ExternalChip
            key={card.id}
            card={card}
            active={card.id === openId}
            onClick={() => onOpen(card)}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Full-area terminal for a session that lives outside vibe-code. Opening it lands the
 * operator straight in an interactive terminal in the session's own directory: the app
 * cannot attach to a PTY it did not spawn, so it opens a fresh one that resumes the
 * session in its CLI (`opencode --session`, `claude --resume`, `agy --conversation`).
 */
export function ExternalSessionDock({
  card,
  connected,
  onWsSend,
  onClose,
  onNotify,
}: {
  card: SessionCard;
  connected: boolean;
  onWsSend: (message: WsClientMessage) => void;
  onClose: () => void;
  onNotify: (message: string, kind: NotifyKind) => void;
}) {
  const terminalRef = useRef<TaskTerminalHandle>(null);
  const [terminal, setTerminal] = useState<ExternalTerminal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasOutput, setHasOutput] = useState(false);

  const open = useCallback(() => {
    setBusy(true);
    setError(null);
    const size = terminalRef.current?.size();
    api.sessions.terminal
      .start(card.source, card.sessionId, size ?? {})
      .then((next) => setTerminal({ ...next, source: card.source, sessionId: card.sessionId }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        onNotify(message, "error");
      })
      .finally(() => setBusy(false));
  }, [card.source, card.sessionId, onNotify]);

  // Opening a session should land you in its terminal, not on a form: reattach when the
  // app already owns one, otherwise open a terminal that resumes the session. The effect is
  // keyed on the session identity only — `open` changes whenever the parent re-renders (its
  // `onNotify` is an inline arrow), and re-running it would remount the terminal on every
  // poll and silently respawn a CLI the operator had just stopped.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    let cancelled = false;
    setTerminal(null);
    setHasOutput(false);
    setError(null);
    api.sessions.terminal
      .state(card.source, card.sessionId)
      .then((live) => {
        if (cancelled) return;
        if (live) setTerminal(live);
        else openRef.current();
      })
      .catch(() => {
        if (!cancelled) openRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [card.source, card.sessionId]);

  useEffect(
    () =>
      subscribeTerminal(terminal?.id ?? "", (event) => {
        if (event.kind === "closed") setTerminal(null);
      }),
    [terminal?.id]
  );

  const stop = useCallback(() => {
    setBusy(true);
    api.sessions.terminal
      .stop(card.source, card.sessionId)
      .then(() => setTerminal(null))
      .catch(() => {})
      .finally(() => setBusy(false));
  }, [card.source, card.sessionId]);

  const copyResume = useCallback(() => {
    const command = sessionResumeCommand(card);
    navigator.clipboard
      ?.writeText(command)
      .then(() => onNotify(`Copiado: ${command}`, "success"))
      .catch(() => onNotify(command, "info"));
  }, [card, onNotify]);

  const meta = SESSION_STATUS_META[card.status];

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-app">
      <header className="flex items-center gap-2 border-b border-white/10 px-2 py-2 sm:gap-3 sm:px-4 sm:py-2.5">
        <button
          type="button"
          onClick={onClose}
          aria-label="Voltar"
          title="Voltar"
          className="rounded-md p-1.5 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 3L5 8l5 5" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-text-primary">{card.title}</h2>
          <p className="flex items-center gap-2 truncate text-[11px] text-text-dimmed">
            <SourceIcon source={card.source} size={12} />
            <span>{SESSION_SOURCE_LABELS[card.source]}</span>
            <span className="truncate">· {card.project}</span>
            <span className={meta.textColor}>· {meta.label}</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={copyResume}
            aria-label="Copiar comando de retomada"
            title="Copiar comando de retomada"
            className="px-2 sm:px-2.5"
          >
            <svg
              aria-hidden="true"
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="9" y="9" width="11" height="11" rx="2" />
              <path d="M5 15V5a2 2 0 0 1 2-2h10" />
            </svg>
            <span className="hidden sm:inline">Copiar comando</span>
          </Button>
          {terminal ? (
            <Button variant="ghost" size="sm" onClick={stop} disabled={busy}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={open} disabled={busy}>
              {busy ? "Abrindo…" : "Abrir terminal"}
            </Button>
          )}
        </div>
      </header>

      {error && (
        <p className="border-b border-danger/20 bg-danger/10 px-4 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}

      <main className="relative min-h-0 flex-1">
        {terminal ? (
          <TaskTerminal
            ref={terminalRef}
            taskId={terminal.id}
            connected={connected}
            onWsSend={onWsSend}
            onActivity={setHasOutput}
          />
        ) : busy ? (
          <div className="grid h-full place-items-center">
            <p className="text-xs text-text-dimmed">Abrindo terminal…</p>
          </div>
        ) : (
          <div className="grid h-full place-items-center px-4">
            <div className="flex w-full max-w-sm flex-col items-center gap-3 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/5 text-accent">
                <SourceIcon source={card.source} size={22} />
              </div>
              <p className="text-xs leading-relaxed text-text-dimmed">
                Esta sessão foi aberta <strong>fora</strong> do vibe-code. Dá para abrir um terminal
                novo no mesmo diretório e retomar a conversa:
              </p>
              <code className="w-full truncate rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] text-text-secondary">
                {sessionResumeCommand(card)}
              </code>
              <Button variant="primary" size="sm" onClick={open} disabled={busy}>
                {busy ? "Abrindo…" : "Abrir terminal aqui"}
              </Button>
            </div>
          </div>
        )}

        {terminal && !hasOutput && (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[11px] text-dimmed">
            Aguardando a saída do CLI…
          </p>
        )}
      </main>
    </div>
  );
}
