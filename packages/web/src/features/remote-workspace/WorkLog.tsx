import { Spinner } from "../../ui/Spinner";
import { CopyButton } from "./CopyButton";
import { Icon } from "./Icon";
import { summarizeWork, type WorkEntry, type WorkKind } from "./workEntries";

const ICONS: Record<WorkKind, Parameters<typeof Icon>[0]["name"]> = {
  read: "file",
  edit: "code",
  command: "terminal",
  search: "search",
  web: "cloud",
  think: "activity",
  other: "settings",
};

type RowState = "running" | "failed" | "done";

const STATE_LABEL: Record<RowState, string> = {
  running: "em andamento",
  failed: "falhou",
  done: "concluído",
};

/** One tool call: the kind, its target and, when expanded, what came back. */
function WorkRow({ entry, pending }: { entry: WorkEntry; pending: boolean }) {
  const state: RowState = entry.failed ? "failed" : pending ? "running" : "done";
  const expandable = !!(entry.detail || entry.result);
  const head = (
    <>
      <span className="rw-worklog-icon" aria-hidden="true">
        <Icon name={ICONS[entry.kind]} size={12} />
      </span>
      <span className="rw-worklog-label">{entry.label}</span>
      {entry.detail && <code>{entry.detail}</code>}
      <span className="rw-worklog-state">
        {entry.result && <span className="rw-worklog-result">{entry.result}</span>}
        {state === "running" ? (
          <Spinner size={11} />
        ) : (
          <Icon name={state === "failed" ? "close" : "check"} size={11} />
        )}
        <span className="rw-sr-only">{STATE_LABEL[state]}</span>
      </span>
    </>
  );
  if (!expandable)
    return (
      <li className={`rw-worklog-row is-${state}`}>
        <div className="rw-worklog-line">{head}</div>
      </li>
    );
  return (
    <li className={`rw-worklog-row is-${state}`}>
      <details>
        <summary>{head}</summary>
        <div className="rw-worklog-body">
          {entry.detail && (
            <div>
              <span>Entrada</span>
              <code>{entry.detail}</code>
              <CopyButton
                className="rw-worklog-copy"
                text={entry.detail}
                label={entry.kind === "command" ? "Copiar comando" : "Copiar detalhe"}
              />
            </div>
          )}
          {entry.result && (
            <div>
              <span>Resultado</span>
              <p>{entry.result}</p>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export function WorkLog({ entries, live }: { entries: WorkEntry[]; live: boolean }) {
  const failed = entries.some((entry) => entry.failed);
  const title = live ? "Trabalhando" : failed ? "Falhou em parte" : "Trabalhou";
  return (
    <details
      className={`rw-worklog${live ? " is-live" : ""}${failed ? " is-failed" : ""}`}
      open={live || undefined}
    >
      <summary>
        <span className={`rw-worklog-mark ${failed ? "failed" : live ? "live" : ""}`}>
          <Icon name={failed ? "close" : live ? "activity" : "check"} size={12} />
        </span>
        <span className="rw-worklog-title">{title}</span>
        <span className="rw-worklog-count">{summarizeWork(entries)}</span>
        <Icon name="chevron" size={11} />
      </summary>
      <ol>
        {entries.map((entry, index) => (
          <WorkRow
            // biome-ignore lint/suspicious/noArrayIndexKey: entries are append-only within a segment.
            key={index}
            entry={entry}
            pending={live && index === entries.length - 1 && !entry.result}
          />
        ))}
      </ol>
    </details>
  );
}
