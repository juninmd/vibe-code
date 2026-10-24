import type { SessionCard, SessionSource } from "@vibe-code/shared";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type Character, createCharacter } from "./character";
import { createRoom } from "./room";
import { createDeskSet, createScreen, type Screen } from "./station";

export const SOURCE_SKIN: Record<SessionSource, { accent: string; hair: string; label: string }> = {
  "claude-code": { accent: "#d97757", hair: "#3b2418", label: "CC" },
  opencode: { accent: "#2dd4bf", hair: "#1e293b", label: "OC" },
  antigravity: { accent: "#8b5cf6", hair: "#a16207", label: "AG" },
};

const SKINS = ["#f6cfb2", "#e0a98a", "#c68863", "#8d5a3b"];
const HAIRS = ["#3b2418", "#1e293b", "#a16207", "#7f1d1d", "#4c1d95"];
const hash = (id: string) => [...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);

const COLS = 3;
const GAP_X = 4.4;
const GAP_Z = 4.2;

interface Station {
  card: SessionCard;
  root: THREE.Group;
  character: Character;
  screen: Screen;
  ring: THREE.Mesh;
  active: boolean;
  phase: number;
}

function labelSprite(lines: string[], accent: string, w = 320, dot?: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 96;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(15,23,42,0.88)";
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, 92, 18);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.fillRect(2, 20, 6, 56);
    if (dot) {
      ctx.fillStyle = dot;
      ctx.beginPath();
      ctx.arc(w - 26, 28, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText(lines[0] ?? "", 22, 42, w - 72);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "20px system-ui, sans-serif";
    ctx.fillText(lines[1] ?? "", 22, 74, w - 40);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.scale.set(w / 150, 0.64, 1);
  s.renderOrder = 10;
  return s;
}

function typingBubble(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 96;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(248,250,252,0.95)";
    ctx.beginPath();
    ctx.roundRect(8, 6, 144, 64, 30);
    ctx.moveTo(40, 68);
    ctx.lineTo(30, 90);
    ctx.lineTo(62, 68);
    ctx.fill();
    ctx.fillStyle = "#475569";
    for (const x of [48, 80, 112]) {
      ctx.beginPath();
      ctx.arc(x, 38, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
  );
  s.position.set(0.55, 2.2, 0.1);
  s.scale.set(0.85, 0.5, 1);
  return s;
}

function zzz(): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#93c5fd";
    ctx.font = "bold 54px system-ui, sans-serif";
    ctx.fillText("Z", 30, 100);
    ctx.font = "bold 38px system-ui, sans-serif";
    ctx.fillText("z", 72, 62);
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText("z", 100, 30);
  }
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
  );
  s.position.set(0.2, 2.15, 0.1);
  s.scale.set(0.7, 0.7, 1);
  return s;
}

export interface OfficeScene {
  setSessions: (cards: SessionCard[]) => void;
  resize: () => void;
  dispose: () => void;
}

export function createOfficeScene(
  canvas: HTMLCanvasElement,
  opts: { reducedMotion: boolean; onSelect: (card: SessionCard | null) => void }
): OfficeScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0f172a");
  scene.fog = new THREE.Fog("#0f172a", 18, 40);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI / 2.2;
  controls.minDistance = 4;
  controls.maxDistance = 26;

  scene.add(new THREE.HemisphereLight("#c7d2fe", "#1e1b4b", 1.1));
  const sun = new THREE.DirectionalLight("#fff4e0", 2.2);
  sun.position.set(6, 12, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 40 });
  scene.add(sun);

  const room = createRoom(scene);
  room.fit(12, 10, 0);

  const stations = new Map<string, Station>();
  const clickable: THREE.Object3D[] = [];
  const stationRoot = new THREE.Group();
  scene.add(stationRoot);

  let fly: { cam: THREE.Vector3; target: THREE.Vector3 } | null = null;

  function frame(count: number) {
    const rows = Math.max(1, Math.ceil(count / COLS));
    const cols = Math.min(count, COLS) || 1;
    room.fit(cols * GAP_X + 5, rows * GAP_Z + 3, ((rows - 1) * GAP_Z) / 2);
    const dist = 9 + Math.max(rows, Math.min(count, COLS)) * 2.4;
    camera.position.set(dist * 0.9, dist * 0.5, dist * 0.32);
    controls.target.set(0, 1.1, ((rows - 1) * GAP_Z) / 2);
    controls.update();
  }

  function layout(cards: SessionCard[]) {
    cards.forEach((card, i) => {
      const st = stations.get(card.id);
      if (!st) return;
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const inRow = Math.min(COLS, cards.length - row * COLS);
      st.root.position.set((col - (inRow - 1) / 2) * GAP_X, 0, row * GAP_Z);
    });
  }

  function addStation(card: SessionCard, index: number) {
    const skin = SOURCE_SKIN[card.source];
    const root = new THREE.Group();
    const h = hash(card.id);
    const character = createCharacter({
      ...skin,
      hair: HAIRS[h % HAIRS.length] ?? skin.hair,
      skin: SKINS[(h >> 3) % SKINS.length],
      bun: h % 2 === 0,
    });
    character.group.position.y = 0.0;
    character.head.rotation.y = 0.5;
    const screen = createScreen(skin.accent, index);
    const desk = createDeskSet(screen, skin.accent);
    root.add(character.group, desk);
    const tag = labelSprite(
      [card.title.slice(0, 26), `${card.project} · ${card.status}`],
      skin.accent,
      320,
      card.status === "active" ? "#22d3ee" : "#fbbf24"
    );
    tag.position.set(0.35, 0.35, 2.15);
    root.add(tag);
    root.add(card.status === "idle" ? zzz() : typingBubble());
    root.traverse((o) => {
      o.userData.cardId = card.id;
    });
    stationRoot.add(root);
    clickable.push(root);
    stations.set(card.id, {
      card,
      root,
      character,
      screen,
      ring: desk.userData.ring as THREE.Mesh,
      active: card.status === "active",
      phase: index * 1.7,
    });
  }

  function removeStation(id: string) {
    const st = stations.get(id);
    if (!st) return;
    stationRoot.remove(st.root);
    clickable.splice(clickable.indexOf(st.root), 1);
    disposeTree(st.root);
    stations.delete(id);
  }

  const clock = new THREE.Clock();
  let frameId = 0;
  const tick = () => {
    frameId = requestAnimationFrame(tick);
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    const calm = opts.reducedMotion;
    if (!calm) room.update(t);
    for (const st of stations.values()) {
      const { character: c } = st;
      const p = t + st.phase;
      st.screen.draw(calm ? 0 : t, st.active);
      (st.ring.material as THREE.MeshStandardMaterial).emissiveIntensity = st.active
        ? 1.1 + (calm ? 0 : Math.sin(p * 3) * 0.6)
        : 0.15;
      if (calm) continue;
      const typing = st.active ? 1 : 0;
      c.forearms[0].rotation.x = -0.9 + Math.sin(p * 16) * 0.07 * typing;
      c.forearms[1].rotation.x = -0.9 + Math.sin(p * 16 + 2.2) * 0.07 * typing;
      c.upperArms[0].rotation.x = -0.7 + Math.sin(p * 8) * 0.03 * typing;
      c.head.rotation.x = st.active ? Math.sin(p * 2) * 0.04 : 0.28 + Math.sin(p * 0.9) * 0.03;
      c.head.rotation.y = 0.5 + Math.sin(p * 0.6) * 0.06;
      c.torso.scale.y = 1 + Math.sin(p * 1.6) * 0.012;
      const blink = Math.sin(p * 1.3) > 0.985 ? 0.1 : 1.25;
      for (const e of c.eyes) e.scale.y = blink;
    }
    if (fly) {
      const k = 1 - Math.exp(-5 * dt);
      camera.position.lerp(fly.cam, k);
      controls.target.lerp(fly.target, k);
      if (camera.position.distanceTo(fly.cam) < 0.03) fly = null;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  const ray = new THREE.Raycaster();
  const onPointer = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1
      ),
      camera
    );
    const hit = ray.intersectObjects(clickable, true)[0];
    const id = hit?.object.userData.cardId as string | undefined;
    const st = id ? stations.get(id) : undefined;
    opts.onSelect(st?.card ?? null);
    if (st) {
      const p = st.root.position;
      fly = {
        cam: new THREE.Vector3(p.x + 3.6, 2.6, p.z + 2.0),
        target: new THREE.Vector3(p.x, 1.2, p.z + 0.6),
      };
    }
  };
  canvas.addEventListener("click", onPointer);

  return {
    setSessions(cards) {
      const ids = new Set(cards.map((c) => c.id));
      for (const id of [...stations.keys()]) if (!ids.has(id)) removeStation(id);
      cards.forEach((card, i) => {
        const prev = stations.get(card.id);
        if (prev && prev.card.status === card.status && prev.card.title === card.title) return;
        removeStation(card.id);
        addStation(card, i);
      });
      layout(cards);
      frame(cards.length);
    },
    resize() {
      const { clientWidth: w, clientHeight: h } = canvas.parentElement ?? canvas;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    },
    dispose() {
      cancelAnimationFrame(frameId);
      canvas.removeEventListener("click", onPointer);
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
    },
  };
}

function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}
