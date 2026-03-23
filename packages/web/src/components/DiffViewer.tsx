import { useCallback, useEffect, useState } from "react";
import type { DiffFileSummary, DiffSummary } from "@vibe-code/shared";
import { api } from "../api/client";

interface DiffViewerProps {
  taskId: string;
  branchName: string | null;
}

export function DiffViewer({ taskId, branchName }: DiffViewerProps) {
  const [summary, setSummary] = useState<DiffSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.tasks.diff(taskId);
      setSummary(data);
    } catch (err: any) {
      setError(err.message ?? "Failed to load diff");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  if (!branchName) {
    return null;
  }

  if (!summary && !loading && !error) {
    return (
      <div>
        <button
          onClick={loadDiff}
          className="text-xs text-violet-400 hover:text-violet-300 underline cursor-pointer"
        >
          View changes (git diff)
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-xs text-zinc-500 py-2">Loading diff...</div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-400 py-2">
        {error}
        <button onClick={loadDiff} className="ml-2 text-zinc-400 hover:text-zinc-300 underline cursor-pointer">
          Retry
        </button>
      </div>
    );
  }

  if (!summary || summary.files.length === 0) {
    return <div className="text-xs text-zinc-600 py-2">No changes</div>;
  }

  return (
    <div className="rounded-lg border border-zinc-800 overflow-hidden">
      {/* Summary header */}
      <div className="bg-zinc-800/50 px-3 py-2 flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          {summary.files.length} file{summary.files.length !== 1 ? "s" : ""} changed
        </span>
        <div className="flex gap-3">
          <span className="text-green-400">+{summary.totalAdditions}</span>
          <span className="text-red-400">-{summary.totalDeletions}</span>
        </div>
      </div>

      {/* File list — each one lazy-loads its diff */}
      <div className="divide-y divide-zinc-800/60 max-h-[500px] overflow-y-auto">
        {summary.files.map((file) => (
          <DiffFileEntry key={file.path} taskId={taskId} file={file} />
        ))}
      </div>
    </div>
  );
}

function DiffFileEntry({ taskId, file }: { taskId: string; file: DiffFileSummary }) {
  const [expanded, setExpanded] = useState(false);
  const [patch, setPatch] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const statusIcon: Record<string, { label: string; color: string }> = {
    added: { label: "A", color: "text-green-400 bg-green-400/10" },
    modified: { label: "M", color: "text-yellow-400 bg-yellow-400/10" },
    deleted: { label: "D", color: "text-red-400 bg-red-400/10" },
    renamed: { label: "R", color: "text-blue-400 bg-blue-400/10" },
  };
  const info = statusIcon[file.status] ?? statusIcon.modified;

  const toggle = async () => {
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
    setExpanded(!expanded);
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-zinc-800/40 transition-colors text-left cursor-pointer"
      >
        <span className="text-zinc-600 text-[10px]">{expanded ? "▼" : "▶"}</span>
        <span className={`w-4 h-4 flex items-center justify-center rounded text-[10px] font-bold ${info.color}`}>
          {info.label}
        </span>
        <span className="text-zinc-300 font-mono truncate flex-1">{file.path}</span>
        <span className="text-green-400 tabular-nums">+{file.additions}</span>
        <span className="text-red-400 tabular-nums">-{file.deletions}</span>
      </button>

      {expanded && (
        <div className="bg-zinc-950 border-t border-zinc-800/40">
          {loading ? (
            <div className="px-3 py-2 text-xs text-zinc-600">Loading...</div>
          ) : patch ? (
            <pre className="px-3 py-2 text-[11px] font-mono overflow-x-auto max-h-[400px] overflow-y-auto leading-relaxed">
              {parsePatchLines(patch)}
            </pre>
          ) : (
            <div className="px-3 py-2 text-xs text-zinc-600">No diff content</div>
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
    let className = "text-zinc-500"; // default for headers/context

    if (line.startsWith("@@")) {
      className = "text-cyan-500/70";
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      className = "text-green-400 bg-green-400/5";
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      className = "text-red-400 bg-red-400/5";
    } else if (!line.startsWith("diff") && !line.startsWith("index") && !line.startsWith("---") && !line.startsWith("+++")) {
      className = "text-zinc-400";
    }

    return (
      <div key={i} className={className}>
        {line || " "}
      </div>
    );
  });
}
