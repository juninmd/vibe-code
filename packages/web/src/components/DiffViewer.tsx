import type { DiffFileSummary, DiffSummary } from "@vibe-code/shared";
import * as Diff2Html from "diff2html";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import "diff2html/bundles/css/diff2html.min.css";
import { useTheme } from "../theme/ThemeProvider";

type Diff2HtmlConfig = NonNullable<Parameters<typeof Diff2Html.html>[1]>;

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
      <div className="flex items-center justify-center h-full text-sm text-dimmed">
        Nenhuma branch criada ainda — execute o agent primeiro
      </div>
    );
  }

  if (loading && !summary) {
    return (
      <div className="flex items-center gap-2 text-xs text-secondary h-full">
        <span className="w-3 h-3 rounded-full border border-strong border-t-violet-400 animate-spin" />
        Carregando diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-danger py-2 flex items-center gap-2">
        <span>Erro: {error}</span>
        <button
          type="button"
          onClick={loadDiff}
          className="text-secondary hover:text-primary underline cursor-pointer"
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
    <div className="flex flex-col h-full rounded-lg border border-default overflow-hidden">
      <div className="bg-surface/50 px-3 py-2 flex items-center gap-3 flex-wrap shrink-0 border-b border-default">
        <span className="text-xs text-secondary">
          {summary.files.length} arquivo{summary.files.length !== 1 ? "s" : ""}
        </span>
        <span className="text-xs text-green-400">+{summary.totalAdditions}</span>
        <span className="text-xs text-danger">-{summary.totalDeletions}</span>

        <div className="flex-1 min-w-[100px]">
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtrar arquivos..."
            className="w-full bg-bg-input border border-strong rounded px-2 py-1 text-[11px] text-secondary placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSplitView((v) => !v)}
            className="text-[11px] text-secondary hover:text-primary cursor-pointer transition-colors px-2 py-1 rounded hover:bg-surface-hover"
          >
            {splitView ? "Linha a linha" : "Lado a lado"}
          </button>
          <button
            type="button"
            onClick={allExpanded ? collapseAll : expandAll}
            className="text-[11px] text-secondary hover:text-primary cursor-pointer transition-colors px-2 py-1 rounded hover:bg-surface-hover"
          >
            {allExpanded ? "Recolher" : "Expandir"}
          </button>
          {loading && (
            <span className="w-3 h-3 rounded-full border border-strong border-t-violet-400 animate-spin" />
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
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

  const statusConfig: Record<string, { label: string; bg: string; text: string }> = {
    added: { label: "A", bg: "bg-success/15", text: "text-success" },
    modified: { label: "M", bg: "bg-warning/15", text: "text-warning" },
    deleted: { label: "D", bg: "bg-danger/15", text: "text-danger" },
    renamed: { label: "R", bg: "bg-info/15", text: "text-info" },
  };
  const status = statusConfig[file.status] ?? statusConfig.modified;
  const colorScheme = (themeName === "light" ? "light" : "dark") as Diff2HtmlConfig["colorScheme"];

  const handleToggle = async () => {
    if (!expanded && patch === null) {
      setLoading(true);
      try {
        const data = await api.tasks.diffFile(taskId, file.path);
        setPatch(data.patch);
      } catch {
        setPatch("Falha ao carregar diff");
      } finally {
        setLoading(false);
      }
    }
    onToggle(file.path);
  };

  return (
    <div className="border-b border-default/50">
      <button
        type="button"
        onClick={handleToggle}
        className="sticky top-0 z-10 bg-surface w-full px-3 py-2 flex items-center gap-2 text-xs hover:bg-surface-hover transition-colors text-left cursor-pointer"
      >
        <span className="text-dimmed text-[10px] w-3 text-center">{expanded ? "▼" : "▶"}</span>
        <span
          className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-bold ${status.bg} ${status.text}`}
        >
          {status.label}
        </span>
        <span className="text-secondary font-mono truncate flex-1">{file.path}</span>
        <span className="text-green-400 tabular-nums">+{file.additions}</span>
        <span className="text-danger tabular-nums">-{file.deletions}</span>
      </button>

      {expanded && (
        <div className="relative">
          {loading ? (
            <div className="px-3 py-2 text-xs text-dimmed">Carregando...</div>
          ) : patch ? (
            <div
              className={`diff2html-wrapper ${themeName}`}
              style={{ maxHeight: "500px", overflow: "auto" }}
            >
              <div
                className="text-[11px]"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: Diff2Html escapes diff content and returns formatted markup.
                dangerouslySetInnerHTML={{
                  __html: Diff2Html.html(patch, {
                    drawFileList: false,
                    outputFormat: splitView ? "side-by-side" : "line-by-line",
                    colorScheme,
                  }),
                }}
              />
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-dimmed">Sem conteúdo de diff</div>
          )}
        </div>
      )}
    </div>
  );
}
