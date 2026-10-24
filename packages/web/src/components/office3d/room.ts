import * as THREE from "three";

function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Dusk skyline seen through big office windows. */
function skylineTexture() {
  return canvasTex(1024, 256, (c) => {
    const sky = c.createLinearGradient(0, 0, 0, 256);
    sky.addColorStop(0, "#1e1b4b");
    sky.addColorStop(0.6, "#7c3aed");
    sky.addColorStop(1, "#f9a8d4");
    c.fillStyle = sky;
    c.fillRect(0, 0, 1024, 256);
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let x = 0; x < 1024; ) {
      const w = 40 + rnd() * 60;
      const h = 60 + rnd() * 120;
      c.fillStyle = "#0f172a";
      c.fillRect(x, 256 - h, w, h);
      for (let wy = 256 - h + 8; wy < 248; wy += 12) {
        for (let wx = x + 6; wx < x + w - 8; wx += 12) {
          if (rnd() > 0.55) {
            c.fillStyle = rnd() > 0.5 ? "#fde68a" : "#7dd3fc";
            c.fillRect(wx, wy, 5, 6);
          }
        }
      }
      x += w + 2;
    }
    c.fillStyle = "rgba(15,23,42,0.9)";
    for (let x = 0; x <= 1024; x += 256) c.fillRect(x - 5, 0, 10, 256);
    c.fillRect(0, 0, 1024, 8);
  });
}

function plant(): THREE.Group {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.26, 0.5, 20),
    new THREE.MeshStandardMaterial({ color: "#e2e8f0", roughness: 0.6 })
  );
  pot.position.y = 0.25;
  pot.castShadow = true;
  g.add(pot);
  const leaf = new THREE.MeshStandardMaterial({
    color: "#22c55e",
    roughness: 0.7,
    flatShading: true,
  });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), leaf);
    m.scale.set(0.8, 1.7, 0.8);
    m.position.set(Math.cos(a) * 0.22, 0.95 + (i % 2) * 0.2, Math.sin(a) * 0.22);
    m.rotation.set(Math.cos(a) * 0.5, 0, -Math.sin(a) * 0.5);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

export interface Room {
  fit: (width: number, depth: number, centerZ: number) => void;
  update: (t: number) => void;
}

/** Tiled floor slab, skyline window wall, neon edge, plants and floating motes. */
export function createRoom(scene: THREE.Scene): Room {
  const tiles = canvasTex(256, 256, (c) => {
    c.fillStyle = "#a7b4c8";
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = "#98a7be";
    c.fillRect(0, 0, 128, 128);
    c.fillRect(128, 128, 128, 128);
    c.strokeStyle = "#7b8aa3";
    c.lineWidth = 3;
    c.strokeRect(0, 0, 256, 256);
  });
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping;
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.4, 1),
    new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.55, metalness: 0.05 })
  );
  slab.position.y = -0.2;
  slab.receiveShadow = true;
  const neon = new THREE.Mesh(
    new THREE.BoxGeometry(1, 0.06, 1),
    new THREE.MeshStandardMaterial({
      color: "#6366f1",
      emissive: "#6366f1",
      emissiveIntensity: 1.6,
    })
  );
  neon.position.y = -0.3;
  const wall = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: skylineTexture(), toneMapped: false })
  );
  wall.rotation.y = Math.PI / 2;
  const plants = [plant(), plant(), plant()];
  const group = new THREE.Group();
  group.add(slab, neon, wall, ...plants);
  scene.add(group);

  const N = 90;
  const pos = new Float32Array(N * 3);
  const motes = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(pos, 3)),
    new THREE.PointsMaterial({ color: "#c7d2fe", size: 0.06, transparent: true, opacity: 0.7 })
  );
  scene.add(motes);
  let w = 12;
  let d = 12;
  let cz = 0;
  const seedMotes = () => {
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * w;
      pos[i * 3 + 1] = Math.random() * 5;
      pos[i * 3 + 2] = cz + (Math.random() - 0.5) * d;
    }
    motes.geometry.attributes.position.needsUpdate = true;
  };
  return {
    fit(width, depth, centerZ) {
      w = width;
      d = depth;
      cz = centerZ;
      slab.scale.set(width, 1, depth);
      neon.scale.set(width + 0.1, 1, depth + 0.1);
      slab.position.z = neon.position.z = centerZ;
      tiles.repeat.set(width / 2, depth / 2);
      wall.scale.set(depth + 6, 6.5, 1);
      wall.position.set(-width / 2 - 0.5, 3.2, centerZ);
      plants[0]?.position.set(-width / 2 + 0.8, 0, centerZ - depth / 2 + 0.8);
      plants[1]?.position.set(-width / 2 + 0.8, 0, centerZ + depth / 2 - 0.8);
      plants[2]?.position.set(width / 2 - 0.8, 0, centerZ + depth / 2 - 0.8);
      seedMotes();
    },
    update(t) {
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] += 0.004;
        pos[i * 3] += Math.sin(t + i) * 0.0015;
        if ((pos[i * 3 + 1] ?? 0) > 5) pos[i * 3 + 1] = 0;
      }
      motes.geometry.attributes.position.needsUpdate = true;
    },
  };
}
