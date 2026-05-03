import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

export function TemplatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
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
    <Dialog open={open} onClose={onClose} title="Workspace Portability" size="lg">
      <div className="space-y-10">
        <div className="p-6 rounded-[2rem] bg-accent/5 border border-accent/20 space-y-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center text-2xl shadow-xl shadow-accent/20 shrink-0">
              📦
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-black tracking-tight text-primary">Snapshot Context</h3>
              <p className="text-[11px] text-muted leading-relaxed font-medium">
                Export and share your intelligence modules: skills, rules, and workflows.
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Input
              placeholder="Archive identifier..."
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              className="h-11 rounded-xl bg-input/40 border-white/5 text-sm font-bold"
              onKeyDown={(e) => e.key === "Enter" && handleExport()}
            />
            <Button
              variant="primary"
              disabled={!exportName.trim() || exporting}
              onClick={handleExport}
              className="h-11 rounded-xl px-8 shadow-xl shadow-accent/25 font-black uppercase tracking-widest text-[10px] min-w-[120px]"
            >
              {exporting ? "Compiling..." : "Export"}
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between px-2">
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent/80">
              Available Snapshots
            </h4>
            <span className="text-[10px] font-black tabular-nums bg-white/5 px-2 py-0.5 rounded-md text-dimmed border border-white/5">
              {templates.length} found
            </span>
          </div>

          {loading ? (
            <div className="py-12 flex justify-center animate-pulse">
              <div className="w-8 h-8 border-4 border-white/5 border-t-accent rounded-full animate-spin" />
            </div>
          ) : templates.length === 0 ? (
            <div className="py-20 text-center rounded-[2rem] border border-white/5 border-dashed opacity-30 space-y-4">
              <p className="text-4xl">∅</p>
              <p className="text-[10px] font-black uppercase tracking-widest">Repository Empty</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {templates.map((name) => (
                <div
                  key={name}
                  className="p-4 rounded-2xl border border-white/5 bg-white/[0.03] transition-all hover:bg-white/[0.07] hover:border-white/10 group"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl shrink-0 group-hover:scale-110 transition-transform">
                        📦
                      </div>
                      <div className="min-w-0">
                        <h5 className="text-sm font-black tracking-tight text-primary truncate">
                          {name}
                        </h5>
                        <div className="flex gap-2 mt-1.5 opacity-60">
                          <div className="w-1 h-1 rounded-full bg-accent" />
                          <div className="w-1 h-1 rounded-full bg-emerald-500" />
                          <div className="w-1 h-1 rounded-full bg-amber-500" />
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
                            className="rounded-lg font-black uppercase text-[9px] h-8 px-4 shadow-lg shadow-accent/20"
                          >
                            {importing === name ? "..." : "Confirm"}
                          </Button>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setConfirmImport(null)}
                            className="h-8"
                          >
                            ✕
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => handleImport(name)}
                          className="h-8 px-4 rounded-lg font-black uppercase text-[9px] opacity-0 group-hover:opacity-100 border-white/5 bg-white/5"
                        >
                          Import
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 text-[9px] font-black uppercase tracking-widest text-dimmed leading-loose">
          <p>
            Local registry path:{" "}
            <code className="bg-white/5 px-2 py-0.5 rounded text-accent">
              ~/.vibe-code/templates/
            </code>
          </p>
          <p className="mt-1 opacity-50">Snapshots can be synced via Git or shared as JSON.</p>
        </div>
      </div>
    </Dialog>
  );
}
