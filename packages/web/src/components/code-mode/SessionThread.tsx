import type { AgentLog, TaskWithRun } from "@vibe-code/shared";
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { buildChatItems, type ChatItem, sessionLabel } from "./chat";
import { sessionStatusMeta } from "./status";

interface SessionThreadProps {
  task: TaskWithRun;
  logs: AgentLog[];
  connected: boolean;
  busy?: boolean;
  onBack: () => void;
  onStop: () => void;
  onStart: () => void;
  onDetails: () => void;
}

function MarkdownBlock({ text }: { text: string }) {
  return (
    <div className="chat-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ChatBubble({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "prompt":
      return (
        <div className="flex justify-end">
          <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-3.5 py-2.5 text-[14px] leading-relaxed text-white shadow-lg shadow-accent/20">
            {item.text}
          </div>
        </div>
      );
    case "assistant":
      return (
        <div className="flex justify-start">
          <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-white/6 bg-surface/55 px-3.5 py-2.5 text-secondary">
            <MarkdownBlock text={item.text} />
          </div>
        </div>
      );
    case "error":
      return (
        <div className="flex justify-start">
          <div className="max-w-[95%] rounded-2xl rounded-bl-md border border-danger/25 bg-danger/10 px-3.5 py-2.5">
            <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-danger">
              {item.text}
            </pre>
          </div>
        </div>
      );
    default:
      return (
        <div className="flex justify-center">
          <span className="rounded-full bg-surface-hover/70 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted">
            {item.text}
          </span>
        </div>
      );
  }
}

/** Conversation view for a single session, streaming the agent transcript. */
export function SessionThread({
  task,
  logs,
  connected,
  busy = false,
  onBack,
  onStop,
  onStart,
  onDetails,
}: SessionThreadProps) {
  const meta = sessionStatusMeta(task.status);
  const running = task.status === "in_progress";
  const items = useMemo(() => buildChatItems(task, logs), [task, logs]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const atBottomRef = useRef(true);

  // Follow the stream while the operator is parked at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-scroll whenever the transcript grows
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !atBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <>
      <header className="shrink-0 border-b border-white/8 bg-app/95 px-2 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to sessions"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-secondary transition-colors hover:bg-white/5 hover:text-primary"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <title>Back</title>
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-primary">{sessionLabel(task)}</div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`}
              />
              <span className={meta.text}>{meta.label}</span>
              {task.repo?.name && <span className="truncate">· {task.repo.name}</span>}
            </div>
          </div>

          {task.prUrl && (
            <a
              href={task.prUrl}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent"
            >
              PR
            </a>
          )}
          <button
            type="button"
            onClick={onDetails}
            aria-label="Session details"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-secondary transition-colors hover:bg-white/5 hover:text-primary"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <title>Details</title>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 11v5M12 8h.01" />
            </svg>
          </button>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              disabled={busy}
              className="shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-2.5 py-1.5 text-[11px] font-medium text-danger disabled:opacity-50"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={onStart}
              disabled={busy || !connected}
              className="shrink-0 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-[11px] font-medium text-accent disabled:opacity-50"
            >
              Start
            </button>
          )}
        </div>
      </header>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="flex-1 overflow-y-auto overscroll-contain px-3 py-4 space-y-3"
      >
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm font-semibold text-primary">Session ready</p>
            <p className="max-w-xs text-xs text-muted">
              Send a message below to start the agent on this session.
            </p>
          </div>
        )}
        {items.map((item) => (
          <ChatBubble key={item.id} item={item} />
        ))}
        {running && (
          <div className="flex items-center gap-2 px-1 pt-1 text-[11px] text-muted">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-info" />
            Harness is working…
          </div>
        )}
      </div>
    </>
  );
}
