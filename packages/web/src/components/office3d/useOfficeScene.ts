import type { SessionCard } from "@vibe-code/shared";
import { useEffect, useRef, useState } from "react";
import { type EnvironmentId, isEnvironment } from "./environments";
import { createOfficeScene, type OfficeScene } from "./scene";
import { type AvatarSkinId, isAvatarSkin } from "./skins";

const readPref = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable (private mode): the choice just isn't remembered
  }
};

/** Mounts the 3D office on a canvas, keeps it in step with `sessions` and the chosen room/avatar. */
export function useOfficeScene(sessions: SessionCard[]) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const [selected, setSelected] = useState<SessionCard | null>(null);
  const [failed, setFailed] = useState(false);
  const [environment, setEnvironment] = useState<EnvironmentId>(() => {
    const value = readPref("office3d.environment");
    return isEnvironment(value) ? value : "office";
  });
  const [skin, setSkin] = useState<AvatarSkinId | "auto">(() => {
    const value = readPref("office3d.skin");
    return isAvatarSkin(value) ? value : "auto";
  });
  const initial = useRef({ environment, skin });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let office: OfficeScene;
    try {
      office = createOfficeScene(canvas, {
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onSelect: setSelected,
        environment: initial.current.environment,
        skin: initial.current.skin,
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
    sceneRef.current?.setSessions(sessions);
  }, [sessions]);
  useEffect(() => {
    sceneRef.current?.setEnvironment(environment);
    writePref("office3d.environment", environment);
  }, [environment]);
  useEffect(() => {
    sceneRef.current?.setSkin(skin);
    writePref("office3d.skin", skin);
  }, [skin]);

  return { canvasRef, selected, failed, environment, setEnvironment, skin, setSkin };
}
