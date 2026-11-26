import type { SessionCard } from "@vibe-code/shared";
import { SESSION_SOURCE_LABELS } from "@vibe-code/shared";
import { useMemo, useState } from "react";
import { useSessions } from "../../../hooks/useSessions";
import { useTerminals } from "../../../hooks/useTerminals";
import { formatRelativeTime } from "../../../utils/relative-time";
import { Icon } from "../Icon";
import { ErrorNotice } from "../ManagementViews";
import type { Workspace } from "../WorkspaceViews";
import { appSessionCards } from "./appSessions";
import { ExternalTerminal } from "./ExternalTerminal";
import { SurfaceHeading } from "./SurfaceHeading";

/**
 * Every terminal in one place: the app's live harness terminals (with a screen preview)
 * and CLI sessions found on disk that were started outside vibe-code.
 */
export function TerminalsView({
  workspace,
  onOpenTerminal,
}: {
  workspace: Workspace;
  onOpenTerminal: (taskId: string) => void;
}) {
  const live = useTerminals(workspace.server, 3_000);
  // Disk scans are not cheap and change slowly: poll them far less often.
  const { board, error } = useSessions(workspace.server, 30_000);
  const [external, setExternal] = useState<SessionCard | null>(null);
  const outside = useMemo(
    () => board.cards.filter((c) => c.status === "active" || c.status === "idle").slice(0, 40),
    [board.cards]
  );
  const conversations = useMemo(
    () =>
      appSessionCards(workspace.sessions, workspace.projects).filter(
        (c) => !live.sessions.some((t) => t.taskId === c.sessionId)
      ),
    [workspace.sessions, workspace.projects, live.sessions]
  );
  const title = (taskId: string) =>
    workspace.sessions.find((s) => s.id === taskId)?.title ?? "Sessão";

  if (external)
    return <ExternalTerminal key={external.id} card={external} onBack={() => setExternal(null)} />;

  return (
    <div className="rw-overview">
      <SurfaceHeading
        title="Terminais"
        description="Harnesses ativos no servidor e sessões de CLI abertas fora do vibe-code."
        count={live.sessions.length + conversations.length + outside.length}
      />
      <ErrorNotice error={live.error ?? error} />
      {!workspace.server ? (
        <div className="rw-empty-view">
          <Icon name="terminal" size={26} />
          <h3>Disponível com o servidor</h3>
          <p>Os terminais vivem no servidor. Conecte-se em Configurações para vê-los.</p>
        </div>
      ) : (
        <>
          <h2 className="rw-surface-section">Ativos no vibe-code</h2>
          {live.sessions.length === 0 ? (
            <p className="rw-lane-empty">
              Nenhum harness em execução. Abra a aba Terminal de uma sessão para iniciar um.
            </p>
          ) : (
            <div className="rw-terminal-grid">
              {live.sessions.map((session) => (
                <button
                  type="button"
                  key={session.taskId}
                  className="rw-terminal-card"
                  onClick={() => onOpenTerminal(session.taskId)}
                >
                  <span className="rw-terminal-card-head">
                    <span className="rw-status-dot working" />
                    <strong>{title(session.taskId)}</strong>
                    <small>{session.engine}</small>
                  </span>
                  <pre>{session.preview.slice(-8).join("\n") || "Aguardando saída…"}</pre>
                  <small className="rw-terminal-card-cwd">{session.cwd}</small>
                </button>
              ))}
            </div>
          )}
          {conversations.length > 0 && (
            <>
              <h2 className="rw-surface-section">Conversas em andamento</h2>
              <div className="rw-session-table">
                {conversations.map((card) => (
                  <button
                    type="button"
                    key={card.id}
                    onClick={() => onOpenTerminal(card.sessionId)}
                  >
                    <span>
                      <strong>{card.title}</strong>
                      <small>
                        {card.project}
                        {card.branch ? ` · ${card.branch}` : ""} · {card.messageCount} msgs
                      </small>
                    </span>
                    <span className="rw-table-project">{SESSION_SOURCE_LABELS[card.source]}</span>
                    <span className="rw-state">
                      <i
                        className={`rw-status-dot ${card.status === "active" ? "working" : "waiting"}`}
                      />
                      {card.status === "active" ? "Em execução" : "Aguardando você"}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <h2 className="rw-surface-section">Detectados fora do vibe-code</h2>
          {outside.length === 0 ? (
            <p className="rw-lane-empty">
              Nenhuma sessão recente do OpenCode, Claude Code ou Antigravity neste servidor.
            </p>
          ) : (
            <div className="rw-session-table">
              {outside.map((card) => (
                <button type="button" key={card.id} onClick={() => setExternal(card)}>
                  <span>
                    <strong>{card.title}</strong>
                    <small>
                      {card.project}
                      {card.branch ? ` · ${card.branch}` : ""} · {card.messageCount} msgs
                    </small>
                  </span>
                  <span className="rw-table-project">{SESSION_SOURCE_LABELS[card.source]}</span>
                  <span className="rw-state">
                    <i
                      className={`rw-status-dot ${card.status === "active" ? "working" : "waiting"}`}
                    />
                    {formatRelativeTime(card.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
