import type { ReactNode } from "react";

interface PropRowProps {
  label: string;
  children: ReactNode;
  /** Default true. Disable for read-only rows (e.g. Created/Updated). */
  interactive?: boolean;
}

/**
 * Two-column property row used in task-card sidebars. Renders a muted label
 * next to a flexible value via CSS subgrid, so labels in the same parent grid
 * share the widest-fits column width. Parent must declare the tracks:
 *
 *   <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
 *     <PropRow label="Status">…</PropRow>
 *     <PropRow label="Assignee">…</PropRow>
 *   </div>
 *
 * Ported from multica packages/views/common/prop-row.tsx. The subgrid
 * approach avoids picking a magic label width — a long label like
 * "Concurrency" lines up with shorter neighbours automatically.
 */
export function PropRow({ label, children, interactive = true }: PropRowProps) {
  return (
    <div
      className={`-mx-2 col-span-2 grid min-h-8 grid-cols-subgrid items-center rounded-md px-2 ${
        interactive ? "transition-colors hover:bg-input/60" : ""
      }`}
    >
      <span className="text-xs text-dimmed">{label}</span>
      <div className="flex min-w-0 items-center gap-1.5 truncate text-xs">{children}</div>
    </div>
  );
}
