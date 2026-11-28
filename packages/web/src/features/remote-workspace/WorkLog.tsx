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

export function WorkLog({ entries, live }: { entries: WorkEntry[]; live: boolean }) {
  const failed = entries.some((entry) => entry.failed);
  return (
    <details className="rw-worklog" open={live || undefined}>
      <summary>
        <span className={`rw-worklog-mark ${failed ? "failed" : live ? "live" : ""}`}>
          <Icon name={failed ? "close" : live ? "activity" : "check"} size={12} />
        </span>
        {live ? "Trabalhando" : "Trabalhou"}
        <span className="rw-worklog-count">{summarizeWork(entries)}</span>
        <Icon name="chevron" size={11} />
      </summary>
      <ol>
        {entries.map((entry, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are append-only within a segment.
          <li key={index} className={entry.failed ? "failed" : undefined}>
            <Icon name={ICONS[entry.kind]} size={12} />
            <span className="rw-worklog-label">{entry.label}</span>
            {entry.detail && <code title={entry.detail}>{entry.detail}</code>}
            {entry.result && <span className="rw-worklog-result">{entry.result}</span>}
          </li>
        ))}
      </ol>
    </details>
  );
}
