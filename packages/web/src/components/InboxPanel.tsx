import type { InboxItem } from "@vibe-code/shared";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { Dialog } from "./ui/dialog";

interface InboxPanelProps {
  open: boolean;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenEngines: () => void;
  onOpenRuntimes: () => void;
}

const SEVERITY_META: Record<
  InboxItem["severity"],
  { label: string; icon: string; className: string }
> = {
  critical: {
    label: "critico",
    icon: "!",
    className: "border-red-800/50 bg-red-950/30 text-red-300",
  },
  warning: {
    label: "atencao",
    icon: "△",
    className: "border-amber-800/50 bg-amber-950/30 text-amber-300",
  },
  success: {
    label: "pronto",
    icon: "✓",
    className: "border-emerald-800/50 bg-emerald-950/25 text-emerald-300",
  },
  info: {
    label: "info",
    icon: "•",
    className: "border-blue-800/40 bg-blue-950/20 text-blue-300",
  },
};

function formatRelative(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "agora";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function groupLabel(type: InboxItem["type"]): string {
  switch (type) {
    case "task_failed":
      return "Falhas";
    case "task_review":
      return "Review";
    case "task_running":
      return "Rodando";
    case "engine_unavailable":
      return "Engines";
    case "runtime_saturated":
      return "Runtime";
  }
}

export function InboxPanel({
  open,
  onClose,
  onOpenTask,
  onOpenEngines,
  onOpenRuntimes,
}: InboxPanelProps) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadInbox = useCallback(() => {
    setLoading(true);
    setError(null);
    api.inbox
      .list()
      .then(setItems)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (open) loadInbox();
  }, [open, loadInbox]);

  const groups = useMemo(() => {
    const map = new Map<string, InboxItem[]>();
    for (const item of items) {
      const label = groupLabel(item.type);
      map.set(label, [...(map.get(label) ?? []), item]);
    }
    return Array.from(map.entries());
  }, [items]);

  const handleAction = (item: InboxItem) => {
    if (item.taskId) {
      onOpenTask(item.taskId);
      onClose();
      return;
    }
    if (item.type === "engine_unavailable") {
      onOpenEngines();
      onClose();
      return;
    }
    if (item.type === "runtime_saturated") {
      onOpenRuntimes();
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Inbox" size="2xl">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">
            Sinais operacionais inspirados no Multica: falhas, reviews, execucoes e runtime.
          </p>
          <button
            type="button"
            onClick={loadInbox}
            disabled={loading}
            className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-2">
            <div className="h-16 rounded-xl bg-zinc-900/60 animate-pulse" />
            <div className="h-16 rounded-xl bg-zinc-900/60 animate-pulse" />
            <div className="h-16 rounded-xl bg-zinc-900/60 animate-pulse" />
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 py-12 text-center">
            <p className="text-sm text-zinc-500">Nada precisa de atencao agora.</p>
            <p className="mt-1 text-xs text-zinc-700">Falhas e reviews aparecem aqui.</p>
          </div>
        ) : (
          <div className="max-h-[62vh] overflow-y-auto pr-1 space-y-4">
            {groups.map(([label, groupItems]) => (
              <section key={label}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                    {label}
                  </h3>
                  <span className="text-[10px] text-zinc-700 tabular-nums">
                    {groupItems.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {groupItems.map((item) => {
                    const meta = SEVERITY_META[item.severity];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleAction(item)}
                        className="w-full rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-3 py-3 text-left transition-colors hover:bg-zinc-900/70"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold ${meta.className}`}
                            title={meta.label}
                          >
                            {meta.icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium text-zinc-100">
                                {item.title}
                              </span>
                              <span className="shrink-0 text-[10px] text-zinc-700">
                                {formatRelative(item.createdAt)}
                              </span>
                            </span>
                            <span className="mt-1 block text-xs text-zinc-500">
                              {item.description}
                            </span>
                            {item.repoName && (
                              <span className="mt-1.5 inline-flex rounded border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-600">
                                {item.repoName}
                              </span>
                            )}
                          </span>
                          <span className="mt-1 shrink-0 text-[10px] text-zinc-600">
                            {item.actionLabel}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
