import {
  LANE_STATUSES,
  type LaneLabelMap,
  type LaneSettings,
  TASK_STATUS_LABELS,
} from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { ago } from "./lane-utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Settings > Lanes: which issue label each board column stands for. */
export function LanesSettings() {
  const [data, setData] = useState<LaneSettings | null>(null);
  const [draft, setDraft] = useState<Partial<LaneLabelMap>>({});
  const [busy, setBusy] = useState<"toggle" | "save" | "sync" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((next: LaneSettings) => {
    setData(next);
    setDraft(next.overrides);
  }, []);

  useEffect(() => {
    api.lanes
      .get()
      .then(load)
      .catch((err) => setError(errorMessage(err)));
  }, [load]);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<LaneSettings>) => {
    setBusy(kind);
    setError(null);
    try {
      load(await action());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return (
      <p role={error ? "alert" : undefined} className="text-sm text-text-dimmed">
        {error ?? "Loading..."}
      </p>
    );
  }

  const dirty = LANE_STATUSES.some(
    (lane) => (draft[lane] ?? "").trim() !== (data.overrides[lane] ?? "")
  );
  const repos = data.status.repos;

  return (
    <section className="space-y-6" aria-label="Board lanes">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-text-primary">Lanes follow issue labels</h3>
          <p className="max-w-md text-xs leading-relaxed text-text-muted">
            Each column is a label on the linked GitHub or GitLab issue. Move a card and the issue
            is relabelled; relabel the issue and the card moves. Moving cards never starts an agent.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={data.enabled}
          aria-label="Sync lanes with issue labels"
          disabled={busy !== null}
          onClick={() => run("toggle", () => api.lanes.update({ enabled: !data.enabled }))}
          className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
            data.enabled ? "bg-accent" : "bg-white/15"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
              data.enabled ? "left-[1.375rem]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {!data.enabled && (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-text-muted">
          Off: turning it on adds lane labels to the issues your cards are linked to, and creates
          cards for open issues that already carry one.
        </p>
      )}

      <div className="space-y-2">
        <div className="grid grid-cols-[7rem_1fr] items-center gap-x-4 gap-y-2.5">
          {LANE_STATUSES.map((lane) => (
            <div key={lane} className="contents">
              <label htmlFor={`lane-${lane}`} className="text-xs font-medium text-text-secondary">
                {TASK_STATUS_LABELS[lane]}
              </label>
              <div>
                <Input
                  id={`lane-${lane}`}
                  value={draft[lane] ?? ""}
                  placeholder={data.defaults.github[lane]}
                  onChange={(event) => setDraft({ ...draft, [lane]: event.target.value })}
                  className="font-mono text-xs"
                />
                <p className="mt-0.5 text-[10px] text-text-dimmed">
                  GitLab default: {data.defaults.gitlab[lane]}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            variant="primary"
            disabled={!dirty || busy !== null}
            onClick={() => run("save", () => api.lanes.update({ labels: draft }))}
          >
            {busy === "save" ? "Saving..." : "Save labels"}
          </Button>
          {dirty && (
            <button
              type="button"
              onClick={() => setDraft(data.overrides)}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              Discard
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {data.enabled && (
        <div className="space-y-2 border-t border-white/10 pt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-text-muted">
              Last sync: <span className="text-text-secondary">{ago(data.status.lastSyncAt)}</span>
            </p>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null || data.status.running}
              onClick={() => run("sync", () => api.lanes.sync())}
            >
              {busy === "sync" || data.status.running ? "Syncing..." : "Sync now"}
            </Button>
          </div>
          {repos.length > 0 && (
            <ul className="space-y-1">
              {repos.map((repo) => (
                <li
                  key={repo.repoId}
                  className="flex items-center justify-between gap-3 text-xs text-text-secondary"
                >
                  <span className="truncate">{repo.name}</span>
                  {repo.ok ? (
                    <span className="shrink-0 tabular-nums text-text-dimmed">
                      {repo.linked} linked · {repo.pushed} pushed · {repo.pulled} pulled
                      {repo.imported > 0 ? ` · ${repo.imported} imported` : ""}
                    </span>
                  ) : (
                    <span className="shrink-0 truncate text-danger" title={repo.error}>
                      {repo.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
