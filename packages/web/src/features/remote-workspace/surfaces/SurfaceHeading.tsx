import type { ReactNode } from "react";

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
      {count !== undefined && <span className="rw-count">{count}</span>}
    </div>
  );
}
