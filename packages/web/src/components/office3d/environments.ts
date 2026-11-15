import * as THREE from "three";
import { createRoom, type Room } from "./room";

export type EnvironmentId = "office" | "space" | "cyberpunk" | "forest" | "beach";

export interface EnvironmentTheme {
  background: string;
  fog: [string, number, number];
  hemi: [string, string, number];
  sun: [string, number];
}

export interface Environment {
  room: Room;
  theme: EnvironmentTheme;
  dispose: () => void;
}

export const ENVIRONMENTS: { id: EnvironmentId; label: string }[] = [
  { id: "office", label: "Escritório" },
  { id: "space", label: "Estação espacial" },
  { id: "cyberpunk", label: "Cyberpunk" },
  { id: "forest", label: "Floresta" },
  { id: "beach", label: "Praia" },
];

export const isEnvironment = (v: unknown): v is EnvironmentId =>
  ENVIRONMENTS.some((e) => e.id === v);

const THEMES: Record<EnvironmentId, EnvironmentTheme> = {
  office: {
    background: "#0f172a",
    fog: ["#0f172a", 18, 40],
    hemi: ["#c7d2fe", "#1e1b4b", 1.1],
    sun: ["#fff4e0", 2.2],
  },
  space: {
    background: "#04050d",
    fog: ["#04050d", 25, 60],
    hemi: ["#7dd3fc", "#0b1026", 0.9],
    sun: ["#bae6fd", 1.6],
  },
  cyberpunk: {
    background: "#12051f",
    fog: ["#12051f", 14, 34],
    hemi: ["#f0abfc", "#1e1b4b", 0.9],
    sun: ["#e879f9", 1.5],
  },
  forest: {
    background: "#bfe3c0",
    fog: ["#bfe3c0", 20, 46],
    hemi: ["#f0fdf4", "#365314", 1.3],
    sun: ["#fff1c9", 2.6],
  },
  beach: {
    background: "#7dd3fc",
    fog: ["#bae6fd", 24, 55],
    hemi: ["#e0f2fe", "#fde68a", 1.3],
    sun: ["#fffbeb", 3],
  },
};

/** Deterministic PRNG so textures look the same on every load. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext("2d");
  if (ctx) draw(ctx);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const std = (color: string, roughness = 0.7, metalness = 0, extra: object = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
const emissive = (color: string, i = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: i });

/** Floor slab with a neon edge, resized by `fit`. */
function slabWith(group: THREE.Group, map: THREE.Texture, edge: string, tileSize = 2) {
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), std("#ffffff", 0.5, 0.05, { map }));
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  const rim = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 1), emissive(edge, 1.4));
  rim.position.y = -0.3;
  group.add(slab, rim);
  return (w: number, d: number, cz: number) => {
    slab.scale.set(w, 1, d);
    rim.scale.set(w + 0.1, 1, d + 0.1);
    slab.position.z = rim.position.z = cz;
    map.repeat.set(w / tileSize, d / tileSize);
  };
}

function particles(count: number, color: string, size: number, opacity = 0.8) {
  const pos = new Float32Array(count * 3);
  const pts = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({
      color,
      size,
      transparent: true,
      opacity,
      depthWrite: false,
      fog: false,
    })
  );
  return { pts, pos };
}

/* ───────────────────────── space station ───────────────────────── */
function space(scene: THREE.Scene): Room {
  const g = new THREE.Group();
  const grid = canvasTex(256, 256, (c) => {
    c.fillStyle = "#1e293b";
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "#38bdf8";
    c.lineWidth = 2;
    c.strokeRect(2, 2, 252, 252);
    c.strokeStyle = "rgba(56,189,248,.25)";
    c.beginPath();
    c.moveTo(128, 0);
    c.lineTo(128, 256);
    c.moveTo(0, 128);
    c.lineTo(256, 128);
    c.stroke();
  });
  const fitSlab = slabWith(g, grid, "#22d3ee");

  const stars = particles(700, "#ffffff", 0.12, 0.9);
  for (let i = 0; i < 700; i++) {
    const r = 45 + Math.random() * 10;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(Math.random() * 1.2 - 0.35);
    stars.pos.set(
      [r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) + 6, r * Math.sin(ph) * Math.sin(th)],
      i * 3
    );
  }
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(5, 48, 32),
    std("#6366f1", 0.8, 0, { emissive: "#312e81", emissiveIntensity: 0.6 })
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(6.8, 9, 64),
    new THREE.MeshBasicMaterial({
      color: "#a5b4fc",
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5,
    })
  );
  ring.rotation.x = Math.PI / 2.4;
  planet.add(ring);
  const rocks = [0, 1, 2, 3].map((i) => {
    const m = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.5 + i * 0.15, 0),
      std("#64748b", 0.9, 0, { flatShading: true })
    );
    g.add(m);
    return m;
  });
  const pillars = [0, 1, 2, 3].map(() => {
    const p = new THREE.Group();
    p.add(
      new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 3.4, 12), std("#64748b", 0.5, 0.15))
    );
    const l = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12),
      emissive("#22d3ee", 1.8)
    );
    l.position.y = 1.2;
    p.add(l);
    p.position.y = 1.7;
    g.add(p);
    return p;
  });
  g.add(planet, stars.pts);
  scene.add(g);
  let w = 12;
  let d = 12;
  let cz = 0;
  return {
    fit(width, depth, centerZ) {
      w = width;
      d = depth;
      cz = centerZ;
      fitSlab(width, depth, centerZ);
      planet.position.set(-width / 2 - 16, 3, centerZ - 14);
      const c = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const;
      pillars.forEach((p, i) => {
        p.position.set(
          (c[i]?.[0] ?? 1) * (width / 2 - 0.5),
          1.7,
          centerZ + (c[i]?.[1] ?? 1) * (depth / 2 - 0.5)
        );
      });
    },
    update(t) {
      planet.rotation.y = t * 0.03;
      rocks.forEach((r, i) => {
        r.position.set(
          -w / 2 - 3 - i * 1.6,
          3 + Math.sin(t * 0.5 + i) * 0.5 + i * 0.6,
          cz + (i - 1.5) * (d / 4)
        );
        r.rotation.set(t * 0.2 + i, t * 0.15, 0);
      });
    },
  };
}

/* ───────────────────────── cyberpunk night ───────────────────────── */
function cyberpunk(scene: THREE.Scene): Room {
  const g = new THREE.Group();
  const asphalt = canvasTex(256, 256, (c) => {
    c.fillStyle = "#0f0a1f";
    c.fillRect(0, 0, 256, 256);
    c.strokeStyle = "#d946ef";
    c.lineWidth = 3;
    c.strokeRect(0, 0, 256, 256);
    c.strokeStyle = "rgba(34,211,238,.35)";
    c.lineWidth = 2;
    c.strokeRect(64, 64, 128, 128);
  });
  const fitSlab = slabWith(g, asphalt, "#d946ef");
  const skyline = canvasTex(1024, 512, (c) => {
    const grad = c.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#2e0b4f");
    grad.addColorStop(1, "#7e1d8f");
    c.fillStyle = grad;
    c.fillRect(0, 0, 1024, 512);
    let x = 0;
    const rnd = seeded(7);
    while (x < 1024) {
      const bw = 50 + rnd() * 70;
      const bh = 140 + rnd() * 300;
      c.fillStyle = "#0b0616";
      c.fillRect(x, 512 - bh, bw, bh);
      for (let y = 512 - bh + 10; y < 500; y += 16)
        for (let wx = x + 6; wx < x + bw - 8; wx += 12) {
          if (rnd() > 0.55) {
            c.fillStyle = rnd() > 0.5 ? "#22d3ee" : "#f0abfc";
            c.fillRect(wx, y, 6, 8);
          }
        }
      x += bw + 6;
    }
  });
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: skyline, toneMapped: false })
  );
  wall.rotation.y = Math.PI / 2;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(4, 1.2),
    new THREE.MeshBasicMaterial({
      map: canvasTex(512, 160, (c) => {
        c.clearRect(0, 0, 512, 160);
        c.font = "bold 110px system-ui, sans-serif";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.shadowColor = "#22d3ee";
        c.shadowBlur = 24;
        c.fillStyle = "#a5f3fc";
        c.fillText("VIBE", 256, 84);
      }),
      transparent: true,
      toneMapped: false,
    })
  );
  sign.rotation.y = Math.PI / 2;
  const tubes = [emissive("#22d3ee", 2), emissive("#f0abfc", 2)].map((m) => {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1), m);
    g.add(t);
    return t;
  });
  const rain = particles(500, "#a5f3fc", 0.05, 0.55);
  g.add(wall, sign, rain.pts);
  scene.add(g);
  let w = 12;
  let d = 12;
  let cz = 0;
  const seed = () => {
    for (let i = 0; i < 500; i++)
      rain.pos.set(
        [(Math.random() - 0.5) * (w + 8), Math.random() * 9, cz + (Math.random() - 0.5) * (d + 4)],
        i * 3
      );
  };
  return {
    fit(width, depth, centerZ) {
      w = width;
      d = depth;
      cz = centerZ;
      fitSlab(width, depth, centerZ);
      wall.scale.set(depth + 14, 12, 1);
      wall.position.set(-width / 2 - 3, 5.5, centerZ);
      sign.position.set(-width / 2 - 2.8, 5.5, centerZ);
      tubes.forEach((t, i) => {
        t.scale.set(1, 1, depth);
        t.position.set(-width / 2 - 0.2, 0.9 + i * 0.5, centerZ);
      });
      seed();
    },
    update() {
      for (let i = 0; i < 500; i++) {
        const y = (rain.pos[i * 3 + 1] ?? 0) - 0.18;
        rain.pos[i * 3 + 1] = y < 0 ? 9 : y;
      }
      rain.pts.geometry.attributes.position.needsUpdate = true;
    },
  };
}

/* ───────────────────────── forest clearing ───────────────────────── */
function tree(scale: number, hue: string): THREE.Group {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.26, 1.4, 10),
    std("#78350f", 0.9)
  );
  trunk.position.y = 0.7;
  t.add(trunk);
  for (let i = 0; i < 3; i++) {
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.2 - i * 0.28, 1.5, 12),
      std(hue, 0.8, 0, { flatShading: true })
    );
    cone.position.y = 1.9 + i * 0.9;
    cone.castShadow = true;
    t.add(cone);
  }
  t.scale.setScalar(scale);
  return t;
}

function forest(scene: THREE.Scene): Room {
  const g = new THREE.Group();
  const grass = canvasTex(256, 256, (c) => {
    c.fillStyle = "#4d8f3a";
    c.fillRect(0, 0, 256, 256);
    const rnd = seeded(3);
    for (let i = 0; i < 700; i++) {
      c.fillStyle = rnd() > 0.5 ? "#5fa34a" : "#3f7a2e";
      c.fillRect(rnd() * 256, rnd() * 256, 3, 8);
    }
    for (let i = 0; i < 14; i++) {
      c.fillStyle = ["#fde047", "#f9a8d4", "#ffffff"][i % 3] ?? "#fff";
      c.beginPath();
      c.arc(rnd() * 256, rnd() * 256, 3, 0, 7);
      c.fill();
    }
  });
  const fitSlab = slabWith(g, grass, "#a3e635", 4);
  const trees = Array.from({ length: 16 }, (_, i) => {
    const t = tree(0.7 + (i % 4) * 0.15, ["#2f6b2a", "#3a7d32", "#27581f"][i % 3] ?? "#2f6b2a");
    g.add(t);
    return t;
  });
  const rocks = [0, 1, 2].map((i) => {
    const r = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.4 + i * 0.12, 0),
      std("#94a3b8", 0.9, 0, { flatShading: true })
    );
    r.castShadow = true;
    g.add(r);
    return r;
  });
  const fire = particles(70, "#fde68a", 0.09, 0.9);
  g.add(fire.pts);
  scene.add(g);
  let w = 12;
  let d = 12;
  let cz = 0;
  const seed = () => {
    for (let i = 0; i < 70; i++)
      fire.pos.set(
        [(Math.random() - 0.5) * w, Math.random() * 4, cz + (Math.random() - 0.5) * d],
        i * 3
      );
  };
  return {
    fit(width, depth, centerZ) {
      w = width;
      d = depth;
      cz = centerZ;
      fitSlab(width, depth, centerZ);
      trees.forEach((t, i) => {
        const side = i % 4;
        const k = Math.floor(i / 4) / 3;
        const margin = 3.2 + (i % 3) * 1.2;
        if (side === 0) t.position.set(-width / 2 - margin, 0, centerZ + (k - 0.5) * (depth + 4));
        else if (side === 1)
          t.position.set(width / 2 + margin, 0, centerZ + (k - 0.5) * (depth + 4));
        else if (side === 2)
          t.position.set((k - 0.5) * (width + 4), 0, centerZ - depth / 2 - margin);
        else t.position.set((k - 0.5) * (width + 4), 0, centerZ + depth / 2 + margin);
      });
      rocks.forEach((r, i) => {
        r.position.set(width / 2 - 0.8 - i * 0.5, 0.2, centerZ - depth / 2 + 0.8 + i * 0.4);
      });
      seed();
    },
    update(t) {
      for (let i = 0; i < 70; i++) {
        fire.pos[i * 3 + 1] = (fire.pos[i * 3 + 1] ?? 0) + Math.sin(t * 2 + i) * 0.004 + 0.003;
        if ((fire.pos[i * 3 + 1] ?? 0) > 4) fire.pos[i * 3 + 1] = 0;
      }
      fire.pts.geometry.attributes.position.needsUpdate = true;
    },
  };
}

/* ───────────────────────── beach ───────────────────────── */
function palm(): THREE.Group {
  const p = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 3.2, 10), std("#a16207", 0.9));
  trunk.position.y = 1.6;
  trunk.rotation.z = 0.12;
  p.add(trunk);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 2, 6),
      std("#16a34a", 0.7, 0, { flatShading: true })
    );
    leaf.scale.z = 0.25;
    const a = (i / 6) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.85 + 0.35, 3.3, Math.sin(a) * 0.85);
    leaf.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2 - 0.1);
    leaf.castShadow = true;
    p.add(leaf);
  }
  return p;
}

function beach(scene: THREE.Scene): Room {
  const g = new THREE.Group();
  const sand = canvasTex(256, 256, (c) => {
    c.fillStyle = "#f3e0b5";
    c.fillRect(0, 0, 256, 256);
    const rnd = seeded(5);
    for (let i = 0; i < 900; i++) {
      c.fillStyle = rnd() > 0.5 ? "#e8cf99" : "#fbeccb";
      c.fillRect(rnd() * 256, rnd() * 256, 2, 2);
    }
  });
  const fitSlab = slabWith(g, sand, "#38bdf8", 4);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 24, 24),
    std("#0891b2", 0.25, 0.1, { transparent: true, opacity: 0.9 })
  );
  sea.rotation.x = -Math.PI / 2;
  const foam = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 0.5),
    new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.6 })
  );
  foam.rotation.x = -Math.PI / 2;
  const palms = [palm(), palm(), palm()];
  const umbrella = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.2, 8), std("#e5e7eb", 0.4));
  pole.position.y = 1.1;
  const canopy = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.55, 16), std("#f43f5e", 0.7));
  canopy.position.y = 2.3;
  canopy.castShadow = true;
  umbrella.add(pole, canopy);
  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(2.2, 24, 16),
    new THREE.MeshBasicMaterial({ color: "#fde047", toneMapped: false })
  );
  g.add(sea, foam, ...palms, umbrella, sun);
  scene.add(g);
  const base = (
    sea.geometry.attributes.position as THREE.BufferAttribute
  ).array.slice() as Float32Array;
  return {
    fit(width, depth, centerZ) {
      fitSlab(width, depth, centerZ);
      sea.scale.set(60, depth + 40, 1);
      sea.position.set(-width / 2 - 20, -0.15, centerZ);
      foam.scale.set(1, depth + 4, 1);
      foam.rotation.z = Math.PI / 2;
      foam.position.set(-width / 2 - 0.4, -0.05, centerZ);
      palms[0]?.position.set(width / 2 - 0.8, 0, centerZ - depth / 2 + 0.8);
      palms[1]?.position.set(width / 2 - 0.8, 0, centerZ);
      palms[2]?.position.set(-width / 2 + 1, 0, centerZ - depth / 2 + 0.8);
      umbrella.position.set(width / 2 - 1.2, 0, centerZ + depth / 2 - 1.2);
      sun.position.set(-width / 2 - 30, 14, centerZ - 10);
    },
    update(t) {
      const arr = sea.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < arr.count; i++)
        arr.setZ(
          i,
          (base[i * 3] ?? 0) * 0 +
            Math.sin(t * 1.2 + (base[i * 3] ?? 0) * 8 + (base[i * 3 + 1] ?? 0) * 6) * 0.04
        );
      arr.needsUpdate = true;
    },
  };
}

const BUILDERS: Record<EnvironmentId, (scene: THREE.Scene) => Room> = {
  office: createRoom,
  space,
  cyberpunk,
  forest,
  beach,
};

/** Builds an environment; everything it adds to the scene is removed again by `dispose`. */
export function createEnvironment(id: EnvironmentId, scene: THREE.Scene): Environment {
  const before = new Set(scene.children);
  const room = BUILDERS[id](scene);
  const added = scene.children.filter((c) => !before.has(c));
  return {
    room,
    theme: THEMES[id],
    dispose() {
      for (const obj of added) {
        scene.remove(obj);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          for (const mat of Array.isArray(m.material)
            ? m.material
            : m.material
              ? [m.material]
              : []) {
            (mat as THREE.MeshBasicMaterial).map?.dispose();
            mat.dispose();
          }
        });
      }
    },
  };
}
