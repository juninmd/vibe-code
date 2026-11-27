import type { ReactNode } from "react";
import { Badge } from "../../../ui/Badge";

export function SurfaceHeading({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description: string;
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="rw-view-heading">
      <div>
        <p className="rw-eyebrow">SUPERFÍCIES</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {children}
      {count !== undefined && <Badge>{count}</Badge>}
    </div>
  );
}
