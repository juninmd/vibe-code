import * as THREE from "three";
import type { Character } from "./character";

export type AvatarSkinId = "dev" | "robot" | "astronaut" | "wizard" | "ninja" | "cat";

export const AVATAR_SKINS: { id: AvatarSkinId; label: string }[] = [
  { id: "dev", label: "Dev (padrão)" },
  { id: "robot", label: "Robô" },
  { id: "astronaut", label: "Astronauta" },
  { id: "wizard", label: "Mago" },
  { id: "ninja", label: "Ninja" },
  { id: "cat", label: "Gato" },
];

export const isAvatarSkin = (v: unknown): v is AvatarSkinId => AVATAR_SKINS.some((s) => s.id === v);

const std = (color: string, roughness = 0.6, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const glow = (color: string, intensity = 1.2) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

function add<T extends THREE.Object3D>(
  parent: THREE.Object3D,
  obj: T,
  pos: [number, number, number]
): T {
  obj.position.set(...pos);
  obj.traverse((o) => {
    (o as THREE.Mesh).castShadow = true;
  });
  parent.add(obj);
  return obj;
}
const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material) => new THREE.Mesh(geo, mat);

function hide(head: THREE.Group, ...names: string[]) {
  for (const c of head.children) if (names.includes(c.name)) c.visible = false;
}
function tint(char: Character, color: string, metalness = 0) {
  const m = char.torso.material as THREE.MeshStandardMaterial;
  m.color.set(color);
  m.metalness = metalness;
}
function headSkin(head: THREE.Group): THREE.MeshStandardMaterial | null {
  const s = head.children.find((c) => c.name === "skin") as THREE.Mesh | undefined;
  return (s?.material as THREE.MeshStandardMaterial) ?? null;
}

type Builder = (c: Character, accent: string) => void;

const BUILDERS: Record<AvatarSkinId, Builder> = {
  dev: () => {},

  robot(c, accent) {
    tint(c, "#94a3b8", 0.7);
    const skin = headSkin(c.head);
    if (skin) {
      skin.color.set("#cbd5e1");
      skin.metalness = 0.8;
      skin.roughness = 0.3;
    }
    hide(c.head, "hair", "glasses");
    add(c.head, mesh(new THREE.BoxGeometry(0.4, 0.14, 0.06), glow(accent, 1.6)), [0, 0.02, 0.24]);
    add(
      c.head,
      mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), std("#64748b", 0.3, 0.8)),
      [0, 0.37, 0]
    );
    add(c.head, mesh(new THREE.SphereGeometry(0.04, 12, 12), glow(accent, 2)), [0, 0.5, 0]);
    for (const x of [-0.27, 0.27])
      add(c.head, mesh(new THREE.BoxGeometry(0.05, 0.14, 0.14), std("#64748b", 0.3, 0.8)), [
        x,
        0,
        0,
      ]);
  },

  astronaut(c) {
    tint(c, "#f1f5f9");
    hide(c.head, "hair", "headphones");
    add(
      c.head,
      mesh(
        new THREE.SphereGeometry(0.37, 32, 24),
        new THREE.MeshPhysicalMaterial({
          color: "#bae6fd",
          transparent: true,
          opacity: 0.22,
          roughness: 0.05,
          metalness: 0.1,
        })
      ),
      [0, 0, 0]
    );
    add(
      c.head,
      mesh(new THREE.TorusGeometry(0.3, 0.05, 12, 32), std("#e2e8f0", 0.4)),
      [0, -0.3, 0]
    ).rotation.x = Math.PI / 2;
    add(c.group, mesh(new THREE.BoxGeometry(0.42, 0.55, 0.2), std("#e2e8f0", 0.5)), [0, 1.0, -0.3]);
    add(
      c.group,
      mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), glow("#ef4444", 0.8)),
      [0.1, 1.08, 0.2]
    );
    add(
      c.group,
      mesh(new THREE.BoxGeometry(0.12, 0.08, 0.02), glow("#38bdf8", 0.8)),
      [-0.1, 1.08, 0.2]
    );
  },

  wizard(c) {
    tint(c, "#5b21b6");
    hide(c.head, "headphones", "glasses");
    const hat = new THREE.Group();
    add(
      hat,
      mesh(new THREE.ConeGeometry(0.24, 0.62, 24), std("#4c1d95", 0.7)),
      [0, 0.31, 0]
    ).rotation.z = 0.12;
    add(
      hat,
      mesh(new THREE.TorusGeometry(0.3, 0.035, 8, 32), std("#4c1d95", 0.7)),
      [0, 0, 0]
    ).rotation.x = Math.PI / 2;
    add(
      hat,
      mesh(new THREE.SphereGeometry(0.05, 10, 10), glow("#fde047", 1.5)),
      [0.04, 0.35, 0.24]
    );
    add(c.head, hat, [0, 0.22, 0]);
    const beard = add(
      c.head,
      mesh(new THREE.ConeGeometry(0.2, 0.46, 20), std("#f8fafc", 0.9)),
      [0, -0.38, 0.12]
    );
    beard.rotation.x = Math.PI;
  },

  ninja(c, accent) {
    tint(c, "#111827");
    hide(c.head, "hair", "glasses", "headphones");
    add(
      c.head,
      mesh(
        new THREE.SphereGeometry(0.285, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62),
        std("#0b1020", 0.8)
      ),
      [0, 0.0, -0.01]
    );
    // mask over the lower face, eyes stay open
    add(
      c.head,
      mesh(
        new THREE.SphereGeometry(0.278, 32, 16, 0, Math.PI * 2, Math.PI * 0.58, Math.PI * 0.42),
        std("#0b1020", 0.8)
      ),
      [0, 0, 0.005]
    );
    add(
      c.head,
      mesh(new THREE.TorusGeometry(0.28, 0.03, 8, 32), std(accent, 0.6)),
      [0, 0.08, 0]
    ).rotation.x = Math.PI / 2;
    add(
      c.head,
      mesh(new THREE.BoxGeometry(0.06, 0.2, 0.02), std(accent, 0.6)),
      [-0.3, 0.0, -0.1]
    ).rotation.z = 0.4;
  },

  cat(c, accent) {
    tint(c, accent);
    hide(c.head, "glasses");
    for (const x of [-0.17, 0.17]) {
      const ear = add(c.head, mesh(new THREE.ConeGeometry(0.1, 0.2, 4), std("#f6cfb2", 0.7)), [
        x,
        0.3,
        0,
      ]);
      ear.rotation.z = -x * 1.2;
      add(ear, mesh(new THREE.ConeGeometry(0.05, 0.12, 4), std("#f9a8a8", 0.7)), [0, -0.01, 0.025]);
    }
    add(
      c.head,
      mesh(new THREE.SphereGeometry(0.025, 10, 10), std("#f472b6", 0.5)),
      [0, -0.035, 0.27]
    );
    const wh = std("#f8fafc", 0.5);
    for (const side of [-1, 1]) {
      for (const dy of [-0.012, 0.025]) {
        const w = add(c.head, mesh(new THREE.BoxGeometry(0.18, 0.004, 0.004), wh), [
          side * 0.2,
          -0.07 + dy,
          0.25,
        ]);
        w.rotation.z = side * dy * 5;
      }
    }
    const tail = add(
      c.group,
      mesh(new THREE.TorusGeometry(0.2, 0.05, 10, 20, Math.PI * 1.3), std("#f6cfb2", 0.7)),
      [0.25, 0.62, -0.32]
    );
    tail.rotation.set(0, Math.PI / 2, 0.3);
  },
};

/** Dresses the base seated character in a skin. Mutates `character` in place. */
export function applyAvatarSkin(character: Character, id: AvatarSkinId, accent: string): void {
  BUILDERS[id](character, accent);
}
