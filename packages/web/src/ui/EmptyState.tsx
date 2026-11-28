import { EmptyState as SonidoEmptyState } from "@juninmd/sonido";
import type { ReactNode } from "react";

/**
 * A list with nothing in it says so with an icon, one line and an optional way out.
 * Sonido owns the mark, the dashed surface and the spacing; pages keep the copy.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <SonidoEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action}
      titleAs="h3"
      className={className}
    />
  );
}
