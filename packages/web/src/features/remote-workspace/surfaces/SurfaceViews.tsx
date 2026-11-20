import { lazy, Suspense } from "react";
import type { Workspace } from "../WorkspaceViews";
import { BoardView } from "./BoardView";
import { TerminalsView } from "./TerminalsView";
import "./surfaces.css";

// three.js is heavy: load the office only when someone opens it.
const OfficeView = lazy(() => import("./OfficeView").then((m) => ({ default: m.OfficeView })));

export type SurfacePage = "board" | "terminals" | "office";

/** Operator surfaces: board, terminals and the 3D office. */
export const SURFACES: { page: SurfacePage; label: string; icon: "board" | "terminal" | "cube" }[] =
  [
    { page: "board", label: "Quadro", icon: "board" },
    { page: "terminals", label: "Terminais", icon: "terminal" },
    { page: "office", label: "Escritório 3D", icon: "cube" },
  ];

export const isSurface = (view: string): view is SurfacePage =>
  SURFACES.some((s) => s.page === view);

export function SurfaceViews({
  page,
  workspace,
  onOpen,
  onOpenTerminal,
}: {
  page: SurfacePage;
  workspace: Workspace;
  onOpen: (id: string) => void;
  onOpenTerminal: (id: string) => void;
}) {
  if (page === "board") return <BoardView workspace={workspace} onOpen={onOpen} />;
  if (page === "terminals")
    return <TerminalsView workspace={workspace} onOpenTerminal={onOpenTerminal} />;
  return (
    <Suspense fallback={<p className="rw-inline-state">Carregando escritório 3D…</p>}>
      <OfficeView workspace={workspace} />
    </Suspense>
  );
}
