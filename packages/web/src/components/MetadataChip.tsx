import type { ReactNode } from "react";

interface MetadataChipProps {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  tone?: "default" | "info" | "warning" | "success" | "danger";
}

const TONE: Record<NonNullable<MetadataChipProps["tone"]>, string> = {
  default: "bg-muted/40 text-dimmed border-default",
  info: "bg-info/10 text-info border-info/30",
  warning: "bg-warning-muted/15 text-warning-muted border-warning-muted/30",
  success: "bg-success/10 text-success border-success/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
};

/**
 * Compact metadata pill — icon + short text — used in the AgentOutput
 * toolbar to surface runtime/duration/event counts in a consistent visual.
 * Ported from multica packages/views/common/task-transcript/agent-transcript-dialog.tsx
 * (`MetadataChip` helper).
 */
export function MetadataChip({ icon, children, title, tone = "default" }: MetadataChipProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono ${TONE[tone]}`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <span className="truncate">{children}</span>
    </span>
  );
}
