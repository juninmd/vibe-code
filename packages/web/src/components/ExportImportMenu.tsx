import type { Task } from "@vibe-code/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";

interface ExportImportMenuProps {
  selectedRepoId: string | null;
  onExport: () => void;
  onImportIssues: () => void;
  onImportSuccess: (message: string) => void;
  onImportError: (message: string) => void;
}

interface BoardExportShape {
  exportedAt: string;
  repo: { id?: string } | null;
  tasks: Partial<Task>[];
}

function isBoardExport(data: unknown): data is BoardExportShape {
  if (typeof data !== "object" || data === null) return false;
  const d = data as Record<string, unknown>;
  return typeof d.exportedAt === "string" && Array.isArray(d.tasks);
}

export function ExportImportMenu({
  selectedRepoId,
  onExport,
  onImportIssues,
  onImportSuccess,
  onImportError,
}: ExportImportMenuProps) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleExport = useCallback(() => {
    setOpen(false);
    onExport();
  }, [onExport]);

  const openFilePicker = useCallback(() => {
    setOpen(false);
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset so same file can be re-selected
      e.target.value = "";

      setImporting(true);
      try {
        const text = await file.text();
        const data: unknown = JSON.parse(text);

        if (!isBoardExport(data)) {
          onImportError("Invalid file format. Please select a vibe-code board export JSON.");
          return;
        }

        const repoId = selectedRepoId ?? data.repo?.id;
        if (!repoId) {
          onImportError("Select a repository before importing a board.");
          return;
        }

        console.info(
          `[import] Starting board import: ${data.tasks.length} tasks from ${file.name}`
        );

        let created = 0;
        for (const t of data.tasks) {
          if (!t.title) continue;
          try {
            await api.tasks.create({
              title: t.title,
              description: t.description ?? "",
              repoId,
              engine: t.engine ?? undefined,
              model: t.model ?? undefined,
              tags: t.tags ?? undefined,
              priority: t.priority ?? undefined,
            });
            created++;
          } catch {
            // skip individual task failures silently
          }
        }

        console.info(
          `[import] Board import complete: ${created}/${data.tasks.length} tasks created`
        );
        onImportSuccess(`${created} task${created !== 1 ? "s" : ""} imported from ${file.name}.`);
      } catch (err) {
        onImportError(err instanceof Error ? err.message : "Failed to parse import file.");
      } finally {
        setImporting(false);
      }
    },
    [selectedRepoId, onImportSuccess, onImportError]
  );

  const handleImportIssues = useCallback(() => {
    setOpen(false);
    onImportIssues();
  }, [onImportIssues]);

  return (
    <div className="relative" ref={menuRef}>
      {/* Hidden file input for JSON import */}
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        onChange={handleFileSelected}
        aria-label="Import board JSON file"
      />

      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={importing}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all active-shrink cursor-pointer border ${
          open
            ? "bg-accent/20 text-accent border-accent/30"
            : "text-secondary hover:text-primary hover:bg-white/5 border-transparent"
        } ${importing ? "opacity-50 cursor-not-allowed" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export / Import"
      >
        {importing ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="animate-spin"
            aria-hidden="true"
          >
            <title>Loading</title>
            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            aria-hidden="true"
          >
            <title>Transfer</title>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        )}
        <span>Transfer</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <title>Open menu</title>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-surface border border-default shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
        >
          <button
            role="menuitem"
            type="button"
            onClick={handleExport}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-secondary hover:text-primary hover:bg-white/5 transition-colors text-left"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <title>Export</title>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Export Board JSON
          </button>

          <div className="h-px bg-white/5 mx-3" />

          <button
            role="menuitem"
            type="button"
            onClick={openFilePicker}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-secondary hover:text-primary hover:bg-white/5 transition-colors text-left"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <title>Import JSON</title>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
            </svg>
            Import Board JSON
          </button>

          <button
            role="menuitem"
            type="button"
            onClick={handleImportIssues}
            className="w-full flex items-center gap-3 px-4 py-3 text-xs font-bold text-secondary hover:text-primary hover:bg-white/5 transition-colors text-left"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              aria-hidden="true"
            >
              <title>Import Issues</title>
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
            Import Issues
          </button>
        </div>
      )}
    </div>
  );
}
