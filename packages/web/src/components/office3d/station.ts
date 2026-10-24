import * as THREE from "three";

const std = (color: string, roughness = 0.7, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  pos: [number, number, number]
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(...pos);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const SNIPPETS = [
  "const run = await agent.start()",
  "for (const t of tasks) queue.push(t)",
  "export async function review(pr)",
  "git commit -m 'feat: 3d office'",
  "if (!ok) throw new Error(msg)",
  "await bun.test()  // 42 passed",
  "import { Hono } from 'hono'",
  "return diff.filter(isRelevant)",
];

export interface Screen {
  texture: THREE.CanvasTexture;
  draw: (time: number, active: boolean) => void;
}

/** Monitor face: scrolling syntax-colored code while active, dim when idle. */
export function createScreen(accent: string, seed: number): Screen {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 240;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const palette = [accent, "#7dd3fc", "#fcd34d", "#c4b5fd", "#86efac"];
  const draw = (time: number, active: boolean) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = active ? "#0b1220" : "#111827";
    ctx.fillRect(0, 0, 384, 240);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 384, 20);
    ["#f87171", "#fbbf24", "#34d399"].forEach((c, i) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(12 + i * 14, 10, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.font = "13px ui-monospace, monospace";
    const scroll = active ? time * 22 : 0;
    const lineH = 20;
    const first = Math.floor(scroll / lineH);
    for (let i = 0; i < 13; i++) {
      const n = first + i;
      const y = 40 + i * lineH - (scroll % lineH);
      ctx.fillStyle = "#475569";
      ctx.fillText(String(n + 1).padStart(2, "0"), 8, y);
      ctx.fillStyle = palette[(n + seed) % palette.length] ?? accent;
      ctx.globalAlpha = active ? 1 : 0.35;
      ctx.fillText(SNIPPETS[(n * 3 + seed) % SNIPPETS.length] ?? "", 36 + ((n + seed) % 3) * 10, y);
      ctx.globalAlpha = 1;
    }
    if (active && Math.floor(time * 2) % 2 === 0) {
      ctx.fillStyle = accent;
      ctx.fillRect(36, 224, 8, 13);
    }
    texture.needsUpdate = true;
  };
  draw(0, true);
  return { texture, draw };
}

/** Desk, chair, monitor (angled toward the character), keyboard, mug and lamp. */
export function createDeskSet(screen: Screen, accent: string): THREE.Group {
  const g = new THREE.Group();
  const wood = std("#c9a27a", 0.6);
  const dark = std("#1e293b", 0.5, 0.3);
  g.add(box(2.2, 0.08, 1.1, wood, [0.35, 0.95, 1.05]));
  for (const [x, z] of [
    [-0.65, 0.65],
    [1.35, 0.65],
    [-0.65, 1.45],
    [1.35, 1.45],
  ] as const) {
    g.add(box(0.07, 0.95, 0.07, dark, [x, 0.475, z]));
  }
  // chair
  const chairMat = std("#334155", 0.6);
  g.add(box(0.62, 0.09, 0.6, chairMat, [0, 0.46, 0]));
  g.add(box(0.6, 0.62, 0.08, chairMat, [0, 0.82, -0.3]));
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.4, 12), dark);
  post.position.set(0, 0.22, 0);
  g.add(post);
  const star = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 5), dark);
  star.position.set(0, 0.03, 0);
  g.add(star);

  // monitor, yawed so the screen faces the character and the camera side
  const monitor = new THREE.Group();
  monitor.position.set(0.55, 0.99, 1.15);
  monitor.rotation.y = Math.PI - 0.65;
  monitor.add(box(0.14, 0.3, 0.1, dark, [0, 0.15, 0]));
  monitor.add(box(0.5, 0.03, 0.3, dark, [0, 0.015, 0]));
  monitor.add(box(1.2, 0.72, 0.06, dark, [0, 0.65, 0]));
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(1.12, 0.64),
    new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false })
  );
  face.position.set(0, 0.65, 0.033);
  monitor.add(face);
  const glow = new THREE.PointLight(accent, 0.9, 3.2);
  glow.position.set(0, 0.65, 0.5);
  monitor.add(glow);
  g.add(monitor);

  const kb = box(0.62, 0.03, 0.2, std("#e2e8f0", 0.5), [0.1, 1.0, 0.85]);
  kb.rotation.y = 0.2;
  g.add(kb);
  g.add(box(0.1, 0.02, 0.16, std("#e2e8f0", 0.5), [0.58, 0.995, 0.88]));
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.1, 16), std(accent, 0.4));
  mug.position.set(-0.45, 1.04, 0.95);
  mug.castShadow = true;
  g.add(mug);
  return g;
}
