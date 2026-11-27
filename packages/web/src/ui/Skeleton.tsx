import { Skeleton as SonidoSkeleton } from "@juninmd/sonido";

/**
 * Placeholder while a slow source answers. The shimmer and the live-region announcement are
 * Sonido's; the app only says what is loading.
 */
export function Skeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return <SonidoSkeleton label={label} rows={rows} />;
}
