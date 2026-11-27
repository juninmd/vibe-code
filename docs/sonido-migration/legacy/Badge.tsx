import type { ReactNode } from "react";

/**
 * The pre-migration count pill: a `<span class="rw-count">`, the markup used in headings,
 * group labels and board lanes before the swap.
 */
export default function LegacyBadge({ children }: { children: ReactNode }) {
  return <span className="rw-count">{children}</span>;
}
