import type { EngineInfo } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { getEngineMeta } from "./ui/engine-icons";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-zinc-700 hover:bg-zinc-600 text-zinc-300 cursor-pointer transition-colors shrink-0"
    >
      {copied ? "✓" : "copy"}
    </button>
  );
}

function EngineCard({ engine }: { engine: EngineInfo }) {
  const meta = getEngineMeta(engine.name);
  const Icon = meta.icon;

  const [showInstall, setShowInstall] = useState(false);
  const needsConfig = !!engine.setupIssue && engine.setupIssue !== "Gemini CLI não instalado";
  const unavailableLabel = needsConfig ? "precisa configurar" : "não instalado";

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-200 ${
        engine.available
          ? `${meta.bgColor} ${meta.borderColor}`
          : "bg-zinc-900/50 border-zinc-800/60 opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            engine.available ? meta.bgColor : "bg-zinc-800/50"
          } border ${engine.available ? meta.borderColor : "border-zinc-700/30"}`}
        >
          <Icon size={20} className={engine.available ? meta.color : "text-zinc-600"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-zinc-100">{engine.displayName}</h3>

            {/* Status indicator */}
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                engine.available
                  ? "bg-emerald-900/50 text-emerald-300 border border-emerald-700/40"
                  : needsConfig
                    ? "bg-amber-900/40 text-amber-300 border border-amber-700/40"
                    : "bg-zinc-800 text-zinc-500 border border-zinc-700/40"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engine.available
                    ? "bg-emerald-400 animate-pulse"
                    : needsConfig
                      ? "bg-amber-400"
                      : "bg-zinc-600"
                }`}
              />
              {engine.available ? "disponível" : unavailableLabel}
            </span>

            {/* Active runs */}
            {engine.activeRuns > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-900/50 text-blue-300 border border-blue-700/40 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {engine.activeRuns} rodando
              </span>
            )}
          </div>

          {/* Provider + version */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-500">{meta.provider}</span>
            {engine.version && (
              <>
                <span className="text-zinc-700">·</span>
                <code className="text-[10px] text-zinc-400 font-mono">{engine.version}</code>
              </>
            )}
          </div>
        </div>

        {/* Action button */}
        {meta.docsUrl && (
          <a
            href={meta.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            docs ↗
          </a>
        )}
      </div>

      {/* Description */}
      {meta.description && (
        <p className="text-xs text-zinc-500 mt-2.5 leading-relaxed">{meta.description}</p>
      )}

      {engine.setupIssue && (
        <div
          className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
            needsConfig
              ? "border-amber-800/40 bg-amber-950/30 text-amber-300"
              : "border-zinc-800/60 bg-zinc-900/50 text-zinc-500"
          }`}
        >
          {engine.setupIssue}
          {needsConfig && (
            <span className="block mt-1 text-[11px]">
              Abra Configurações para concluir a configuração.
            </span>
          )}
        </div>
      )}

      {/* Not installed: install instructions */}
      {!engine.available && !needsConfig && meta.install && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setShowInstall((v) => !v)}
            className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer transition-colors flex items-center gap-1"
          >
            <span className={`transition-transform ${showInstall ? "rotate-90" : ""}`}>▶</span>
            Como instalar
          </button>
          {showInstall && (
            <div className="mt-2 flex items-center gap-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2">
              <code className="text-[11px] text-zinc-300 font-mono flex-1 break-all">
                {meta.install}
              </code>
              <CopyButton text={meta.install} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface EnginesPanelProps {
  onClose: () => void;
}

export function EnginesPanel({ onClose }: EnginesPanelProps) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchEngines = useCallback(async () => {
    try {
      const data = await api.engines.list();
      setEngines(data);
    } catch (err) {
      console.error("Failed to fetch engines:", err);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchEngines();
    // Note: Removed auto-refresh polling. Use manual refresh button or WebSocket for updates.
    // Auto-polling every 30s was creating unnecessary requests.
  }, [fetchEngines]);

  const availableCount = engines.filter((e) => e.available).length;
  const totalActiveRuns = engines.reduce((sum, e) => sum + e.activeRuns, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative h-full w-full max-w-md glass-panel border-l flex flex-col overflow-hidden shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Serviços de IA</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {loading ? (
                <span className="animate-pulse">Verificando...</span>
              ) : (
                <>
                  {availableCount}/{engines.length} disponíveis
                  {totalActiveRuns > 0 && (
                    <span className="ml-2 text-blue-400">· {totalActiveRuns} em execução</span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchEngines}
              title="Atualizar"
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors text-sm"
            >
              ↻
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Engine Cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-zinc-800/40 animate-pulse" />
              ))}
            </div>
          ) : engines.length === 0 ? (
            <div className="text-center py-12 text-zinc-600 text-sm">Nenhum engine registrado</div>
          ) : (
            engines.map((engine) => <EngineCard key={engine.name} engine={engine} />)
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.06] text-[10px] text-zinc-600 shrink-0 flex items-center justify-between">
          <span>
            Atualizado{" "}
            {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <span>Use o botão ↻ para atualizar</span>
        </div>
      </div>
    </div>
  );
}
