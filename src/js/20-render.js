import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import * as BufferGeometryUtils from "three/addons/utils/BufferGeometryUtils.js";

const $ = (id) => document.getElementById(id);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

// ================================================================ scene (Y-up, SPEC.md §2)
const viewport = $("viewport");
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.domElement.classList.add("main");
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.02, 40);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.4;
controls.maxDistance = 9.0;

// Default view (overridden by 50-views.js when present)
camera.position.set(2.15, 3.75, 5.45);
controls.target.set(-0.12, 0.87, 0.48);
controls.update();

// Studio 3-point + hemisphere lighting in Y-up scene space
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a837e, 0.28);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff5ea, 2.4);
sun.position.set(2.4, 4.2, 2.8);
sun.target.position.set(0.0, 0.70, 0.25);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.radius = 3.5;
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.002;
Object.assign(sun.shadow.camera, { left: -2.6, right: 2.6, top: 2.6, bottom: -2.6, near: 0.5, far: 11 });
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

const fillL = new THREE.DirectionalLight(0xdce6ff, 0.50);
fillL.position.set(-2.6, 2.0, -1.8);
scene.add(fillL);

const rimL = new THREE.DirectionalLight(0xffffff, 0.65);
rimL.position.set(-0.8, 2.8, 3.2);
scene.add(rimL);

// Y-up world root directly matching SPEC.md §2 (x = flow, y = up, z = operator aisle)
const world = new THREE.Group();
scene.add(world);

// Room environment (no external HDR)
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
pmrem.dispose();
const roomGeos = new Set(), roomMats = new Set();
room.traverse((o) => {
  if (o.geometry) roomGeos.add(o.geometry);
  const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
  list.forEach((m) => roomMats.add(m));
});
roomGeos.forEach((g) => g.dispose());
roomMats.forEach((m) => m.dispose());

function themeIsDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function syncSceneTheme() {
  const top = new THREE.Color(css("--scene-top") || "#f7f8fa");
  const bottom = new THREE.Color(css("--scene-bottom") || "#dfe3e8");
  const c = document.createElement("canvas");
  c.width = 2; c.height = 256;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 256);
  gr.addColorStop(0, "#" + top.getHexString());
  gr.addColorStop(1, "#" + bottom.getHexString());
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (scene.background && scene.background.dispose) scene.background.dispose();
  scene.background = tex;

  if (!scene.fog) scene.fog = new THREE.Fog(bottom.clone(), 8, 22);
  else scene.fog.color.copy(bottom);
  scene.environmentIntensity = themeIsDark() ? 0.55 : 0.75;
}
syncSceneTheme();
window.addEventListener("themechange", syncSceneTheme);

// Post-processing composer (MSAA + GTAO + OutputPass)
function viewSize() {
  return { w: Math.max(1, viewport.clientWidth), h: Math.max(1, viewport.clientHeight) };
}
const view0 = viewSize();
const dpr0 = Math.min(devicePixelRatio || 1, 2);
renderer.setPixelRatio(dpr0);
renderer.setSize(view0.w, view0.h, false);
camera.aspect = view0.w / view0.h;
camera.updateProjectionMatrix();

const composerTarget = new THREE.WebGLRenderTarget(Math.floor(view0.w * dpr0), Math.floor(view0.h * dpr0), {
  type: THREE.HalfFloatType,
  samples: 4,
});
const composer = new EffectComposer(renderer, composerTarget);
composer.setSize(view0.w, view0.h);
const gtao = new GTAOPass(scene, camera, view0.w, view0.h);
gtao.updateGtaoMaterial({ radius: 0.18, distanceExponent: 1.5, thickness: 1.5, scale: 1.0, samples: 12 });
gtao.blendIntensity = 0.80;
composer.addPass(new RenderPass(scene, camera));
composer.addPass(gtao);
composer.addPass(new OutputPass());

function fitComposer() {
  const { w, h } = viewSize();
  const dpr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
}
new ResizeObserver(fitComposer).observe(viewport);

function writeHqBox(on) {
  const boxEl = $("hq");
  if (boxEl) boxEl.checked = on;
}
let hq = true;
function shadowMapSize(px) {
  sun.shadow.mapSize.set(px, px);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}
function setQuality(on) {
  hq = !!on;
  try { localStorage.setItem("fanuc-ur-hq", hq ? "1" : "0"); } catch (e) {}
  gtao.enabled = hq;
  shadowMapSize(hq ? 4096 : 2048);
  renderer.setPixelRatio(hq ? Math.min(devicePixelRatio || 1, 2) : 1);
  fitComposer();
  writeHqBox(hq);
  return hq;
}
function storedHq() {
  try {
    const v = localStorage.getItem("fanuc-ur-hq");
    if (v === "0" || v === "1") return v === "1";
  } catch (e) {}
  return null;
}
function autoHq() {
  if (matchMedia("(pointer: coarse)").matches) return false;
  if (viewport.clientWidth > 0 && viewport.clientWidth < 900) return false;
  return true;
}
setQuality(storedHq() !== null ? storedHq() : autoHq());
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t && t.id === "hq") setQuality(t.checked);
});

let rendering = false;
let profilesArmed = false;
let watchT0 = 0, watchLast = 0, watchSum = 0, watchN = 0, watchDone = false;
function noteFrameTime() {
  if (watchDone) return;
  const now = performance.now();
  if (watchT0 === 0) { watchT0 = watchLast = now; return; }
  watchSum += now - watchLast;
  watchN += 1;
  watchLast = now;
  if (now - watchT0 < 3000) return;
  watchDone = true;
  const avg = watchN ? watchSum / watchN : 0;
  const tripped = avg > 28 && hq;
  if (tripped) setQuality(false);
  window.__hqStats = { avgMs: avg, tripped };
}
function renderFrame() {
  if (!profilesArmed) { profilesArmed = true; finalizeProfiles(); }
  if (rendering) return;
  rendering = true;
  try { composer.render(); }
  finally { rendering = false; }
  noteFrameTime();
}
window.setQuality = setQuality;
