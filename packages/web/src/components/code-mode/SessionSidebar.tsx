import type { TaskWithRun } from "@vibe-code/shared";
import { REMOTE_SESSION_TAG } from "@vibe-code/shared";
import { useState } from "react";
import { sessionLabel } from "./chat";
import { sessionStatusMeta } from "./status";

interface Props {
  tasks: TaskWithRun[];
  selectedId?: string;
  loading: boolean;
  connected: boolean;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onOpen: (task: TaskWithRun) => void;
  onOverview: () => void;
  onManage: () => void;
}
export function SessionSidebar(props: Props) {
  const [query, setQuery] = useState("");
  const tasks = props.tasks
    .filter(
      (t) =>
        t.status !== "archived" &&
        `${sessionLabel(t)} ${t.repo?.name ?? ""} ${t.description}`
          .toLowerCase()
          .includes(query.toLowerCase())
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const today = new Date().toDateString();
  const groups = [
    { label: "Today", tasks: tasks.filter((t) => new Date(t.updatedAt).toDateString() === today) },
    {
      label: "Previous sessions",
      tasks: tasks.filter((t) => new Date(t.updatedAt).toDateString() !== today),
    },
  ];
  return (
    <>
      {props.open && (
        <button
          type="button"
          className="absolute inset-0 z-30 bg-overlay md:hidden"
          aria-label="Close session history"
          onClick={props.onClose}
        />
      )}
      <nav
        aria-label="Sessions"
        className={`${props.open ? "flex absolute inset-y-0 left-0 z-40" : "hidden"} code-session-sidebar md:static md:flex w-64 shrink-0 flex-col border-r border-default bg-surface px-3 py-4`}
      >
        <div className="mb-5 flex items-center gap-2 px-2">
          <span className="font-mono text-base text-accent-text">[ / ]</span>
          <span className="flex-1 text-sm font-semibold">Harness Remote</span>
          <button
            type="button"
            className="code-icon-button md:hidden"
            onClick={props.onClose}
            aria-label="Hide session history"
          >
            ×
          </button>
        </div>
        <button type="button" onClick={props.onNew} className="code-nav-button">
          <span aria-hidden="true">＋</span> New session
        </button>
        <button type="button" onClick={props.onOverview} className="code-nav-button">
          <span aria-hidden="true">▦</span> Session overview
        </button>
        <input
          type="search"
          aria-label="Search sessions"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-4 w-full rounded-md border border-default bg-input px-3 py-2 text-xs outline-none focus-visible:border-accent"
        />
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {props.loading ? (
            <p className="px-2 py-4 text-xs text-muted" role="status">
              Loading sessions…
            </p>
          ) : tasks.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted">
              {query ? "No matching sessions." : "Your sessions will appear here."}
            </p>
          ) : (
            groups
              .filter((g) => g.tasks.length)
              .map((group) => (
                <section key={group.label} className="mb-5">
                  <h2 className="px-2 pb-2 text-[11px] text-muted">{group.label}</h2>
                  {group.tasks.map((task) => {
                    const meta = sessionStatusMeta(task.status);
                    const label =
                      task.tags.includes(REMOTE_SESSION_TAG) && task.status === "backlog"
                        ? "Waiting for message"
                        : meta.label;
                    return (
                      <button
                        type="button"
                        key={task.id}
                        onClick={() => props.onOpen(task)}
                        aria-current={props.selectedId === task.id ? "page" : undefined}
                        className={`code-session-row ${props.selectedId === task.id ? "bg-surface-hover text-primary" : "text-secondary"}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs">{sessionLabel(task)}</span>
                          <span className="mt-1 block truncate text-[10px] text-muted">
                            {task.repo?.name ?? "Repository"}
                          </span>
                        </span>
                        <span
                          role="img"
                          title={label}
                          aria-label={label}
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}
                        />
                      </button>
                    );
                  })}
                </section>
              ))
          )}
        </div>
        <button
          type="button"
          onClick={props.onManage}
          className="code-nav-button border-t border-default pt-4"
        >
          <span aria-hidden="true">⚙</span> Projects & settings
        </button>
        <div className="mt-3 flex items-center gap-2 px-2 text-[10px] text-muted">
          <span
            className={`h-1.5 w-1.5 rounded-full ${props.connected ? "bg-success" : "bg-warning"}`}
          />
          {props.connected ? "Server connected" : "Reconnecting…"}
        </div>
      </nav>
    </>
  );
}
