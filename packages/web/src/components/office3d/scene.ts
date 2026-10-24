import type { SessionCard, SessionSource } from "@vibe-code/shared";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { type Character, createCharacter } from "./character";
import { createDeskSet, createScreen, type Screen } from "./station";

export const SOURCE_SKIN: Record<SessionSource, { accent: string; hair: string; label: string }> = {
  "claude-code": { accent: "#d97757", hair: "#3b2418", label: "CC" },
  opencode: { accent: "#2dd4bf", hair: "#1e293b", label: "OC" },
  antigravity: { accent: "#8b5cf6", hair: "#a16207", label: "AG" },
};

const COLS = 3;
const GAP_X = 4.4;
const GAP_Z = 4.2;

interface Station {
  card: SessionCard;
  root: THREE.Group;
  character: Character;
  screen: Screen;
  active: boolean;
  phase: number;
}

function labelSprite(lines: string[], accent: string, w = 320): THREE.Sprite {
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
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.fillText(lines[0] ?? "", 22, 42, w - 40);
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
  scene.background = new THREE.Color("#0b1020");
  scene.fog = new THREE.Fog("#0b1020", 18, 40);
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

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(16, 64),
    new THREE.MeshStandardMaterial({ color: "#2b3a55", roughness: 0.95 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  scene.add(new THREE.GridHelper(32, 32, "#334155", "#1e293b"));

  const stations = new Map<string, Station>();
  const clickable: THREE.Object3D[] = [];
  const stationRoot = new THREE.Group();
  scene.add(stationRoot);

  let fly: { cam: THREE.Vector3; target: THREE.Vector3 } | null = null;

  function frame(count: number) {
    const rows = Math.max(1, Math.ceil(count / COLS));
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
    const character = createCharacter(skin);
    character.group.position.y = 0.0;
    character.head.rotation.y = 0.5;
    const screen = createScreen(skin.accent, index);
    root.add(character.group, createDeskSet(screen, skin.accent));
    const tag = labelSprite(
      [card.title.slice(0, 26), `${card.project} · ${card.status}`],
      skin.accent
    );
    tag.position.set(0.35, 0.35, 2.15);
    root.add(tag);
    if (card.status === "idle") root.add(zzz());
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
    for (const st of stations.values()) {
      const { character: c } = st;
      const p = t + st.phase;
      st.screen.draw(calm ? 0 : t, st.active);
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
