import type { DiffFileSummary, DiffSummary } from "@vibe-code/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

interface DiffViewerProps {
  taskId: string;
  branchName: string | null;
}

export function DiffViewer({ taskId, branchName }: DiffViewerProps) {
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

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

  if (!branchName) return null;

  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-xs text-primary0 py-3">
        <span className="w-3 h-3 rounded-full border-2 border-strong border-t-violet-400 animate-spin" />
        Carregando diff...
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
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!summary || summary.files.length === 0) {
    return <div className="text-xs text-dimmed py-2">Nenhuma alteração detectada</div>;
  }

  const filteredFiles = filter
    ? summary.files.filter((f) => f.path.toLowerCase().includes(filter.toLowerCase()))
    : summary.files;

  const allExpanded =
    filteredFiles.length > 0 && filteredFiles.every((f) => expandedPaths.has(f.path));

  return (
    <div className="rounded-lg border border-default overflow-hidden">
      {/* Header: summary + filter + expand/collapse */}
      <div className="bg-surface/50 px-3 py-2 flex items-center gap-2 flex-wrap">
        <span className="text-xs text-secondary shrink-0">
          {summary.files.length} arquivo{summary.files.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-green-400 shrink-0">+{summary.totalAdditions}</span>
        <span className="text-xs text-danger shrink-0">-{summary.totalDeletions}</span>

        <div className="flex-1 min-w-[120px]">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar por arquivo..."
            className="w-full bg-input border border-strong rounded px-2 py-0.5 text-[11px] text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="text-[11px] text-primary0 hover:text-secondary cursor-pointer transition-colors px-1.5 py-0.5 rounded hover:bg-surface-hover/50"
          >
            {allExpanded ? "⊟ Recolher" : "⊞ Expandir"}
          </button>
          {loading && (
            <span className="w-3 h-3 rounded-full border border-strong border-t-violet-400 animate-spin inline-block ml-1" />
          )}
        </div>
      </div>

      {/* File list */}
      <div className="divide-y divide-zinc-800/60 max-h-[500px] overflow-y-auto">
        {filteredFiles.length === 0 ? (
          <div className="px-3 py-3 text-xs text-dimmed">Nenhum arquivo corresponde ao filtro</div>
        ) : (
          filteredFiles.map((file) => (
            <DiffFileEntry
              key={file.path}
              taskId={taskId}
              file={file}
              expanded={expandedPaths.has(file.path)}
              onToggle={toggleFile}
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
}

function DiffFileEntry({ taskId, file, expanded, onToggle }: DiffFileEntryProps) {
  const [patch, setPatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const statusIcon: Record<string, { label: string; color: string }> = {
    added: { label: "A", color: "text-green-400 bg-green-400/10" },
    modified: { label: "M", color: "text-yellow-400 bg-yellow-400/10" },
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
    <div>
      <button
        type="button"
        onClick={handleToggle}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-surface-hover transition-colors text-left cursor-pointer"
      >
        <span className="text-dimmed text-[10px]">{expanded ? "▼" : "▶"}</span>
        <span
          className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${info.color}`}
        >
          {info.label}
        </span>
        <span className="text-secondary font-mono truncate flex-1">{file.path}</span>
        <span className="text-green-400 tabular-nums">+{file.additions}</span>
        <span className="text-danger tabular-nums">-{file.deletions}</span>
      </button>

      {expanded && (
        <div className="bg-app border-t border-default/40">
          {loading ? (
            <div className="px-3 py-2 text-xs text-dimmed">Loading...</div>
          ) : patch ? (
            <pre className="px-3 py-2 text-[11px] font-mono overflow-x-auto max-h-[400px] overflow-y-auto leading-relaxed">
              {parsePatchLines(patch)}
            </pre>
          ) : (
            <div className="px-3 py-2 text-xs text-dimmed">No diff content</div>
          )}
        </div>
      )}
    </div>
  );
}

/** Parse a unified diff patch into colored JSX lines */
function parsePatchLines(patch: string) {
  const lines = patch.split("\n");
  // Skip the header lines (diff --git, index, ---, +++)
  // and only colorize the hunk content
  return lines.map((line, i) => {
    let className = "text-primary0"; // default for headers/context

    if (line.startsWith("@@")) {
      className = "text-info/70";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "text-green-400 bg-green-400/5";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "text-danger bg-danger/15";
    } else if (
      !line.startsWith("diff") &&
      !line.startsWith("index") &&
      !line.startsWith("---") &&
      !line.startsWith("+++")
    ) {
      className = "text-secondary";
    }

    return (
      // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable identity
      <div key={i} className={className}>
        {line || " "}
      </div>
    );
  });
}
