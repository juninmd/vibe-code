import type { SessionCard } from "@vibe-code/shared";
import { SESSION_SOURCE_LABELS } from "@vibe-code/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSessions } from "../../hooks/useSessions";
import { DEMO_SESSIONS } from "./demo";
import { createOfficeScene, type OfficeScene, SOURCE_SKIN } from "./scene";

const useDemo = () =>
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("office-demo");

/** 3D office: every open (active or idle) CLI session becomes a character at a computer. */
export function Office3DMode() {
  const { board } = useSessions(true, 10_000);
  const demo = useMemo(useDemo, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const [selected, setSelected] = useState<SessionCard | null>(null);
  const [failed, setFailed] = useState(false);

  const open = useMemo(() => {
    const cards = demo ? DEMO_SESSIONS : board.cards;
    return cards.filter((c) => c.status === "active" || c.status === "idle").slice(0, 12);
  }, [board.cards, demo]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let office: OfficeScene;
    try {
      office = createOfficeScene(canvas, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onSelect: setSelected,
      });
    } catch {
      setFailed(true);
      return;
    }
    sceneRef.current = office;
    const observer = new ResizeObserver(() => office.resize());
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    office.resize();
    return () => {
      observer.disconnect();
      office.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setSessions(open);
  }, [open]);

  const active = open.filter((c) => c.status === "active").length;
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b1020]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        aria-label="3D office with open agent sessions"
      />
      {failed && (
        <p className="absolute inset-0 grid place-items-center text-sm text-secondary">
          WebGL indisponível neste navegador.
        </p>
      )}
      <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-white/10 bg-black/40 px-3 py-1 font-semibold text-white backdrop-blur">
          Escritório 3D · {open.length} {open.length === 1 ? "sessão aberta" : "sessões abertas"}
        </span>
        <span className="rounded-full bg-cyan-500/15 px-3 py-1 text-cyan-300">
          {active} trabalhando
        </span>
        {demo && (
          <span className="rounded-full bg-amber-500/15 px-3 py-1 text-amber-300">demo</span>
        )}
      </div>
      {open.length === 0 && (
        <p className="pointer-events-none absolute inset-x-0 bottom-10 text-center text-sm text-secondary">
          Nenhuma sessão aberta. Inicie o OpenCode, Claude Code ou Antigravity e um agente aparece
          aqui.
        </p>
      )}
      {selected && (
        <div className="absolute bottom-4 right-4 w-64 rounded-xl border border-white/10 bg-black/60 p-3 text-xs text-white backdrop-blur">
          <div className="flex items-center gap-2 font-semibold">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: SOURCE_SKIN[selected.source].accent }}
            />
            {SESSION_SOURCE_LABELS[selected.source]}
          </div>
          <p className="mt-1 text-sm">{selected.title}</p>
          <p className="mt-1 text-secondary">
            {selected.project}
            {selected.branch ? ` · ${selected.branch}` : ""} · {selected.messageCount} msgs
          </p>
        </div>
      )}
    </div>
  );
}
