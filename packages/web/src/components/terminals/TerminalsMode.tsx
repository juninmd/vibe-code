import type {
  EngineInfo,
  SessionCard,
  Task,
  TaskWithRun,
  WsClientMessage,
} from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { useSessions } from "../../hooks/useSessions";
import { useTerminals } from "../../hooks/useTerminals";
import { SessionGrid } from "../code-mode/SessionGrid";
import { ExternalSessionDock, ExternalSessionsStrip } from "./ExternalSessions";
import { TerminalDock } from "./TerminalDock";

export interface TerminalsModeProps {
  tasks: TaskWithRun[];
  engines: EngineInfo[];
  loading: boolean;
  connected: boolean;
  selectedTask: TaskWithRun | null;
  onOpenSession: (task: TaskWithRun) => void;
  onCloseSession: () => void;
  onWsSend: (message: WsClientMessage) => void;
  onStop: (taskId: string) => Promise<void> | void;
  onFinished: (task: Task) => void;
  onDetails: (task: TaskWithRun) => void;
  onNotify: (message: string, kind: "success" | "error" | "info") => void;
}

/**
 * Terminals — one place for every worktree, inside and outside vibe-code.
 *
 * Two sources are merged here:
 * - the app's own agent terminals (the "Live now" grid, with live state + screen preview);
 * - CLI sessions detected on disk (OpenCode, Claude Code, Antigravity) that were started
 *   outside the app — shown in the strip below and openable as a resuming terminal.
 */
export function TerminalsMode({
  tasks,
  engines,
  loading,
  connected,
  selectedTask,
  onOpenSession,
  onCloseSession,
  onWsSend,
  onStop,
  onFinished,
  onDetails,
  onNotify,
}: TerminalsModeProps) {
  const { sessions } = useTerminals(true, 3_000);
  // External stores are read from disk and are not cheap to scan; they also change
  // slowly, so they are polled far less often than the app's own live terminals.
  const { board } = useSessions(true, 30_000);
  const [selectedExternal, setSelectedExternal] = useState<SessionCard | null>(null);

  const liveTaskIds = useMemo(() => new Set(sessions.map((session) => session.taskId)), [sessions]);
  const previews = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const session of sessions) map[session.taskId] = session.preview;
    return map;
  }, [sessions]);

  // "Open outside the app" ≈ touched recently; sessions idle for over a day are closed.
  const external = useMemo(
    () =>
      board.cards.filter((card) => card.status === "active" || card.status === "idle").slice(0, 40),
    [board.cards]
  );

  const dockOpen = Boolean(selectedTask || selectedExternal);

  // A selected session takes the whole screen (it covers the app chrome too): on a phone
  // every pixel of terminal counts, and on desktop the dock header is the way back.
  if (dockOpen) {
    return (
      <div className="fixed inset-0 z-40 flex min-h-0 flex-col bg-bg-app">
        {selectedExternal ? (
          <ExternalSessionDock
            card={selectedExternal}
            connected={connected}
            onWsSend={onWsSend}
            onClose={() => setSelectedExternal(null)}
            onNotify={onNotify}
          />
        ) : selectedTask ? (
          <TerminalDock
            task={selectedTask}
            engines={engines}
            connected={connected}
            onWsSend={onWsSend}
            onClose={onCloseSession}
            onFinished={onFinished}
            onOpenDetails={() => onDetails(selectedTask)}
            onNotify={onNotify}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <SessionGrid
          tasks={tasks}
          loading={loading}
          connected={connected}
          liveTaskIds={liveTaskIds}
          previews={previews}
          onOpen={(task) => {
            setSelectedExternal(null);
            onOpenSession(task);
          }}
          onStop={onStop}
        />
      </div>
      <ExternalSessionsStrip
        cards={external}
        openId={selectedExternal?.id ?? null}
        onOpen={(card) => {
          onCloseSession();
          setSelectedExternal(card);
        }}
      />
    </div>
  );
}
