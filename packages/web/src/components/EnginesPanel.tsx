import type { EngineInfo } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { getEngineMeta } from "./ui/engine-icons";

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
      className={`p-5 rounded-3xl border transition-all duration-300 ${
        engine.available
          ? "bg-white/[0.03] border-white/10 shadow-lg"
          : "bg-black/20 border-white/5 opacity-60"
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border ${
            engine.available ? "bg-accent/10 border-accent/20" : "bg-white/5 border-white/5"
          }`}
        >
          <Icon size={28} className={engine.available ? meta.color : "text-muted"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-black tracking-tight text-primary">{engine.displayName}</h3>
            <span
              className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${
                engine.available
                  ? "bg-success/10 border-success/20 text-success"
                  : "bg-white/5 border-white/10 text-muted"
              }`}
            >
              {engine.available ? "Online" : "Offline"}
            </span>
            {engine.activeRuns > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-info/10 border border-info/20 text-info text-[9px] font-black uppercase tracking-widest">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                {engine.activeRuns} Active
              </span>
            )}
          </div>
          <p className="text-[10px] font-black uppercase tracking-widest text-dimmed mt-1.5">
            {meta.provider}
          </p>
        </div>
      </div>

      {meta.description && (
        <p className="text-[11px] text-secondary leading-relaxed mt-4 opacity-80">
          {meta.description}
        </p>
      )}

      {engine.setupIssue && (
        <div
          className={`mt-4 p-4 rounded-2xl border text-xs ${
            needsConfig
              ? "bg-warning/5 border-warning/20 text-warning"
              : "bg-white/5 border-white/5 text-muted"
          }`}
        >
          <p className="font-bold mb-1">Configuration Required</p>
          {engine.setupIssue}
          {needsConfig && onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="ml-1 underline decoration-2 underline-offset-4 font-black uppercase tracking-widest text-[9px] hover:text-primary transition-colors cursor-pointer"
            >
              Fix in Settings
            </button>
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
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/60 backdrop-blur-md animate-in fade-in duration-300"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-md glass-panel border-l border-white/10 flex flex-col overflow-hidden shadow-2xl animate-in slide-in-from-right duration-500 ease-out">
        <div className="p-8 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/[0.02]">
          <div>
            <h2 className="text-xl font-black tracking-tight text-primary">Intelligence Hub</h2>
            <div className="flex items-center gap-2 mt-2">
              <div className="h-1 w-6 bg-accent rounded-full" />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-dimmed">
                AI Engine Runtimes
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchEngines(true)}
              className="p-2 rounded-xl text-muted hover:text-primary hover:bg-white/5 transition-all active-shrink cursor-pointer"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                className={refreshing ? "animate-spin" : ""}
                aria-hidden="true"
              >
                <title>Refresh</title>
                <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-muted hover:text-primary hover:bg-white/5 transition-all active-shrink cursor-pointer"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                aria-hidden="true"
              >
                <title>Close</title>
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-black/10">
          {loading
            ? [1, 2, 3].map((i) => (
                <div key={i} className="h-32 rounded-3xl bg-white/5 animate-pulse" />
              ))
            : engines.map((e) => (
                <EngineCard key={e.name} engine={e} onOpenSettings={onOpenSettings} />
              ))}
        </div>

        <div className="p-6 border-t border-white/5 bg-white/[0.02] flex justify-center">
          <p className="text-[9px] font-black uppercase tracking-[0.3em] text-muted opacity-50">
            Secure Agent Infrastructure
          </p>
        </div>
      </div>
    </div>
  );
}
