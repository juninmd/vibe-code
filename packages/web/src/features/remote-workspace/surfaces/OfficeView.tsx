import { SESSION_SOURCE_LABELS } from "@vibe-code/shared";
import { useMemo } from "react";
import { DEMO_SESSIONS } from "../../../components/office3d/demo";
import { ENVIRONMENTS, isEnvironment } from "../../../components/office3d/environments";
import { SOURCE_SKIN } from "../../../components/office3d/scene";
import { AVATAR_SKINS, isAvatarSkin } from "../../../components/office3d/skins";
import { useOfficeScene } from "../../../components/office3d/useOfficeScene";
import { useSessions } from "../../../hooks/useSessions";
import type { Workspace } from "../WorkspaceViews";
import { appSessionCards, mergeOpenCards } from "./appSessions";

/** 3D office: every open CLI session becomes a character working at a desk. */
export function OfficeView({ workspace }: { workspace: Workspace }) {
  const { board } = useSessions(workspace.server, 10_000);
  const demo = !workspace.server;
  const open = useMemo(
    () =>
      (demo
        ? DEMO_SESSIONS
        : mergeOpenCards(appSessionCards(workspace.sessions, workspace.projects), board.cards)
      )
        .filter((c) => c.status === "active" || c.status === "idle")
        .slice(0, 12),
    [board.cards, demo, workspace.sessions, workspace.projects]
  );

  const { canvasRef, selected, failed, environment, setEnvironment, skin, setSkin } =
    useOfficeScene(open);

  const working = open.filter((c) => c.status === "active").length;
  return (
    <div className="rw-office">
      <canvas ref={canvasRef} aria-label="Escritório 3D com as sessões abertas" />
      {failed && <p className="rw-office-empty">WebGL indisponível neste navegador.</p>}
      <div className="rw-office-bar">
        <span className="rw-office-chip">
          <strong>Escritório 3D</strong> · {open.length}{" "}
          {open.length === 1 ? "sessão aberta" : "sessões abertas"}
        </span>
        <span className="rw-office-chip">
          <span className="rw-status-dot working" />
          {working} trabalhando
        </span>
        {demo && <span className="rw-office-chip">demonstração</span>}
        <span className="rw-office-spacer" />
        <label className="rw-office-chip">
          Ambiente
          <select
            value={environment}
            onChange={(e) => isEnvironment(e.target.value) && setEnvironment(e.target.value)}
          >
            {ENVIRONMENTS.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="rw-office-chip">
          Avatar
          <select
            value={skin}
            onChange={(e) =>
              e.target.value === "auto"
                ? setSkin("auto")
                : isAvatarSkin(e.target.value) && setSkin(e.target.value)
            }
          >
            <option value="auto">Automático</option>
            {AVATAR_SKINS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {open.length === 0 && !failed && (
        <p className="rw-office-empty">
          Nenhuma sessão aberta. Inicie o OpenCode, Claude Code ou Antigravity e um agente aparece
          aqui.
        </p>
      )}
      {selected && (
        <div className="rw-office-card" role="status">
          <span>
            <i style={{ background: SOURCE_SKIN[selected.source].accent }} />
            {SESSION_SOURCE_LABELS[selected.source]}
          </span>
          <strong>{selected.title}</strong>
          <small>
            {selected.project}
            {selected.branch ? ` · ${selected.branch}` : ""} · {selected.messageCount} msgs
          </small>
        </div>
      )}
    </div>
  );
}
