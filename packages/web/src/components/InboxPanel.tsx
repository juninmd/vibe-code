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
    label: "critical",
    icon: "!",
    className: "border-danger/30 bg-danger/10 text-danger shadow-danger/10",
  },
  warning: {
    label: "warning",
    icon: "!",
    className: "border-warning/30 bg-warning/10 text-warning shadow-warning/10",
  },
  success: {
    label: "resolved",
    icon: "✓",
    className: "border-success/30 bg-success/10 text-success shadow-success/10",
  },
  info: {
    label: "info",
    icon: "i",
    className: "border-white/10 bg-white/5 text-primary",
  },
};

function formatRelative(value: string): string {
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  return `${Math.floor(diff / 86_400_000)}d`;
}

function groupLabel(type: InboxItem["type"]): string {
  switch (type) {
    case "task_failed":
      return "Runtime Failures";
    case "task_review":
      return "Pending Reviews";
    case "task_running":
      return "Active Operations";
    case "engine_unavailable":
      return "Engine Issues";
    case "runtime_saturated":
      return "Capacity Alerts";
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

  const loadInbox = useCallback(() => {
    setLoading(true);
    api.inbox
      .list()
      .then(setItems)
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
    <Dialog open={open} onClose={onClose} title="Operations Center" size="2xl">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
            <p className="text-[10px] font-black uppercase tracking-widest text-muted">
              Real-time System Signals
            </p>
          </div>
          <button
            type="button"
            onClick={loadInbox}
            disabled={loading}
            className="p-1.5 rounded-lg text-muted hover:text-primary transition-all cursor-pointer"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className={loading ? "animate-spin" : ""}
              aria-hidden="true"
            >
              <title>Refresh</title>
              <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {items.length === 0 && !loading ? (
          <div className="py-20 text-center space-y-4 rounded-[2rem] bg-white/[0.02] border border-white/5 border-dashed">
            <p className="text-4xl grayscale opacity-40">✦</p>
            <div className="space-y-1">
              <p className="text-sm font-black tracking-tight text-primary">All Systems Green</p>
              <p className="text-[10px] font-black uppercase tracking-widest text-dimmed">
                No pending operational signals
              </p>
            </div>
          </div>
        ) : (
          <div className="max-h-[62vh] overflow-y-auto pr-1 space-y-8 custom-scrollbar">
            {groups.map(([label, groupItems]) => (
              <section
                key={label}
                className="animate-in fade-in slide-in-from-bottom-2 duration-400"
              >
                <div className="mb-3 flex items-center justify-between px-2">
                  <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-accent/80">
                    {label}
                  </h3>
                  <span className="text-[10px] font-black tabular-nums bg-white/5 px-1.5 rounded-md text-muted">
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
                        className="w-full rounded-[1.5rem] border border-white/5 bg-white/[0.03] p-4 text-left transition-all hover:bg-white/[0.07] hover:border-white/10 group active-shrink cursor-pointer"
                      >
                        <div className="flex items-start gap-4">
                          <div
                            className={`mt-0.5 w-8 h-8 shrink-0 flex items-center justify-center rounded-xl border-2 text-xs font-black shadow-lg ${meta.className}`}
                          >
                            {meta.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-black tracking-tight text-primary group-hover:text-accent transition-colors">
                                {item.title}
                              </p>
                              <span className="shrink-0 text-[10px] font-bold text-dimmed">
                                {formatRelative(item.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-[11px] text-secondary leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                              {item.description}
                            </p>
                            {item.repoName && (
                              <div className="mt-3 flex items-center gap-2">
                                <span className="inline-flex rounded-lg bg-white/5 border border-white/5 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-dimmed">
                                  {item.repoName}
                                </span>
                                {item.actionLabel && (
                                  <span className="text-[9px] font-black uppercase tracking-widest text-accent opacity-50 group-hover:opacity-100 transition-all">
                                    {item.actionLabel} ↗
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
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
