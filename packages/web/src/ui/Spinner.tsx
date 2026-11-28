import { Spinner as SonidoSpinner } from "@juninmd/sonido";

/** Decorative on purpose: the busy state is announced by the surrounding `role="status"`. */
export function Spinner({ size = 13 }: { size?: number }) {
  return <SonidoSpinner size={size} />;
}
