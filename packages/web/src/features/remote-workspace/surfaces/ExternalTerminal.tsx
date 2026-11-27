import type { SessionCard } from "@vibe-code/shared";
import { SESSION_SOURCE_LABELS, sessionResumeCommand } from "@vibe-code/shared";
import { useRef, useState } from "react";
import { TaskTerminal, type TaskTerminalHandle } from "../../../components/TaskTerminal";
import { useExternalTerminal } from "../../../hooks/useExternalTerminal";
import { useTerminalSocket } from "../../../hooks/useTerminalSocket";
import { Button } from "../../../ui/Button";
import { Icon } from "../Icon";
import { ErrorNotice } from "../ManagementViews";

/** Terminal that resumes a CLI session started outside vibe-code, in its own directory. */
export function ExternalTerminal({ card, onBack }: { card: SessionCard; onBack: () => void }) {
  const ref = useRef<TaskTerminalHandle>(null);
  const [copied, setCopied] = useState(false);
  const { terminal, busy, error, open, stop } = useExternalTerminal(card, () =>
    ref.current?.size()
  );
  const socket = useTerminalSocket(terminal?.id ?? "");
  const command = sessionResumeCommand(card);
  const copy = () =>
    navigator.clipboard
      ?.writeText(command)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  return (
    <div className="rw-harness-terminal">
      <div className="rw-terminal-heading">
        <button type="button" className="rw-icon-button" aria-label="Voltar" onClick={onBack}>
          <Icon name="back" />
        </button>
        <div>
          <strong>{card.title}</strong>
          <small>
            {SESSION_SOURCE_LABELS[card.source]} · {card.project}
            {card.branch ? ` · ${card.branch}` : ""}
          </small>
        </div>
        <span className={`rw-status-dot ${terminal && socket.connected ? "working" : "waiting"}`} />
        <span>{terminal ? "Terminal conectado" : busy ? "Abrindo…" : "Terminal inativo"}</span>
      </div>
      <ErrorNotice error={error} />
      {terminal ? (
        <>
          <section className="rw-live-terminal" aria-label="Terminal da sessão externa">
            <TaskTerminal
              ref={ref}
              taskId={terminal.id}
              connected={socket.connected}
              onWsSend={(message) => {
                if (socket.connected) socket.send(message);
              }}
            />
          </section>
          <div className="rw-terminal-actions rw-external-actions">
            <span>{terminal.cwd}</span>
            <Button iconStart={<Icon name="copy" size={13} />} onClick={copy}>
              {copied ? "Copiado" : "Copiar comando"}
            </Button>
            <Button disabled={busy} onClick={stop}>
              Parar terminal
            </Button>
          </div>
        </>
      ) : (
        <div className="rw-terminal-start">
          <h2>Sessão aberta fora do vibe-code</h2>
          <p>Um terminal novo no mesmo diretório retoma a conversa com:</p>
          <code className="rw-resume-command">{command}</code>
          <Button
            variant="primary"
            loading={busy}
            iconStart={<Icon name="play" size={13} />}
            onClick={open}
          >
            {busy ? "Abrindo…" : "Abrir terminal aqui"}
          </Button>
        </div>
      )}
    </div>
  );
}
