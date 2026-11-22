const mat = (color, roughness = 0.5, metalness = 0.1, extra = {}) => {
  const physical = (extra.clearcoat > 0) || (extra.transmission > 0) || (extra.sheen > 0);
  const Ctor = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  return new Ctor({ color, roughness, metalness, ...extra });
};
const phys = (color, roughness, metalness, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness, metalness, ...extra });

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function procTex(w, h, seed, paint, { color = false, repeat = [1, 1] } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const img = g.createImageData(w, h);
  paint(img.data, w, h, mulberry32(seed));
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(repeat[0], repeat[1]);
  return tex;
}
function put(data, i, r, g, b, a = 255) {
  data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
}

// Brushed metal roughness map (near-white so it modulates material.roughness)
const brushRough = procTex(512, 512, 7, (data, w, h, rnd) => {
  for (let y = 0; y < h; y++) {
    const line = 225 + Math.floor(rnd() * 30);
    for (let x = 0; x < w; x++) {
      const v = Math.max(0, Math.min(255, line + Math.floor((rnd() - 0.5) * 28)));
      put(data, (y * w + x) * 4, v, v, v);
    }
  }
}, { repeat: [4, 4] });

// Industrial conveyor belt fabric weave
const beltFabric = procTex(256, 256, 21, (data, w, h, rnd) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const warp = (x % 4) < 2;
    const weft = (y % 4) < 2;
    const base = warp === weft ? 236 : 210;
    const v = Math.max(0, Math.min(255, base + Math.floor((rnd() - 0.5) * 14)));
    put(data, (y * w + x) * 4, v, v, v);
  }
}, { color: true, repeat: [12, 4] });

// Concrete/epoxy floor speckle
const epoxyMap = procTex(256, 256, 31, (data, w, h, rnd) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = rnd();
    const speck = n > 0.92 ? 36 : n < 0.04 ? -28 : Math.floor((rnd() - 0.5) * 14);
    const v = Math.max(0, Math.min(255, 232 + speck));
    put(data, (y * w + x) * 4, v, v, v);
  }
}, { color: true, repeat: [20, 20] });

// Hazard yellow/black floor tape
const tapeMap = procTex(128, 128, 41, (data, w, h) => {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const stripe = (Math.floor((x + y) / 16) & 1) === 0;
    if (stripe) put(data, (y * w + x) * 4, 240, 196, 0);
    else put(data, (y * w + x) * 4, 20, 20, 20);
  }
}, { color: true, repeat: [2, 2] });

// Welded wire mesh texture for guard panels (alpha cutout)
const wireMeshTex = (() => {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 64, 64);
  g.fillStyle = "#262a30";
  g.fillRect(0, 0, 64, 5);
  g.fillRect(0, 0, 5, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

function floorIsDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

const brushed = { roughnessMap: brushRough };
const stainlessBrushed = phys(0xc8cacc, 0.30, 1, brushed);

const M = {
  aluClear: phys(0xc9ccd0, 0.40, 1),
  aluBlasted: phys(0xbcc0c6, 0.55, 1),
  aluDark: phys(0x202328, 0.45, 0.45),
  aluMachined: phys(0xd4d8de, 0.28, 0.95, brushed),
  stainlessBrushed,
  steel: phys(0xd2d6db, 0.18, 1),
  chrome: phys(0xeceef0, 0.08, 1),
  zinc9006: phys(0xa5a8a6, 0.5, 0.8),
  galv: phys(0xb4b8bb, 0.45, 0.9),
  cabinet: phys(0x3a4048, 0.42, 0.65, brushed),
  pedestalSteel: phys(0x2f353d, 0.45, 0.60),
  blackPlastic: phys(0x16181c, 0.65, 0),
  blackRubber: phys(0x141518, 0.85, 0),
  whitePOM: phys(0xf2f1ec, 0.50, 0),
  sealBlack: phys(0x111214, 0.80, 0),
  pcClear: phys(0xb8c8d4, 0.06, 0, {
    transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide,
    clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2,
  }),
  wireMeshBase: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: wireMeshTex,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.55,
    metalness: 0.6,
  }),
  beltDark: phys(0x34433f, 0.78, 0, { map: beltFabric }),
  motorBlack: phys(0x181a1e, 0.50, 0.25),
  gearboxSilver: phys(0xb8bcc0, 0.35, 0.90),
  floor: phys(floorIsDark() ? 0x2b2e33 : 0xa5aab0, 0.86, 0.02, { map: epoxyMap }),
  tape: phys(0xffffff, 0.60, 0, { map: tapeMap }),
  warnYellow: new THREE.MeshBasicMaterial({ color: 0xf0b400, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }),
  warnRing: new THREE.MeshBasicMaterial({ color: 0xe6a800, side: THREE.DoubleSide }),
  protectRed: new THREE.MeshBasicMaterial({ color: 0xd83028, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  protectRing: new THREE.MeshBasicMaterial({ color: 0xd83028, side: THREE.DoubleSide }),
  curtainYellow: phys(0xf2be00, 0.35, 0.15, { clearcoat: 0.4, clearcoatRoughness: 0.3 }),
  curtainBeam: new THREE.MeshBasicMaterial({ color: 0xff9800, transparent: true, opacity: 0.38, depthWrite: false }),
  scannerYellow: phys(0xf2be00, 0.40, 0.1),
  fanucYellow: phys(0xf5b800, 0.34, 0.12, { clearcoat: 0.5, clearcoatRoughness: 0.25 }),
  urBlue: phys(0x4a8ec2, 0.38, 0.20, { clearcoat: 0.35, clearcoatRoughness: 0.30 }),
  urGrey: phys(0xc8cdd2, 0.36, 0.85),
  urDark: phys(0x23272d, 0.50, 0.20),
  housingAlu: phys(0xd0d5dc, 0.30, 0.92, brushed),
  coverSlate: phys(0x2c3643, 0.40, 0.55),
  screwSteel: phys(0x282c32, 0.28, 0.90),
  trayPOM: phys(0x242830, 0.58, 0.05),
  binRed: phys(0xa82e2a, 0.45, 0.08),
  fixtureBlue: phys(0x255a8a, 0.42, 0.40),
  lampRed: phys(0x5a1010, 0.4, 0, { emissive: 0xff2a2a, emissiveIntensity: 0 }),
  lampAmber: phys(0x5a3a08, 0.4, 0, { emissive: 0xffb020, emissiveIntensity: 0 }),
  lampGreen: phys(0x0d4a1a, 0.4, 0, { emissive: 0x3dff6a, emissiveIntensity: 0 }),
  estopRed: phys(0xc0201a, 0.4, 0),
  estopYellow: phys(0xf2c400, 0.5, 0),
  screen: phys(0x0b0d10, 0.3, 0, { emissive: 0xffffff, emissiveIntensity: 0 }),
  lens: mat(0x111316, 0.20, 0.30),
  glass: new THREE.MeshPhysicalMaterial({ color: 0xd8e6ee, roughness: 0.05, transparent: true, opacity: 0.16, depthWrite: false }),
};

function makeWireMeshMat(w, h) {
  const m = M.wireMeshBase.clone();
  const tex = wireMeshTex.clone();
  tex.repeat.set(Math.max(1, Math.round(w / 0.038)), Math.max(1, Math.round(h / 0.038)));
  tex.needsUpdate = true;
  m.map = tex;
  return m;
}

function applyFloorTheme() {
  M.floor.color.set(floorIsDark() ? 0x2b2e33 : 0x9fa5ac);
}
window.addEventListener("themechange", applyFloorTheme);
