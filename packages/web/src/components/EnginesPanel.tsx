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
      className="ml-1 px-1.5 py-0.5 rounded text-[10px] bg-surface-hover hover:bg-border-strong text-secondary cursor-pointer transition-colors shrink-0"
    >
      {copied ? "✓" : "copy"}
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

  const [showInstall, setShowInstall] = useState(false);
  const needsConfig = !!engine.setupIssue && engine.setupIssue !== "Gemini CLI não instalado";
  const unavailableLabel = needsConfig ? "precisa configurar" : "não instalado";

  return (
    <div
      className={`rounded-xl border p-4 transition-all duration-200 ${
        engine.available
          ? `${meta.bgColor} ${meta.borderColor}`
          : "bg-input/50 border-default opacity-70"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            engine.available ? meta.bgColor : "bg-surface/50"
          } border ${engine.available ? meta.borderColor : "border-strong/30"}`}
        >
          <Icon size={20} className={engine.available ? meta.color : "text-dimmed"} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-primary">{engine.displayName}</h3>

            {/* Status indicator */}
            <span
              className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                engine.available
                  ? "bg-success/15 text-success border border-success/30"
                  : needsConfig
                    ? "bg-warning/15 text-warning border border-warning/30"
                    : "bg-surface text-primary0 border border-strong/40"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engine.available
                    ? "bg-emerald-400 animate-pulse"
                    : needsConfig
                      ? "bg-amber-400"
                      : "bg-border-strong"
                }`}
              />
              {engine.available ? "disponível" : unavailableLabel}
            </span>

            {/* Active runs */}
            {engine.activeRuns > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-info/15 text-info border border-info/30 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                {engine.activeRuns} rodando
              </span>
            )}
          </div>

          {/* Provider + version */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-primary0">{meta.provider}</span>
            {engine.version && (
              <>
                <span className="text-dimmed">·</span>
                <code className="text-[10px] text-secondary font-mono">{engine.version}</code>
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
            className="shrink-0 text-[10px] text-primary0 hover:text-secondary transition-colors"
          >
            docs ↗
          </a>
        )}
      </div>

      {/* Description */}
      {meta.description && (
        <p className="text-xs text-primary0 mt-2.5 leading-relaxed">{meta.description}</p>
      )}

      {engine.setupIssue && (
        <div
          className={`mt-3 text-xs rounded-lg px-3 py-2 border ${
            needsConfig
              ? "border-warning/30 bg-warning/15 text-warning"
              : "border-default bg-input/50 text-primary0"
          }`}
        >
          {engine.setupIssue}
          {needsConfig && (
            <span className="flex items-center gap-1 mt-1 text-[11px]">
              Abra{" "}
              {onOpenSettings ? (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="underline text-warning hover:text-warning cursor-pointer"
                >
                  Configurações
                </button>
              ) : (
                "Configurações"
              )}{" "}
              para concluir a configuração.
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
            className="text-xs text-secondary hover:text-primary cursor-pointer transition-colors flex items-center gap-1"
          >
            <span className={`transition-transform ${showInstall ? "rotate-90" : ""}`}>▶</span>
            Como instalar
          </button>
          {showInstall && (
            <div className="mt-2 flex items-center gap-1 bg-input border border-strong rounded px-3 py-2">
              <code className="text-[11px] text-secondary font-mono flex-1 break-all">
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
  onOpenSettings?: () => void;
}

export function EnginesPanel({ onClose, onOpenSettings }: EnginesPanelProps) {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchEngines = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const data = await api.engines.list();
      setEngines(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao buscar engines");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLastRefresh(new Date());
    }
  }, []);

  useEffect(() => {
    fetchEngines();
  }, [fetchEngines]);

  const availableCount = engines.filter((e) => e.available).length;
  const totalActiveRuns = engines.reduce((sum, e) => sum + e.activeRuns, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      <button
        type="button"
        aria-label="Fechar painel de engines"
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative h-full w-full max-w-md glass-panel border-l flex flex-col overflow-hidden shadow-2xl shadow-black/40">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div>
            <h2 className="text-base font-semibold text-primary">Serviços de IA</h2>
            <p className="text-xs text-primary0 mt-0.5">
              {loading ? (
                <span className="animate-pulse">Verificando...</span>
              ) : (
                <>
                  {availableCount}/{engines.length} disponíveis
                  {totalActiveRuns > 0 && (
                    <span className="ml-2 text-info">· {totalActiveRuns} em execução</span>
                  )}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fetchEngines(true)}
              disabled={refreshing || loading}
              title="Atualizar"
              className="p-1.5 rounded-lg text-primary0 hover:text-secondary hover:bg-surface-hover cursor-pointer transition-colors text-sm disabled:opacity-40"
            >
              <span className={refreshing ? "inline-block animate-spin" : ""}>↻</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-primary0 hover:text-secondary hover:bg-surface-hover cursor-pointer transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Engine Cards */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-danger/30 bg-danger/15 text-danger text-xs">
              <span>⚠</span>
              <span className="flex-1 truncate">{error}</span>
              <button
                type="button"
                onClick={() => fetchEngines(true)}
                className="text-danger hover:text-danger cursor-pointer shrink-0"
              >
                Tentar novamente
              </button>
            </div>
          )}
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-24 rounded-xl bg-surface-hover animate-pulse" />
              ))}
            </div>
          ) : engines.length === 0 ? (
            <div className="text-center py-12 text-dimmed text-sm">Nenhum engine registrado</div>
          ) : (
            engines.map((engine) => (
              <EngineCard key={engine.name} engine={engine} onOpenSettings={onOpenSettings} />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-white/[0.06] text-[10px] text-dimmed shrink-0 flex items-center justify-between">
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
