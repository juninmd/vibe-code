import { Kbd as SonidoKbd } from "@juninmd/sonido";
import type { ReactNode } from "react";

/** One keyboard key, with the design system's keycap. */
export function Kbd({ children }: { children: ReactNode }) {
  return <SonidoKbd>{children}</SonidoKbd>;
}
