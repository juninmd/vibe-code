import type { Repository, TaskWithRun } from "@vibe-code/shared";
import { formatRelativeTime } from "../../utils/relative-time";
import { sessionLabel } from "./chat";
import { sessionStatusMeta } from "./status";

interface SessionListProps {
  tasks: TaskWithRun[];
  repos: Repository[];
  selectedRepoId: string | null;
  onSelectRepo: (repoId: string | null) => void;
  onOpen: (task: TaskWithRun) => void;
  loading?: boolean;
}

function SessionRow({ task, onOpen }: { task: TaskWithRun; onOpen: (task: TaskWithRun) => void }) {
  const meta = sessionStatusMeta(task.status);
  const repoName = task.repo?.name ?? null;
  const snippet = (task.description ?? "").replace(/\s+/g, " ").trim();

  return (
    <button
      type="button"
      onClick={() => onOpen(task)}
      className="w-full text-left rounded-2xl border border-white/6 bg-surface/50 px-4 py-3.5 transition-colors hover:bg-surface-hover active:bg-surface-hover"
    >
      <div className="flex items-start gap-3">
        <span
          className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${meta.dot} ${meta.pulse ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-primary">
              {sessionLabel(task)}
            </span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${meta.bg} ${meta.text} ${meta.border}`}
            >
              {meta.label}
            </span>
          </div>
          {snippet && (
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-secondary">{snippet}</p>
          )}
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            {repoName && <span className="truncate max-w-[40%]">{repoName}</span>}
            {task.engine && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate max-w-[30%]">{task.engine}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{formatRelativeTime(task.updatedAt)}</span>
            {task.prUrl && <span className="ml-auto shrink-0 text-accent">PR ↗</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

/** Mobile-first session list: pick a repo, then open or start a session. */
export function SessionList({
  tasks,
  repos,
  selectedRepoId,
  onSelectRepo,
  onOpen,
  loading = false,
}: SessionListProps) {
  const visible = tasks.filter((task) => task.status !== "archived");

  return (
    <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
      {repos.length > 1 && (
        <div className="sticky top-0 z-10 -mx-3 mb-3 flex gap-2 overflow-x-auto touch-scroll-x bg-app/95 px-3 py-2 backdrop-blur-xl no-scrollbar">
          <button
            type="button"
            onClick={() => onSelectRepo(null)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
              selectedRepoId === null
                ? "border-accent/40 bg-accent/15 text-accent"
                : "border-default text-secondary hover:text-primary"
            }`}
          >
            All projects
          </button>
          {repos.map((repo) => (
            <button
              key={repo.id}
              type="button"
              onClick={() => onSelectRepo(repo.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedRepoId === repo.id
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-default text-secondary hover:text-primary"
              }`}
            >
              {repo.name}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-3 pt-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[86px] animate-pulse rounded-2xl bg-surface/40" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl border border-white/8 bg-surface/60 text-accent">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <title>Empty</title>
              <path d="M4 17l6-6-6-6M12 19h8" />
            </svg>
          </div>
          <p className="mt-2 text-sm font-semibold text-primary">No sessions yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            Describe a task below and the harness will start a session and name it for you.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5 pt-1">
          {visible.map((task) => (
            <SessionRow key={task.id} task={task} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}
