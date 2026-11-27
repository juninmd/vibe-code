import { type BadgeProps, Badge as SonidoBadge } from "@juninmd/sonido";
import type { HTMLAttributes, ReactNode } from "react";

/** A count or a category pill; Sonido owns the tone scale and the contrast fix. */
export function Badge({
  children,
  tone = "neutral",
  ...rest
}: { children: ReactNode; tone?: BadgeProps["tone"] } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <SonidoBadge tone={tone} {...rest}>
      {children}
    </SonidoBadge>
  );
}
