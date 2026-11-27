import type { ReactNode } from "react";

/**
 * The pre-migration empty view, copied from the Changes, Sessions, Board and Terminals
 * surfaces on origin/main (`<div class="rw-empty-view">` with an icon, `h3` and `p`).
 */
export default function LegacyEmptyState({
  icon,
  title,
  description,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
}) {
  return (
    <div className="rw-empty-view">
      {icon}
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
