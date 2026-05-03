import type { Repository, RepositoryIssue } from "@vibe-code/shared";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select } from "./ui/select";

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
      for (const label of issue.labels) labels.add(label);
    }
    return Array.from(labels).sort();
  }, [allIssues]);

  const filteredIssues = useMemo(() => {
    let filtered = allIssues;
    if (labelFilter) filtered = filtered.filter((i) => i.labels.includes(labelFilter));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (i) => i.title.toLowerCase().includes(q) || i.number.toString().includes(q)
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

  const handleImportSelected = async () => {
    const selectedIssues = filteredIssues.filter((i) => selected.has(i.id));
    if (selectedIssues.length === 0) return;
    setImporting(true);
    try {
      await onImport(selectedIssues);
      onClose();
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="GitHub Synchronization" size="5xl">
      <div className="space-y-8">
        <div className="p-6 rounded-[2rem] bg-accent/5 border border-accent/20 flex flex-col md:flex-row gap-6 items-end">
          <div className="flex-1 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              <p className="text-[10px] font-black uppercase tracking-widest text-accent">
                Upstream Query
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="relative group">
                <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-muted group-focus-within:text-accent transition-colors">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    aria-hidden="true"
                  >
                    <title>Search icon</title>
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                </div>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search issues by title or #ID..."
                  className="pl-10 h-11 rounded-2xl bg-input/40 border-white/5"
                />
              </div>
              <Select
                value={labelFilter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                  setLabelFilter(e.target.value)
                }
                className="h-11 rounded-2xl bg-input/40 border-white/5 font-bold text-xs"
              >
                <option value="">Filter by Label</option>
                {availableLabels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex rounded-xl overflow-hidden border border-white/10 bg-white/5 p-1 h-11 shrink-0">
            {(["open", "closed", "all"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStateFilter(s)}
                className={`px-4 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${stateFilter === s ? "bg-white text-black shadow-lg" : "text-muted hover:text-primary"}`}
              >
                {s}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={fetchIssues}
            disabled={loading}
            className="h-11 rounded-xl px-6 border-white/10 bg-white/5"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className={loading ? "animate-spin" : ""}
              aria-hidden="true"
            >
              <title>Refresh icon</title>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </Button>
        </div>

        <div className="relative rounded-[2.5rem] border border-white/10 bg-black/20 overflow-hidden">
          {loading ? (
            <div className="py-32 flex flex-col items-center justify-center gap-4 animate-pulse">
              <div className="w-12 h-12 border-4 border-accent/20 border-t-accent rounded-full animate-spin" />
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-muted">
                Syncing with Upstream...
              </p>
            </div>
          ) : error ? (
            <div className="py-20 text-center space-y-4 px-10">
              <div className="w-16 h-16 rounded-[2rem] bg-danger/10 border border-danger/20 flex items-center justify-center text-danger shadow-2xl mx-auto">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  aria-hidden="true"
                >
                  <title>Error icon</title>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="space-y-2">
                <p className="text-lg font-black text-primary">Integration Error</p>
                <p className="text-sm text-muted leading-relaxed max-w-sm mx-auto">{error}</p>
              </div>
              <Button variant="primary" onClick={fetchIssues} className="rounded-xl h-10 px-8">
                Retry Connection
              </Button>
            </div>
          ) : filteredIssues.length === 0 ? (
            <div className="py-32 text-center opacity-30 space-y-4">
              <p className="text-6xl">∅</p>
              <p className="text-xs font-black uppercase tracking-widest">
                No issues found matching criteria
              </p>
            </div>
          ) : (
            <div className="max-h-[45vh] overflow-y-auto divide-y divide-white/5 custom-scrollbar">
              {filteredIssues.map((issue) => {
                const isSelected = selected.has(issue.id);
                return (
                  <div
                    key={issue.id}
                    className={`flex items-start gap-5 p-5 transition-all hover:bg-white/[0.04] group ${isSelected ? "bg-accent/5" : ""}`}
                  >
                    <div className="pt-1">
                      <button
                        type="button"
                        onClick={() => toggleSelect(issue.id)}
                        className={`w-6 h-6 rounded-lg border-2 transition-all flex items-center justify-center active-shrink ${isSelected ? "bg-accent border-accent text-white shadow-lg shadow-accent/25" : "border-white/10 hover:border-white/30"}`}
                      >
                        {isSelected && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="4"
                            aria-hidden="true"
                          >
                            <title>Check icon</title>
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </button>{" "}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <a
                          href={issue.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-black tracking-tight text-primary hover:text-accent transition-colors truncate"
                        >
                          {issue.title}
                        </a>
                        <span className="text-[10px] font-mono text-dimmed shrink-0">
                          #{issue.number}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {issue.state === "open" ? (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase">
                            Open
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-muted text-[9px] font-black uppercase tracking-widest">
                            Closed
                          </span>
                        )}
                        {issue.labels.map((l) => (
                          <span
                            key={l}
                            className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-[9px] font-bold text-secondary"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-all">
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onImport([issue])}
                        disabled={importing}
                        className="h-8 rounded-lg font-black uppercase text-[9px] px-3 bg-white/5 border-white/5"
                      >
                        Quick Deploy
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-6 pt-4">
          <label className="flex items-center gap-4 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={autoMode}
                onChange={(e) => setAutoMode(e.target.checked)}
                className="sr-only"
              />
              <div
                className={`w-12 h-7 rounded-full transition-all active-shrink ${autoMode ? "bg-accent shadow-lg shadow-accent/25" : "bg-white/10"}`}
              >
                <div
                  className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-all shadow-sm ${autoMode ? "left-6" : "left-1"}`}
                />
              </div>
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-black text-primary">Automated Bulk Import</p>
              <p className="text-[10px] text-muted font-medium uppercase tracking-widest">
                Create tasks for all visible items ({filteredIssues.length})
              </p>
            </div>
          </label>

          <div className="flex items-center gap-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
              {selected.size} Modules Selected
            </p>
            <Button
              variant="ghost"
              onClick={onClose}
              className="rounded-xl h-12 px-8 font-black uppercase tracking-widest text-[10px]"
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={autoMode ? () => onImport(filteredIssues) : handleImportSelected}
              disabled={importing || (autoMode ? filteredIssues.length === 0 : selected.size === 0)}
              className="rounded-2xl h-12 px-12 shadow-2xl shadow-accent/30 font-black uppercase tracking-[0.15em] text-[10px] min-w-[220px]"
            >
              {importing
                ? "Engaging context..."
                : autoMode
                  ? `Sync ${filteredIssues.length} Modules`
                  : `Sync ${selected.size} Modules`}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
