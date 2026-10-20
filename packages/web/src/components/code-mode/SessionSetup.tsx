import { useQuery } from "@tanstack/react-query";
import type { EngineInfo, Repository } from "@vibe-code/shared";
import { useRef, useState } from "react";
import { api } from "../../api/client";

interface Setup {
  repoId: string;
  engine: string;
  model: string;
  baseBranch: string;
}
export function SessionSetup({
  repos,
  engines,
  value,
  onChange,
}: {
  repos: Repository[];
  engines: EngineInfo[];
  value: Setup;
  onChange: (value: Setup) => void;
}) {
  const [search, setSearch] = useState("");
  const picker = useRef<HTMLDetailsElement>(null);
  const repo = repos.find((r) => r.id === value.repoId);
  // Remote sessions are continued by resuming the CLI conversation; engines
  // without that capability are hidden. `undefined` keeps older payloads usable.
  const resumableEngines = engines.filter((engine) => engine.supportsResume !== false);
  const models = useQuery({
    queryKey: ["remote-models", value.engine],
    queryFn: () => api.engines.models(value.engine),
    enabled: resumableEngines.some((e) => e.name === value.engine && e.available),
    staleTime: 60_000,
    retry: false,
  });
  const branches = useQuery({
    queryKey: ["remote-branches", value.repoId],
    queryFn: () => api.repos.branches(value.repoId),
    enabled: !!value.repoId,
    staleTime: 30_000,
    retry: false,
  });
  const matches = repos.filter((r) =>
    `${r.name} ${r.url}`.toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="code-composer-meta flex-wrap">
      <span className="flex items-center gap-2 text-muted">
        <span aria-hidden="true">☁</span> Server
      </span>
      <details
        ref={picker}
        className="relative min-w-0"
        onKeyDown={(e) => {
          if (e.key === "Escape" && picker.current) {
            picker.current.open = false;
            picker.current.querySelector("summary")?.focus();
          }
        }}
      >
        <summary
          className="code-setup-control max-w-52 cursor-pointer truncate"
          aria-label="Choose repository"
        >
          ▱ {repo?.name ?? "Choose repository"}
        </summary>
        <div className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-[calc(100vw-7rem)] rounded-lg border border-default bg-app p-2 shadow-xl">
          <input
            aria-label="Search repositories"
            placeholder="Search repositories…"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded border border-default bg-input px-2 py-2 text-xs outline-none focus-visible:border-accent"
          />
          <div className="mt-2 max-h-60 overflow-y-auto">
            {matches.map((r) => (
              <button
                type="button"
                key={r.id}
                aria-pressed={value.repoId === r.id}
                className={`block w-full truncate rounded p-2 text-left text-xs hover:bg-surface-hover ${value.repoId === r.id ? "bg-surface-hover text-primary" : "text-secondary"}`}
                onClick={() => {
                  onChange({ ...value, repoId: r.id, baseBranch: "" });
                  if (picker.current) picker.current.open = false;
                }}
              >
                {r.name}
                <span className="mt-1 block truncate text-[10px] text-muted">{r.url}</span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="p-2 text-xs text-muted">No repositories found.</p>
            )}
          </div>
        </div>
      </details>
      <select
        aria-label="Base branch"
        className="code-setup-control max-w-36"
        value={value.baseBranch || repo?.defaultBranch || ""}
        onChange={(e) => onChange({ ...value, baseBranch: e.target.value })}
        disabled={!repo || branches.isLoading}
      >
        <option value={repo?.defaultBranch ?? ""}>{repo?.defaultBranch ?? "Branch"}</option>
        {(branches.data ?? [])
          .filter((b) => b !== repo?.defaultBranch)
          .map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
      </select>
      <select
        aria-label="Agent engine"
        className="code-setup-control max-w-36 sm:ml-auto"
        value={value.engine}
        onChange={(e) => onChange({ ...value, engine: e.target.value, model: "" })}
      >
        {!resumableEngines.some((e) => e.name === "opencode") && (
          <option value="opencode">OpenCode (unavailable)</option>
        )}
        {resumableEngines.map((e) => (
          <option key={e.name} value={e.name} disabled={!e.available || !!e.setupIssue}>
            {e.displayName}
            {e.available ? "" : " (unavailable)"}
          </option>
        ))}
      </select>
      <select
        aria-label="Agent model"
        className="code-setup-control max-w-48"
        value={value.model}
        disabled={models.isLoading}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
      >
        <option value="">{models.isLoading ? "Loading models…" : "Default model"}</option>
        {(models.data ?? []).map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
      {(models.isError || branches.isError) && (
        <p className="w-full text-warning" role="status">
          {models.isError ? "Model list unavailable; server default will be used. " : ""}
          {branches.isError ? "Branch list unavailable; repository default is available." : ""}
        </p>
      )}
    </div>
  );
}
