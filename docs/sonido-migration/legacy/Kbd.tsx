import type { ReactNode } from "react";

/** The pre-migration keycap: a bare `<kbd>` styled by the browser. */
export default function LegacyKbd({ children }: { children: ReactNode }) {
  return <kbd>{children}</kbd>;
}
