import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface TemplatesPanelProps {
  open: boolean;
  onClose: () => void;
}

export function TemplatesPanel({ open, onClose }: TemplatesPanelProps) {
  const [templates, setTemplates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [exportName, setExportName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [confirmImport, setConfirmImport] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.templates.list();
      setTemplates(data);
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleExport = async () => {
    if (!exportName.trim()) return;
    setExporting(true);
    try {
      await api.templates.export(exportName.trim());
      setExportName("");
      await refresh();
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (name: string) => {
    if (!confirmImport || confirmImport !== name) {
      setConfirmImport(name);
      return;
    }
    setImporting(name);
    try {
      await api.templates.import(name);
      setConfirmImport(null);
      await refresh();
    } finally {
      setImporting(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Templates" size="lg">
      <div className="space-y-6 -mx-6 -mb-6">
        <div className="p-5 space-y-5" style={{ borderBottom: "1px solid var(--glass-border)" }}>
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-xl"
              style={{ background: "var(--accent-muted)" }}
            >
              📦
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Workspace Templates
              </h3>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                Exporte e compartilhe suas configurações de skills, regras, agentes e workflows
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Nome do template..."
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              className="h-9 text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleExport()}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={!exportName.trim() || exporting}
              onClick={handleExport}
            >
              {exporting ? "..." : "Exportar"}
            </Button>
          </div>
        </div>

        <div className="px-5 pb-5 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
              Templates Disponíveis
            </h4>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--bg-input)", color: "var(--text-dimmed)" }}
            >
              {templates.length} {templates.length === 1 ? "template" : "templates"}
            </span>
          </div>

          {loading ? (
            <div className="py-8 text-center">
              <p className="text-xs animate-pulse" style={{ color: "var(--text-muted)" }}>
                Carregando...
              </p>
            </div>
          ) : templates.length === 0 ? (
            <div
              className="py-10 text-center rounded-xl border border-dashed"
              style={{ borderColor: "var(--glass-border)" }}
            >
              <p className="text-2xl mb-2">📦</p>
              <p className="text-xs" style={{ color: "var(--text-dimmed)" }}>
                Nenhum template ainda
              </p>
              <p className="text-[10px] mt-1" style={{ color: "var(--text-dimmed)" }}>
                Exporte suas skills para criar um template
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {templates.map((name) => (
                <div
                  key={name}
                  className="p-3.5 rounded-xl border transition-colors group"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--glass-border)",
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 text-lg"
                        style={{ background: "var(--bg-input)" }}
                      >
                        📦
                      </div>
                      <div>
                        <h5
                          className="text-xs font-semibold"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {name}
                        </h5>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "var(--accent-muted)", color: "var(--accent)" }}
                          >
                            skills
                          </span>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}
                          >
                            rules
                          </span>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
                          >
                            agents
                          </span>
                          <span
                            className="text-[9px] px-1.5 py-0.5 rounded"
                            style={{ background: "rgba(16,185,129,0.15)", color: "#10b981" }}
                          >
                            workflows
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {confirmImport === name ? (
                        <>
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => handleImport(name)}
                            disabled={importing === name}
                          >
                            {importing === name ? "..." : "Confirmar"}
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setConfirmImport(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleImport(name)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          Importar
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="px-5 py-3 border-t"
          style={{ background: "var(--bg-input)", borderColor: "var(--glass-border)" }}
        >
          <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-dimmed)" }}>
            Templates são salvos em{" "}
            <code
              className="px-1 py-0.5 rounded text-[9px]"
              style={{ background: "var(--bg-surface)", color: "var(--text-muted)" }}
            >
              ~/.vibe-code/templates/
            </code>
            . Compartilhe os arquivos JSON com outros workspaces.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
