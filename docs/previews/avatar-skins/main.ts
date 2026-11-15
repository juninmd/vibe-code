// Prototype: every avatar skin on every environment. Bundled with:
//   bun build main.ts --outfile bundle.js --target browser
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createCharacter } from "../../../packages/web/src/components/office3d/character";
import { ENVIRONMENTS, type EnvironmentId, createEnvironment, isEnvironment } from "../../../packages/web/src/components/office3d/environments";
import { AVATAR_SKINS, applyAvatarSkin } from "../../../packages/web/src/components/office3d/skins";
import { createDeskSet, createScreen } from "../../../packages/web/src/components/office3d/station";

const params = new URLSearchParams(location.search);
const envParam = params.get("env");
let envId: EnvironmentId = isEnvironment(envParam) ? envParam : "office";

const canvas = document.getElementById("c") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
const hemi = new THREE.HemisphereLight();
const sun = new THREE.DirectionalLight();
sun.position.set(6, 12, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, far: 40 });
scene.add(hemi, sun);

const ACCENTS = ["#d97757", "#2dd4bf", "#8b5cf6", "#38bdf8", "#f472b6", "#facc15"];
const COLS = 3;
const stations = new THREE.Group();
scene.add(stations);
AVATAR_SKINS.forEach((s, i) => {
  const accent = ACCENTS[i % ACCENTS.length] as string;
  const root = new THREE.Group();
  const ch = createCharacter({ label: s.label.slice(0, 2).toUpperCase(), accent, hair: "#3b2418", bun: i % 2 === 0 });
  applyAvatarSkin(ch, s.id, accent);
  ch.head.rotation.y = 0.5;
  const screen = createScreen(accent, i);
  root.add(ch.group, createDeskSet(screen, accent));
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  root.position.set((col - 1) * 4.4, 0, row * 4.2 - 2.1);
  stations.add(root);
  (root.userData as { screen?: unknown }).screen = screen;
});

let env = createEnvironment(envId, scene);
function useEnv(id: EnvironmentId) {
  env.dispose();
  envId = id;
  env = createEnvironment(id, scene);
  const t = env.theme;
  scene.background = new THREE.Color(t.background);
  scene.fog = new THREE.Fog(...t.fog);
  hemi.color.set(t.hemi[0]);
  hemi.groundColor.set(t.hemi[1]);
  hemi.intensity = t.hemi[2];
  sun.color.set(t.sun[0]);
  sun.intensity = t.sun[1];
  env.room.fit(COLS * 4.4 + 5, 2 * 4.2 + 3, 0);
}
useEnv(envId);
camera.position.set(13, 9, 11);
controls.target.set(0, 1, 0);

const bar = document.getElementById("bar") as HTMLElement;
for (const e of ENVIRONMENTS) {
  const b = document.createElement("button");
  b.textContent = e.label;
  b.onclick = () => useEnv(e.id);
  bar.append(b);
}
const resize = () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener("resize", resize);
resize();
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  env.room.update(t);
  for (const root of stations.children) {
    (root.userData.screen as { draw: (t: number, a: boolean) => void }).draw(t, true);
  }
  controls.update();
  renderer.render(scene, camera);
});
(window as unknown as { ready: boolean }).ready = true;
