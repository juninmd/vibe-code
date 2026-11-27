import { type BadgeProps, Badge as SonidoBadge } from "@juninmd/sonido";
import type { HTMLAttributes, ReactNode } from "react";

/** The workspace's 10px count block; Sonido owns the size, the raised surface and the contrast. */
export function Badge({
  children,
  tone = "neutral",
  ...rest
}: { children: ReactNode; tone?: BadgeProps["tone"] } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <SonidoBadge appearance="count" tone={tone} {...rest}>
      {children}
    </SonidoBadge>
  );
}
