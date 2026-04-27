import type { DiffFileSummary, DiffSummary } from "@vibe-code/shared";
import * as Diff2Html from "diff2html";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import "diff2html/bundles/css/diff2html.min.css";
import { useTheme } from "../theme/ThemeProvider";

interface DiffViewerProps {
  taskId: string;
  branchName: string | null;
}

export function DiffViewer({ taskId, branchName }: DiffViewerProps) {
  const { themeName } = useTheme();
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [splitView, setSplitView] = useState(false);

  const loadDiff = useCallback(async () => {
    if (!branchName) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.tasks.diff(taskId);
      setSummary(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [taskId, branchName]);

  // Auto-load when component mounts or taskId/branchName changes
  useEffect(() => {
    loadDiff();
  }, [loadDiff]);

  const toggleFile = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    if (!summary) return;
    setExpandedPaths(new Set(summary.files.map((f) => f.path)));
  }, [summary]);

  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  if (!branchName) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-dimmed">
        Nenhuma branch criada ainda — execute o agent primeiro
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-xs text-primary0 py-3">
        <span className="w-3 h-3 rounded-full border-2 border-strong border-t-violet-400 animate-spin" />
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-danger py-2 flex items-center gap-2">
        <span>⚠ {error}</span>
        <button
          type="button"
          onClick={loadDiff}
          className="text-secondary hover:text-secondary underline cursor-pointer"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!summary || summary.files.length === 0) {
    return <div className="text-xs text-dimmed py-2">No changes detected</div>;
  }

  const filteredFiles = filter
    ? summary.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : summary.files;

  const allExpanded =
    filteredFiles.length > 0 && filteredFiles.every((f) => expandedPaths.has(f.path));

  return (
    <div className="rounded-lg border border-default overflow-hidden flex flex-col h-full">
      {/* Header: summary + filter + expand/collapse */}
      <div className="bg-surface/50 px-3 py-2 flex items-center gap-2 flex-wrap shrink-0">
        <span className="text-xs text-secondary shrink-0">
          {summary.files.length} file{summary.files.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-green-400 shrink-0">+{summary.totalAdditions}</span>
        <span className="text-xs text-danger shrink-0">-{summary.totalDeletions}</span>

        <div className="flex-1 min-w-[120px]">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by file..."
            className="w-full bg-input border border-strong rounded px-2 py-0.5 text-[11px] text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setSplitView((v) => !v)}
            className="text-[11px] text-primary0 hover:text-secondary cursor-pointer transition-colors px-1.5 py-0.5 rounded hover:bg-surface-hover/50"
            title="Toggle Split View"
          >
            {splitView ? "▤ Vertical" : "▥ Horizontal"}
          </button>
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="text-[11px] text-primary0 hover:text-secondary cursor-pointer transition-colors px-1.5 py-0.5 rounded hover:bg-surface-hover/50"
          >
            {allExpanded ? "⊟ Collapse" : "⊞ Expand"}
          </button>
          {loading && (
            <span className="w-3 h-3 rounded-full border border-strong border-t-violet-400 animate-spin inline-block ml-1" />
          )}
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-zinc-800/60 flex-1 min-h-0 overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="px-3 py-3 text-xs text-dimmed">No files match the filter</div>
        ) : (
          filteredFiles.map((file) => (
            <DiffFileEntry
              key={file.path}
              taskId={taskId}
              file={file}
              expanded={expandedPaths.has(file.path)}
              onToggle={toggleFile}
              splitView={splitView}
              themeName={themeName}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface DiffFileEntryProps {
  taskId: string;
  file: DiffFileSummary;
  expanded: boolean;
  onToggle: (path: string) => void;
  splitView: boolean;
  themeName: string;
}

function DiffFileEntry({
  taskId,
  file,
  expanded,
  onToggle,
  splitView,
  themeName,
}: DiffFileEntryProps) {
  const [patch, setPatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const statusIcon: Record<string, { label: string; color: string }> = {
    added: { label: "A", color: "text-success bg-success/15" },
    modified: { label: "M", color: "text-warning bg-warning/15" },
    deleted: { label: "D", color: "text-danger bg-danger/15" },
    renamed: { label: "R", color: "text-info bg-info/15" },
  };
  const info = statusIcon[file.status] ?? statusIcon.modified;

  const handleToggle = async () => {
    if (!expanded && patch === null) {
      setLoading(true);
      try {
        const data = await api.tasks.diffFile(taskId, file.path);
        setPatch(data.patch);
      } catch {
        setPatch("Failed to load diff");
      } finally {
        setLoading(false);
      }
    }
    onToggle(file.path);
  };

  return (
    <div className="overflow-hidden">
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-surface-hover transition-colors text-left cursor-pointer min-w-0"
      >
        <span className="text-dimmed text-[10px] shrink-0">{expanded ? "▼" : "▶"}</span>
        <span
          className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold shrink-0 ${info.color}`}
        >
          {info.label}
        </span>
        <span className="text-secondary font-mono truncate min-w-0 flex-1">{file.path}</span>
        <span className="text-green-400 tabular-nums shrink-0">+{file.additions}</span>
        <span className="text-danger tabular-nums shrink-0">-{file.deletions}</span>
      </button>

      {expanded && (
        <div className={`bg-app border-t border-default/40 diff-viewer-wrapper ${themeName}`}>
          {loading ? (
            <div className="px-3 py-2 text-xs text-dimmed">Loading...</div>
          ) : patch ? (
            <div
              className="text-[11px] overflow-auto max-h-[400px] w-full"
              // biome-ignore lint: Diff2Html output is trusted HTML from library
              dangerouslySetInnerHTML={{
                __html: Diff2Html.html(patch, {
                  drawFileList: false,
                  outputFormat: splitView ? "side-by-side" : "line-by-line",
                  colorScheme: (themeName === "light" ? "light" : "dark") as any,
                }),
              }}
            />
          ) : (
            <div className="px-3 py-2 text-xs text-dimmed">No diff content</div>
          )}
        </div>
      )}
    </div>
  );
}
