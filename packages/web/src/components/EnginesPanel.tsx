import type { EngineInfo } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { getEngineMeta } from "./ui/engine-icons";

function InstallCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [command]);

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy install command"
      className="flex w-full items-center gap-2 rounded-lg border border-white/5 bg-black/25 px-2.5 py-1.5 text-left font-mono text-[10px] text-muted transition-colors hover:border-white/10 hover:text-secondary"
    >
      <span className="truncate">{command}</span>
      <span className="ml-auto shrink-0 text-[9px] font-bold uppercase tracking-widest text-accent">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

function EngineCard({
  engine,
  onOpenSettings,
}: {
  engine: EngineInfo;
  onOpenSettings?: () => void;
}) {
  const meta = getEngineMeta(engine.name);
  const Icon = meta.icon;
  const needsConfig = !!engine.setupIssue && engine.setupIssue !== "Gemini CLI não instalado";

  return (
    <div
      className={`flex flex-col rounded-2xl border p-5 transition-all duration-300 ${
        engine.available
          ? "border-white/10 bg-white/[0.03] shadow-lg"
          : "border-white/5 bg-black/20 opacity-70"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${
            engine.available ? `${meta.bgColor} ${meta.borderColor}` : "border-white/5 bg-white/5"
          }`}
        >
          <Icon size={26} className={engine.available ? meta.color : "text-muted"} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold tracking-tight text-primary">{engine.displayName}</h3>
            <span
              className={`rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                engine.available
                  ? "border-success/20 bg-success/10 text-success"
                  : "border-white/10 bg-white/5 text-muted"
              }`}
            >
              {engine.available ? "Online" : "Offline"}
            </span>
            {engine.version && (
              <span className="font-mono text-[10px] text-dimmed">v{engine.version}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-dimmed">
            <span>{meta.provider || engine.name}</span>
            {engine.activeRuns > 0 && (
              <span className="inline-flex items-center gap-1.5 text-info">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
                {engine.activeRuns} active
              </span>
            )}
          </div>
        </div>
      </div>

      {meta.description && (
        <p className="mt-3 text-[11px] leading-relaxed text-secondary">{meta.description}</p>
      )}

      {engine.setupIssue && (
        <div
          className={`mt-4 rounded-xl border p-3 text-xs ${
            needsConfig
              ? "border-warning/20 bg-warning/5 text-warning"
              : "border-white/5 bg-white/5 text-muted"
          }`}
        >
          <p className="mb-1 font-bold">{needsConfig ? "Configuration required" : "Note"}</p>
          {engine.setupIssue}
          {needsConfig && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-1 text-[9px] font-black uppercase tracking-widest underline decoration-2 underline-offset-4 transition-colors hover:text-primary"
            >
              Fix in Settings
            </button>
          )}
        </div>
      )}

      {(meta.install || meta.docsUrl) && (
        <div className="mt-4 space-y-2">
          {meta.install && <InstallCommand command={meta.install} />}
          {meta.docsUrl && (
            <a
              href={meta.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[10px] font-bold uppercase tracking-widest text-accent hover:underline"
            >
              Documentation ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

export function EnginesPanel({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings?: () => void;
}) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchEngines = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await api.engines.list();
      setEngines(data);
    } catch {
      /* the panel keeps the last known list */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  const summary = useMemo(() => {
    const available = engines.filter((e) => e.available).length;
    const active = engines.reduce((sum, e) => sum + (e.activeRuns || 0), 0);
    return { available, total: engines.length, active };
  }, [engines]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-white/10 glass-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/6 px-6 py-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-primary">Engines</h2>
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 w-6 rounded-full bg-accent" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-dimmed">
                AI engine runtimes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchEngines(true)}
              aria-label="Refresh engines"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-primary"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={refreshing ? "animate-spin" : ""}
                aria-hidden="true"
              >
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted transition-colors hover:bg-white/5 hover:text-primary"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 border-b border-white/6 px-6 py-4">
          <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-dimmed">
              Available
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-primary">
              {summary.available}
              <span className="text-sm font-medium text-muted">/{summary.total}</span>
            </div>
          </div>
          <div className="rounded-xl border border-white/6 bg-white/[0.02] px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-dimmed">
              Active runs
            </div>
            <div className="mt-0.5 text-lg font-bold tabular-nums text-info">{summary.active}</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-6 py-5">
          {loading
            ? [0, 1, 2].map((i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/5" />
              ))
            : engines.map((e) => (
                <EngineCard key={e.name} engine={e} onOpenSettings={onOpenSettings} />
              ))}
        </div>

        <div className="flex justify-center border-t border-white/6 px-6 py-4">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-muted opacity-50">
            Secure agent infrastructure
          </p>
        </div>
      </div>
    </div>
  );
}
