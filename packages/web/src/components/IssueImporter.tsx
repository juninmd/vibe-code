import type { Repository, RepositoryIssue } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";

interface IssueImporterProps {
  open: boolean;
  onClose: () => void;
  repo: Repository;
  onImport: (issues: RepositoryIssue[]) => Promise<void>;
}

export function IssueImporter({ open, onClose, repo, onImport }: IssueImporterProps) {
  const [allIssues, setAllIssues] = useState<RepositoryIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [labelFilter, setLabelFilter] = useState("");
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open");
  const [importing, setImporting] = useState(false);
  const [autoMode, setAutoMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const issues = await api.repos.issues(repo.id, {
        state: stateFilter,
        limit: 200,
      });
      setAllIssues(issues);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAllIssues([]);
    } finally {
      setLoading(false);
    }
  }, [repo.id, stateFilter]);

  useEffect(() => {
    if (open) {
      fetchIssues();
      setSelected(new Set());
      setLabelFilter("");
      setSearchQuery("");
    }
  }, [open, fetchIssues]);

  const availableLabels = useMemo(() => {
    const labels = new Set<string>();
    for (const issue of allIssues) {
      for (const label of issue.labels) {
        labels.add(label);
      }
    }
    return Array.from(labels).sort();
  }, [allIssues]);

  const issues = useMemo(() => {
    let filtered = allIssues;
    if (labelFilter) {
      filtered = filtered.filter((i) => i.labels.includes(labelFilter));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.body?.toLowerCase().includes(q) ||
          i.number.toString().includes(q)
      );
    }
    return filtered;
  }, [allIssues, labelFilter, searchQuery]);

  const toggleSelect = (issueId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (prev.size === issues.length) return new Set();
      return new Set(issues.map((i) => i.id));
    });
  };

  const handleImportSelected = async () => {
    const selectedIssues = issues.filter((i) => selected.has(i.id));
    if (selectedIssues.length === 0) return;
    setImporting(true);
    try {
      await onImport(selectedIssues);
      onClose();
    } finally {
      setImporting(false);
    }
  };

  const handleImportOne = async (issue: RepositoryIssue) => {
    setImporting(true);
    try {
      await onImport([issue]);
    } finally {
      setImporting(false);
    }
  };

  const handleAutoImport = async () => {
    if (issues.length === 0) return;
    setImporting(true);
    try {
      await onImport(issues);
      onClose();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Importar Issues como Tasks" size="2xl">
      <div className="space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="issue-search" className="block text-xs text-primary0 mb-1">
              Buscar
            </label>
            <Input
              id="issue-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Título, descrição ou número..."
            />
          </div>
          <div className="min-w-[180px]">
            <label htmlFor="issue-label-filter" className="block text-xs text-primary0 mb-1">
              Label
            </label>
            <select
              id="issue-label-filter"
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              className="w-full bg-input border border-strong rounded px-2 py-1.5 text-xs text-secondary focus:outline-none focus:border-zinc-500"
            >
              <option value="">Todos os labels</option>
              {availableLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="block text-xs text-primary0 mb-1">Status</span>
            <div className="flex rounded-md overflow-hidden border border-strong">
              {(["open", "closed", "all"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStateFilter(s)}
                  className="px-3 py-1.5 text-xs cursor-pointer transition-colors"
                  style={{
                    background: stateFilter === s ? "var(--accent-muted)" : "transparent",
                    color: stateFilter === s ? "var(--accent-text)" : "var(--text-muted)",
                  }}
                >
                  {s === "open" ? "Abertas" : s === "closed" ? "Fechadas" : "Todas"}
                </button>
              ))}
            </div>
          </div>
          <Button variant="outline" onClick={fetchIssues} disabled={loading} className="h-9">
            {loading ? "Carregando..." : "Atualizar"}
          </Button>
        </div>

        {/* Available labels quick filter */}
        {availableLabels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[10px] text-dimmed shrink-0">Labels:</span>
            {availableLabels.map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLabelFilter(labelFilter === l ? "" : l)}
                className="text-[10px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors"
                style={{
                  background: labelFilter === l ? "var(--accent-muted)" : "transparent",
                  borderColor: labelFilter === l ? "var(--accent)" : "var(--border-default)",
                  color: labelFilter === l ? "var(--accent-text)" : "var(--text-muted)",
                }}
              >
                {l}
              </button>
            ))}
          </div>
        )}

        {/* Auto mode toggle */}
        <div className="flex items-center gap-2 p-3 rounded-lg border border-default bg-input/30">
          <input
            type="checkbox"
            id="auto-mode"
            checked={autoMode}
            onChange={(e) => setAutoMode(e.target.checked)}
            className="rounded cursor-pointer"
            style={{ accentColor: "var(--accent)" }}
          />
          <label htmlFor="auto-mode" className="text-xs cursor-pointer flex-1">
            <span className="font-medium">Importar todas automaticamente</span>
            <span className="text-primary0 ml-1.5">
              (importa todas as {issues.length} issues encontradas ao clicar em "Importar")
            </span>
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-lg border border-danger/30 bg-danger/15 text-xs text-danger">
            <p className="font-medium">Erro ao carregar issues</p>
            <p className="text-primary0 mt-0.5">{error}</p>
            <p className="text-primary0 mt-1">
              Verifique se o token do provider está configurado em Settings.
            </p>
          </div>
        )}

        {/* Issues list */}
        <div className="max-h-[400px] overflow-y-auto rounded-lg border border-default">
          {loading ? (
            <div className="px-4 py-12 text-center text-xs text-primary0">
              Carregando issues do repositório...
            </div>
          ) : issues.length === 0 ? (
            <div className="px-4 py-12 text-center text-xs text-primary0">
              {allIssues.length === 0
                ? "Nenhuma issue encontrada"
                : labelFilter
                  ? `Nenhuma issue encontrada com label "${labelFilter}"`
                  : "Nenhuma issue corresponde à busca"}
            </div>
          ) : (
            <>
              {/* Header with select all and count */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-default bg-surface/50">
                <input
                  type="checkbox"
                  checked={selected.size === issues.length && issues.length > 0}
                  onChange={toggleSelectAll}
                  className="rounded cursor-pointer"
                  style={{ accentColor: "var(--accent)" }}
                />
                <span className="text-xs text-primary0">
                  {selected.size > 0 ? `${selected.size} selecionadas` : "Selecionar todas"}
                </span>
                <span className="ml-auto text-xs text-dimmed">
                  {issues.length} de {allIssues.length} issues
                </span>
              </div>

              {issues.map((issue) => {
                const isSelected = selected.has(issue.id);
                return (
                  <div
                    key={issue.id}
                    className={`flex items-start gap-3 px-3 py-3 border-b border-default/50 last:border-0 hover:bg-surface-hover/50 transition-colors ${isSelected ? "bg-accent-muted/20" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(issue.id)}
                      className="mt-0.5 rounded cursor-pointer shrink-0"
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-secondary hover:text-primary transition-colors flex-1 truncate"
                        >
                          {issue.title}
                        </a>
                        <div className="flex items-center gap-1 shrink-0">
                          {issue.state === "open" ? (
                            <span className="w-2 h-2 rounded-full bg-emerald-500" title="Aberta" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-zinc-500" title="Fechada" />
                          )}
                          <span className="text-[10px] text-dimmed">#{issue.number}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        {issue.labels.slice(0, 5).map((lbl) => (
                          <Badge
                            key={lbl}
                            variant={lbl === labelFilter ? "purple" : "default"}
                            className="text-[9px] py-0"
                          >
                            {lbl}
                          </Badge>
                        ))}
                        {issue.labels.length > 5 && (
                          <span className="text-[9px] text-dimmed">+{issue.labels.length - 5}</span>
                        )}
                        {issue.assignees.length > 0 && (
                          <span className="text-[10px] text-dimmed ml-1">
                            {issue.assignees.join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleImportOne(issue)}
                      disabled={importing}
                      className="text-[10px] h-6 px-2 shrink-0"
                    >
                      + Task
                    </Button>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-2 border-t border-default">
          <p className="text-xs text-primary0">
            {autoMode
              ? `Ao importar, todas as ${issues.length} issues serão criadas como tasks`
              : `${selected.size} issue${selected.size !== 1 ? "s" : ""} selecionada${selected.size !== 1 ? "s" : ""}`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            {autoMode ? (
              <Button
                variant="primary"
                onClick={handleAutoImport}
                disabled={importing || issues.length === 0}
              >
                {importing ? "Importando..." : `Importar ${issues.length} Issues`}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleImportSelected}
                disabled={importing || selected.size === 0}
              >
                {importing
                  ? "Importando..."
                  : `Criar ${selected.size} Task${selected.size !== 1 ? "s" : ""}`}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
