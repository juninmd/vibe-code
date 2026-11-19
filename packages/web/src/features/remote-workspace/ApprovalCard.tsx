import type { ApprovalReply, ToolApproval } from "@vibe-code/shared";
import { diffLines, permissionLabel } from "./approvals";
import { Icon } from "./Icon";

export function ApprovalList({
  approvals,
  answering,
  error,
  onAnswer,
}: {
  approvals: ToolApproval[];
  answering: string | null;
  error: string | null;
  onAnswer: (approval: ToolApproval, reply: ApprovalReply) => void;
}) {
  if (!approvals.length) return null;
  return (
    <section className="rw-approvals" aria-label="Aprovações pendentes">
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          busy={answering === approval.id}
          onAnswer={(reply) => onAnswer(approval, reply)}
        />
      ))}
      {error && (
        <p role="alert" className="rw-approval-error">
          {error}
        </p>
      )}
    </section>
  );
}

function ApprovalCard({
  approval,
  busy,
  onAnswer,
}: {
  approval: ToolApproval;
  busy: boolean;
  onAnswer: (reply: ApprovalReply) => void;
}) {
  const label = permissionLabel(approval.permission);
  const headingId = `rw-approval-${approval.id}`;
  return (
    <article className="rw-approval" aria-labelledby={headingId}>
      <header>
        <span className="rw-approval-icon" aria-hidden="true">
          <Icon name={approval.permission === "bash" ? "terminal" : "file"} size={14} />
        </span>
        <div>
          <h3 id={headingId}>{label}</h3>
          <p>O agente está esperando a sua decisão.</p>
        </div>
      </header>
      {approval.patterns.length > 0 && (
        <ul className="rw-approval-targets">
          {approval.patterns.map((pattern) => (
            <li key={pattern}>
              <code>{pattern}</code>
            </li>
          ))}
        </ul>
      )}
      {approval.diff && (
        <details className="rw-approval-diff" open>
          <summary>Alteração proposta</summary>
          <pre>
            {diffLines(approval.diff).map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: diff lines repeat and never reorder.
              <span key={index} className={`rw-diff-${line.kind}`}>
                {line.text}
                {"\n"}
              </span>
            ))}
          </pre>
        </details>
      )}
      <div className="rw-approval-actions">
        <button
          type="button"
          className="rw-approval-allow"
          disabled={busy}
          onClick={() => onAnswer("once")}
        >
          <Icon name="check" size={13} /> Permitir
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer("always")}>
          Sempre nesta sessão
        </button>
        <button
          type="button"
          className="rw-approval-reject"
          disabled={busy}
          onClick={() => onAnswer("reject")}
        >
          Recusar
        </button>
      </div>
    </article>
  );
}

/** Full access or ask first; only OpenCode sessions can pause for approval. */
export function AccessModeSelect({
  supervised,
  disabled,
  onChange,
}: {
  supervised: boolean;
  disabled?: boolean;
  onChange: (supervised: boolean) => void;
}) {
  return (
    <select
      aria-label="Permissões do agente"
      title="Aplica-se ao próximo turno"
      value={supervised ? "supervised" : "full"}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === "supervised")}
    >
      <option value="full">Acesso total</option>
      <option value="supervised">Pedir aprovação</option>
    </select>
  );
}
