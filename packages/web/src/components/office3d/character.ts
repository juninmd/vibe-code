import * as THREE from "three";

export interface Character {
  group: THREE.Group;
  head: THREE.Group;
  torso: THREE.Mesh;
  forearms: [THREE.Group, THREE.Group];
  upperArms: [THREE.Group, THREE.Group];
  eyes: THREE.Mesh[];
}

const PANTS = "#1f2937";

const std = (color: string, roughness = 0.65) =>
  new THREE.MeshStandardMaterial({ color, roughness });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, pos: [number, number, number]) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...pos);
  m.castShadow = true;
  return m;
}

function chestTexture(label: string, accent: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(24, 34, 80, 56, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildHead(
  hair: string,
  skin: string,
  bun: boolean
): { head: THREE.Group; eyes: THREE.Mesh[] } {
  const head = new THREE.Group();
  head.add(mesh(new THREE.SphereGeometry(0.27, 40, 32), std(skin, 0.5), [0, 0, 0]));
  // hair cap: upper sphere shell, open at the face
  const hairMat = std(hair, 0.8);
  const cap = mesh(
    new THREE.SphereGeometry(0.295, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.56),
    hairMat,
    [0, 0.01, -0.02]
  );
  head.add(cap);
  if (bun) head.add(mesh(new THREE.SphereGeometry(0.11, 20, 14), hairMat, [0, 0.33, -0.1]));
  else head.add(mesh(new THREE.SphereGeometry(0.2, 24, 16), hairMat, [0, 0.12, -0.2]));
  const eyeMat = new THREE.MeshStandardMaterial({ color: "#111827", roughness: 0.2 });
  const eyes = [-0.095, 0.095].map((x) => {
    const eye = mesh(new THREE.SphereGeometry(0.036, 16, 12), eyeMat, [x, 0.0, 0.25]);
    eye.scale.set(1, 1.25, 0.6);
    const shine = mesh(
      new THREE.SphereGeometry(0.01, 8, 8),
      new THREE.MeshBasicMaterial({ color: "#fff" }),
      [0.01, 0.015, 0.03]
    );
    eye.add(shine);
    head.add(eye);
    return eye;
  });
  for (const x of [-0.16, 0.16]) {
    const blush = mesh(
      new THREE.CircleGeometry(0.035, 16),
      new THREE.MeshBasicMaterial({ color: "#f9a8a8", transparent: true, opacity: 0.55 }),
      [x, -0.06, 0.245]
    );
    blush.lookAt(x * 2, -0.06, 1);
    head.add(blush);
  }
  const smile = mesh(
    new THREE.TorusGeometry(0.035, 0.007, 8, 16, Math.PI),
    new THREE.MeshBasicMaterial({ color: "#7c2d12" }),
    [0, -0.075, 0.255]
  );
  smile.rotation.z = Math.PI;
  head.add(smile);
  // glasses
  const frame = std("#0f172a", 0.3);
  for (const x of [-0.095, 0.095]) {
    head.add(mesh(new THREE.TorusGeometry(0.06, 0.007, 8, 24), frame, [x, 0.0, 0.262]));
  }
  head.add(mesh(new THREE.BoxGeometry(0.05, 0.008, 0.008), frame, [0, 0.015, 0.265]));
  return { head, eyes };
}

function addHeadphones(head: THREE.Group, accent: string) {
  const mat = std("#111827", 0.4);
  const glow = new THREE.MeshStandardMaterial({
    color: accent,
    emissive: accent,
    emissiveIntensity: 0.9,
  });
  const band = mesh(new THREE.TorusGeometry(0.3, 0.018, 10, 40, Math.PI), mat, [0, 0.0, 0]);
  band.rotation.z = 0;
  head.add(band);
  for (const x of [-0.3, 0.3]) {
    const cup = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.07, 24), mat, [x, 0, 0]);
    cup.rotation.z = Math.PI / 2;
    head.add(cup);
    const ring = mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24), glow, [x * 1.1, 0, 0]);
    ring.rotation.y = Math.PI / 2;
    head.add(ring);
  }
}

function buildArm(side: -1 | 1, sleeve: THREE.Material, skin: string) {
  const shoulder = new THREE.Group();
  shoulder.position.set(side * 0.3, 1.12, 0.02);
  shoulder.rotation.set(-0.7, 0, side * -0.08);
  shoulder.add(mesh(new THREE.CapsuleGeometry(0.07, 0.2, 6, 12), sleeve, [0, -0.15, 0]));
  const elbow = new THREE.Group();
  elbow.position.set(0, -0.3, 0);
  elbow.rotation.x = -0.9;
  elbow.add(mesh(new THREE.CapsuleGeometry(0.063, 0.18, 6, 12), sleeve, [0, -0.13, 0]));
  elbow.add(mesh(new THREE.SphereGeometry(0.065, 16, 12), std(skin, 0.5), [0, -0.29, 0]));
  shoulder.add(elbow);
  return { shoulder, elbow };
}

/** Seated cartoon dev: hoodie in the engine color, headphones, glasses. */
export function createCharacter(opts: {
  label: string;
  accent: string;
  hair: string;
  skin?: string;
  bun?: boolean;
}): Character {
  const group = new THREE.Group();
  const hoodie = std(opts.accent, 0.75);
  const torso = mesh(new THREE.CapsuleGeometry(0.25, 0.32, 8, 20), hoodie, [0, 0.95, 0]);
  torso.scale.set(1, 1, 0.8);
  group.add(torso);
  group.add(mesh(new THREE.SphereGeometry(0.16, 16, 12), hoodie, [0, 1.25, -0.14]));
  const chest = new THREE.Mesh(
    new THREE.PlaneGeometry(0.34, 0.34),
    new THREE.MeshBasicMaterial({
      map: chestTexture(opts.label, "rgba(0,0,0,0.28)"),
      transparent: true,
    })
  );
  chest.position.set(0, 0.98, 0.205);
  group.add(chest);

  const pants = std(PANTS, 0.8);
  for (const x of [-0.13, 0.13]) {
    const thigh = mesh(new THREE.CapsuleGeometry(0.095, 0.38, 6, 12), pants, [x, 0.6, 0.25]);
    thigh.rotation.x = Math.PI / 2;
    group.add(thigh);
    group.add(mesh(new THREE.CapsuleGeometry(0.08, 0.36, 6, 12), pants, [x, 0.32, 0.48]));
    group.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), std("#f8fafc", 0.5), [x, 0.07, 0.53]));
  }

  const { head, eyes } = buildHead(opts.hair, opts.skin ?? "#f6cfb2", opts.bun ?? true);
  head.position.set(0, 1.55, 0.02);
  addHeadphones(head, opts.accent);
  group.add(head);

  const arms = ([-1, 1] as const).map((s) => buildArm(s, hoodie, opts.skin ?? "#f6cfb2"));
  for (const a of arms) group.add(a.shoulder);
  return {
    group,
    head,
    torso,
    eyes,
    upperArms: [arms[0].shoulder, arms[1].shoulder],
    forearms: [arms[0].elbow, arms[1].elbow],
  };
}
