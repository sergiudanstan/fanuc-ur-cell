// Guard fence (40x40 slot-8 aluminium, wire mesh & polycarbonate panels), fixture light curtain,
// safety laser scanner & floor zones, stack light, and HMI console (Y-up, SPEC.md §2).
const F = CELL.fence;
const HALF = 0.02;

// ---------------------------------------------------------------- floor & cell perimeter
const floorMat = M.floor.clone();
const floor = mesh(new THREE.PlaneGeometry(16, 16), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = 0;
floor.castShadow = false;
floor.receiveShadow = true;

function toneFloor() {
  floorMat.color.set(floorIsDark() ? 0x2b2e33 : 0xa3a9b0);
  floorMat.roughness = 0.86;
  floorMat.metalness = 0.02;
}
window.addEventListener("themechange", () => queueMicrotask(toneFloor));
queueMicrotask(toneFloor);

// Hazard tape framing the guarded zone & collaborative workspace
function floorTape(x, z, w, d) {
  const o = mesh(new THREE.PlaneGeometry(w, d), M.tape);
  o.rotation.x = -Math.PI / 2;
  o.position.set(x, 0.0015, z);
  o.castShadow = false;
  o.receiveShadow = true;
  return o;
}
const tx0 = F.x0 - 0.14, tx1 = F.x1 + 0.14, tz0 = F.z0 - 0.14, tz1 = 1.52;
const tw = 0.05;
floorTape((tx0 + tx1) / 2, tz0, tx1 - tx0 + tw, tw);
floorTape((tx0 + tx1) / 2, tz1, tx1 - tx0 + tw, tw);
floorTape(tx0, (tz0 + tz1) / 2, tw, tz1 - tz0 - tw);
floorTape(tx1, (tz0 + tz1) / 2, tw, tz1 - tz0 - tw);

// ---------------------------------------------------------------- safety scanner floor zones (CELL.scanner)
const SC = CELL.scanner;
function addScannerZone(radius, fillMat, ringMat, yOffset) {
  const dz = Math.max(-radius, F.z1 - SC.center[1]);
  const alpha = Math.asin(clamp(-dz / radius, -1, 1));
  const thetaStart = Math.PI - alpha;
  const thetaLen = Math.PI + 2 * alpha;

  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius - 0.03, 72, thetaStart, thetaLen), fillMat);
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(SC.center[0], yOffset, SC.center[1]);
  disc.receiveShadow = true;
  world.add(disc);

  const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.032, radius, 84, 1, thetaStart, thetaLen), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SC.center[0], yOffset + 0.0004, SC.center[1]);
  world.add(ring);
}
addScannerZone(SC.warn, M.warnYellow, M.warnRing, 0.002);
addScannerZone(SC.protect, M.protectRed, M.protectRing, 0.003);

// Safety laser scanner mounted on front edge of the UR table (facing +z operator aisle)
const scannerGroup = new THREE.Group();
scannerGroup.position.set(SC.center[0], 0.74, 1.435);
world.add(scannerGroup);
rbox(0.112, 0.020, 0.060, 0.002, M.aluDark, 0, -0.015, -0.020, scannerGroup);
rbox(0.102, 0.056, 0.096, 0.006, M.scannerYellow, 0, 0.020, 0.010, scannerGroup);
rbox(0.096, 0.044, 0.088, 0.004, M.blackPlastic, 0, 0.064, 0.010, scannerGroup);
const scanWindow = vcyl(0.040, 0.032, M.lens, 0, 0.064, 0.020, 28, scannerGroup);
scanWindow.scale.set(1.1, 1, 0.85);
// Subtle horizontal laser scan fan near floor level
const scanFan = new THREE.Mesh(
  new THREE.CircleGeometry(SC.protect, 48, Math.PI * 1.15, Math.PI * 0.70),
  new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false })
);
scanFan.rotation.x = -Math.PI / 2;
scanFan.position.set(SC.center[0], 0.08, 1.44);
world.add(scanFan);

// ---------------------------------------------------------------- brackets & extrusion helpers
function bracketGeometry(mirror) {
  const upright = new RoundedBoxGeometry(0.016, 0.040, 0.004, 2, 0.0008);
  upright.translate(0.008, 0.020, 0.002);
  const arm = new RoundedBoxGeometry(0.035, 0.016, 0.004, 2, 0.0008);
  arm.translate(0.0175, 0.008, 0.002);
  const rib = new RoundedBoxGeometry(0.020, 0.0035, 0.003, 2, 0.0004);
  rib.rotateZ(-Math.PI / 4);
  rib.translate(0.014, 0.014, 0.002);
  const geo = BufferGeometryUtils.mergeGeometries([upright, arm, rib]);
  if (mirror) { geo.scale(1, 1, -1); geo.computeVertexNormals(); }
  return geo;
}
const BRACKET_CAP = 200;
function makeBrackets(mirror) {
  const o = new THREE.InstancedMesh(bracketGeometry(mirror), M.zinc9006, BRACKET_CAP);
  o.count = 0;
  o.castShadow = o.receiveShadow = true;
  o.frustumCulled = false;
  world.add(o);
  return o;
}
const brackets = makeBrackets(false);
const bracketsMir = makeBrackets(true);
const _bQ = new THREE.Quaternion();
const _bM = new THREE.Matrix4();
const _bS = new THREE.Vector3(1, 1, 1);
let bracketsFull = false;

function putBracket(pool, origin, quat) {
  if (pool.count >= BRACKET_CAP) { if (!bracketsFull) { bracketsFull = true; console.warn("brackets: capacity", BRACKET_CAP); } return; }
  _bM.compose(origin, quat, _bS);
  pool.setMatrixAt(pool.count++, _bM);
}
function boltAt(origin, quat, lx, ly, lz, nx, ny, nz) {
  addBolt(V(lx, ly, lz).applyQuaternion(quat).add(origin), V(nx, ny, nz).applyQuaternion(quat));
}
function addJointBracket(x, z, yBottom, along, proud) {
  const dir = along.clone();
  if (dir.lengthSq() < 1e-8) return;
  dir.normalize();
  const up = V(0, 1, 0);
  const thick = V().crossVectors(dir, up).normalize();
  const out = V(dir.z, 0, -dir.x);
  if (out.x * x + out.z * (z - (F.z0 + F.z1) / 2) < 0) out.negate();
  const mirror = thick.dot(out) < 0;
  _bQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, thick));
  const origin = V(x, yBottom, z).addScaledVector(dir, -0.016).addScaledVector(out, 0.0195 + (proud || 0));
  putBracket(mirror ? bracketsMir : brackets, origin, _bQ);
  const sz = mirror ? -1 : 1;
  boltAt(origin, _bQ, 0.009, 0.028, sz * 0.004, 0, 0, sz);
  boltAt(origin, _bQ, 0.026, 0.008, sz * 0.004, 0, 0, sz);
}

function hRail(x0, z0, x1, z1, yc, proud = 0) {
  profileBeam(V(x0, yc, z0), V(x1, yc, z1));
  const dx = x1 - x0, dz = z1 - z0;
  addJointBracket(x0, z0, yc - HALF, V(dx, 0, dz), proud);
  addJointBracket(x1, z1, yc - HALF, V(-dx, 0, -dz), proud);
}

function endPlug(x, y, z, dir) {
  const n = dir.clone().normalize();
  const o = rbox(0.036, 0.036, 0.004, 0.001, M.blackPlastic, 0, 0, 0);
  o.quaternion.setFromUnitVectors(V(0, 0, 1), n);
  o.position.set(x, y, z).addScaledVector(n, 0.001);
  return o;
}

function addPost(x, z, h = F.h) {
  profileBeam(V(x, 0.012, z), V(x, h, z));
  endPlug(x, h, z, V(0, 1, 0));
  rbox(0.088, 0.008, 0.088, 0.0015, M.aluDark, x, 0.008, z);
  for (const sx of [-0.030, 0.030]) for (const sz of [-0.030, 0.030]) {
    addBolt(V(x + sx, 0.012, z + sz), UP);
  }
}

// ---------------------------------------------------------------- guard fence (CELL.fence)
const guardPanels = [];
Object.defineProperty(guardPanels, "visible", {
  get() { return guardPanels.every((o) => o.visible); },
  set(v) { for (const o of guardPanels) o.visible = v; },
});

function addPcPanel(w, h, thickX, x, y, z, rotY = 0) {
  const sx = thickX ? 0.006 : w;
  const sz = thickX ? w : 0.006;
  const o = rbox(sx, h, sz, 0.001, M.pcClear, x, y, z);
  o.castShadow = false;
  o.receiveShadow = false;
  if (rotY) o.rotation.y = rotY;
  guardPanels.push(o);
  // Black EPDM gasket trim
  const gx = thickX ? 0.008 : w - 0.004;
  const gz = thickX ? w - 0.004 : 0.008;
  for (const sy of [-1, 1]) {
    const b = rbox(gx, 0.007, gz, 0.0006, M.sealBlack, x, y + sy * (h / 2 - 0.003), z);
    b.castShadow = false;
    guardPanels.push(b);
  }
  return o;
}

function addMeshPanel(w, h, alongZ, x, y, z) {
  const matMesh = makeWireMeshMat(w, h);
  const geo = new THREE.PlaneGeometry(w, h);
  const o = mesh(geo, matMesh);
  o.position.set(x, y, z);
  if (alongZ) o.rotation.y = Math.PI / 2;
  o.castShadow = false;
  guardPanels.push(o);
  return o;
}

// Posts around perimeter
const backPostsX = [F.x0, 0.0, F.x1];
const frontPostsX = [F.x0, -0.35, 0.35, F.x1];
const leftPostsZ = [F.z0, -0.35, F.z1];
const rightPostsZ = [F.z0, -0.15, F.z1];

const postSeen = new Set();
function ensurePost(x, z) {
  const key = `${x.toFixed(3)},${z.toFixed(3)}`;
  if (postSeen.has(key)) return;
  postSeen.add(key);
  addPost(x, z, F.h);
}
for (const x of backPostsX) ensurePost(x, F.z0);
for (const x of frontPostsX) ensurePost(x, F.z1);
for (const z of leftPostsZ) ensurePost(F.x0, z);
for (const z of rightPostsZ) ensurePost(F.x1, z);

const INSET = HALF - 0.003;

// Back wall (z = F.z0): full height wire mesh below + polycarbonate above
for (let i = 0; i < backPostsX.length - 1; i++) {
  const xa = backPostsX[i] + INSET, xb = backPostsX[i + 1] - INSET;
  const cx = (xa + xb) / 2, w = xb - xa - 0.006;
  hRail(xa, F.z0, xb, F.z0, 0.08);
  hRail(xa, F.z0, xb, F.z0, 1.05);
  hRail(xa, F.z0, xb, F.z0, F.h - HALF);
  addMeshPanel(w, 0.93, false, cx, 0.565, F.z0);
  addPcPanel(w, 0.89, false, cx, 1.515, F.z0);
}

// Left wall (x = F.x0): infeed conveyor pass-through at z = -0.60, y = 0.72..1.05
{
  const zBack = leftPostsZ[0] + INSET, zMid = leftPostsZ[1] - INSET;
  const zMid2 = leftPostsZ[1] + INSET, zFront = leftPostsZ[2] - INSET;
  // Bay 1 (z = -0.95..-0.35): accommodates infeed belt (z = -0.60, width = 0.30 -> -0.75..-0.45)
  hRail(F.x0, zBack, F.x0, zMid, 0.08);
  hRail(F.x0, zBack, F.x0, zMid, 0.70);
  hRail(F.x0, zBack, F.x0, zMid, 1.05);
  hRail(F.x0, zBack, F.x0, zMid, F.h - HALF);
  addMeshPanel(zMid - zBack - 0.006, 0.58, true, F.x0, 0.39, (zBack + zMid) / 2);
  addPcPanel(zMid - zBack - 0.006, 0.89, true, F.x0, 1.515, (zBack + zMid) / 2);
  // Bay 2 (z = -0.35..+0.30)
  hRail(F.x0, zMid2, F.x0, zFront, 0.08);
  hRail(F.x0, zMid2, F.x0, zFront, 1.05);
  hRail(F.x0, zMid2, F.x0, zFront, F.h - HALF);
  addMeshPanel(zFront - zMid2 - 0.006, 0.93, true, F.x0, 0.565, (zMid2 + zFront) / 2);
  addPcPanel(zFront - zMid2 - 0.006, 0.89, true, F.x0, 1.515, (zMid2 + zFront) / 2);
}

// Right wall (x = F.x1): outfeed conveyor pass-through at z = -0.40, y = 0.72..1.05
{
  const zBack = rightPostsZ[0] + INSET, zMid = rightPostsZ[1] - INSET;
  const zMid2 = rightPostsZ[1] + INSET, zFront = rightPostsZ[2] - INSET;
  // Bay 1 (z = -0.95..-0.15): accommodates outfeed belt (z = -0.40, width = 0.30 -> -0.55..-0.25)
  hRail(F.x1, zBack, F.x1, zMid, 0.08);
  hRail(F.x1, zBack, F.x1, zMid, 0.70);
  hRail(F.x1, zBack, F.x1, zMid, 1.05);
  hRail(F.x1, zBack, F.x1, zMid, F.h - HALF);
  addMeshPanel(zMid - zBack - 0.006, 0.58, true, F.x1, 0.39, (zBack + zMid) / 2);
  addPcPanel(zMid - zBack - 0.006, 0.89, true, F.x1, 1.515, (zBack + zMid) / 2);
  // Bay 2 (z = -0.15..+0.30)
  hRail(F.x1, zMid2, F.x1, zFront, 0.08);
  hRail(F.x1, zMid2, F.x1, zFront, 1.05);
  hRail(F.x1, zMid2, F.x1, zFront, F.h - HALF);
  addMeshPanel(zFront - zMid2 - 0.006, 0.93, true, F.x1, 0.565, (zMid2 + zFront) / 2);
  addPcPanel(zFront - zMid2 - 0.006, 0.89, true, F.x1, 1.515, (zMid2 + zFront) / 2);
}

// Front wall (z = F.z1 = 0.30):
// - Left bay [-1.00, -0.35]: lower opening below y = 0.70 clears reject bin at [-0.45, 0.65, 0.20]
{
  const xa = frontPostsX[0] + INSET, xb = frontPostsX[1] - INSET;
  const cx = (xa + xb) / 2, w = xb - xa - 0.006;
  hRail(xa, F.z1, xb, F.z1, 0.70);
  hRail(xa, F.z1, xb, F.z1, 1.05);
  hRail(xa, F.z1, xb, F.z1, F.h - HALF);
  addMeshPanel(w, 0.31, false, cx, 0.875, F.z1);
  addPcPanel(w, 0.89, false, cx, 1.515, F.z1);
}
// - Center bay [-0.35, +0.35]: Fixture Window + Safety Light Curtain!
{
  const xa = frontPostsX[1] + INSET, xb = frontPostsX[2] - INSET;
  const cx = (xa + xb) / 2, w = xb - xa - 0.006;
  const winY0 = 0.77, winY1 = 1.65;
  hRail(xa, F.z1, xb, F.z1, 0.08);
  hRail(xa, F.z1, xb, F.z1, winY0 - HALF);
  hRail(xa, F.z1, xb, F.z1, winY1 + HALF);
  hRail(xa, F.z1, xb, F.z1, F.h - HALF);
  // Lower wire mesh below fixture window, upper polycarbonate transom above
  addMeshPanel(w, winY0 - 0.14, false, cx, (0.10 + winY0 - 0.04) / 2, F.z1);
  addPcPanel(w, F.h - winY1 - 0.08, false, cx, (winY1 + 0.04 + F.h - 0.04) / 2, F.z1);

  // Light curtain emitter & receiver columns inside the fixture window
  const lcY0 = winY0 + 0.01, lcY1 = winY1 - 0.01, lcH = lcY1 - lcY0, lcYc = (lcY0 + lcY1) / 2;
  for (const sg of [-1, 1]) {
    const lx = sg * 0.312;
    rbox(0.032, lcH, 0.036, 0.003, M.curtainYellow, lx, lcYc, F.z1);
    rbox(0.012, lcH - 0.04, 0.010, 0.001, M.blackPlastic, lx - sg * 0.012, lcYc, F.z1);
    // Mounting brackets to adjacent posts
    for (const by of [lcY0 + 0.04, lcY1 - 0.04]) {
      rbox(0.025, 0.024, 0.026, 0.002, M.zinc9006, sg * 0.33, by, F.z1);
    }
    // Status LED cap on top
    rbox(0.034, 0.016, 0.038, 0.002, M.blackPlastic, lx, lcY1 + 0.008, F.z1);
  }
  // Optical safety curtain beams across the fixture opening
  const beamPts = [];
  const nBeams = 12;
  for (let i = 0; i < nBeams; i++) {
    const by = lerp(lcY0 + 0.04, lcY1 - 0.04, i / (nBeams - 1));
    beamPts.push(-0.295, by, F.z1, 0.295, by, F.z1);
  }
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute("position", new THREE.Float32BufferAttribute(beamPts, 3));
  const beams = new THREE.LineSegments(beamGeo, M.curtainBeam);
  world.add(beams);
}
// - Right bay [+0.35, +1.00]:
{
  const xa = frontPostsX[2] + INSET, xb = frontPostsX[3] - INSET;
  const cx = (xa + xb) / 2, w = xb - xa - 0.006;
  hRail(xa, F.z1, xb, F.z1, 0.08);
  hRail(xa, F.z1, xb, F.z1, 1.05);
  hRail(xa, F.z1, xb, F.z1, F.h - HALF);
  addMeshPanel(w, 0.93, false, cx, 0.565, F.z1);
  addPcPanel(w, 0.89, false, cx, 1.515, F.z1);
}

// ---------------------------------------------------------------- stack light on front-right post
const stackLamps = { red: M.lampRed, amber: M.lampAmber, green: M.lampGreen };
function stackTurn(r, y0, y1, material) {
  const c = Math.min(0.001, (y1 - y0) / 4, r / 3);
  const o = lathe([[0, y0], [r - c, y0], [r, y0 + c], [r, y1 - c], [r - c, y1], [0, y1]], material);
  o.position.set(F.x1, 0, F.z1);
  return o;
}
let stackY = F.h + 0.004;
stackTurn(0.034, stackY, stackY + 0.032, M.blackPlastic); stackY += 0.032;
stackTurn(0.012, stackY, stackY + 0.140, M.blackPlastic); stackY += 0.140;
stackTurn(0.030, stackY, stackY + 0.048, stackLamps.green); stackY += 0.048;
stackTurn(0.030, stackY, stackY + 0.048, stackLamps.amber); stackY += 0.048;
stackTurn(0.030, stackY, stackY + 0.048, stackLamps.red); stackY += 0.048;
stackTurn(0.032, stackY, stackY + 0.024, M.blackPlastic);
// Default amber standby glow until live loop takes over
stackLamps.amber.emissiveIntensity = 1.2;

function mushroom(parent, x, y, z, axis) {
  const g = new THREE.Group();
  parent.add(g);
  g.position.set(x, y, z);
  g.quaternion.setFromUnitVectors(UP, axis.clone().normalize());
  lathe([[0, -0.001], [0.028, -0.001], [0.030, 0.001], [0.030, 0.004], [0.026, 0.0055], [0, 0.0055]], M.estopYellow, g);
  lathe([[0, 0.0055], [0.015, 0.0055], [0.019, 0.0085], [0.019, 0.015], [0.011, 0.0175], [0, 0.017]], M.estopRed, g);
  return g;
}

// ---------------------------------------------------------------- HMI console on front-left post
const hmiRoot = new THREE.Group();
hmiRoot.position.set(-1.10, 1.38, 0.44);
hmiRoot.rotation.y = 0.34;
world.add(hmiRoot);

rbox(0.40, 0.29, 0.056, 0.005, M.aluDark, 0, 0, 0, hmiRoot);
const hmiCanvas = document.createElement("canvas");
hmiCanvas.width = 512;
hmiCanvas.height = 384;
const hmiTexture = new THREE.CanvasTexture(hmiCanvas);
hmiTexture.colorSpace = THREE.SRGBColorSpace;
const hmiScreen = { canvas: hmiCanvas, texture: hmiTexture };

{
  const g = hmiCanvas.getContext("2d");
  g.fillStyle = "#12171e";
  g.fillRect(0, 0, 512, 384);
  g.fillStyle = "#f5b800";
  g.font = "700 32px system-ui, sans-serif";
  g.fillText("FANUC + UR5e CELL", 26, 54);
  g.fillStyle = "#58a6ff";
  g.font = "600 26px system-ui, sans-serif";
  g.fillText("STANDBY · INTERLOCK OK", 26, 102);
  g.fillStyle = "#d8e0ea";
  g.font = "500 24px ui-monospace, monospace";
  g.fillText("INFEED   0.10 m/s", 26, 168);
  g.fillText("FIXTURE  MUTEX READY", 26, 212);
  g.fillText("SCANNER  WARN 1.20 m", 26, 256);
  g.fillText("TRAYS    2 x (2 x 3)", 26, 300);
  hmiTexture.needsUpdate = true;
}

const screenMat = M.screen.clone();
screenMat.map = hmiTexture;
screenMat.emissiveMap = hmiTexture;
screenMat.emissiveIntensity = 0.26;
const hmiFace = mesh(new THREE.PlaneGeometry(0.24, 0.18), screenMat, hmiRoot);
hmiFace.castShadow = false;
hmiFace.position.set(0, 0.036, 0.029);

mushroom(hmiRoot, -0.09, -0.09, 0.028, V(0, 0, 1));
for (const [bx, bm] of [[0.02, M.lampGreen], [0.065, M.whitePOM]]) {
  const g = new THREE.Group();
  hmiRoot.add(g);
  g.position.set(bx, -0.09, 0.028);
  g.quaternion.setFromUnitVectors(UP, V(0, 0, 1));
  lathe([[0, 0], [0.010, 0], [0.012, 0.001], [0.012, 0.006], [0.007, 0.009], [0, 0.009]], bm, g);
}

// Mounting arm from front-left post to HMI enclosure
function armJoint(p) {
  const o = mesh(new THREE.SphereGeometry(0.030, 18, 12), M.zinc9006);
  o.position.copy(p);
  return o;
}
function armTube(a, b) {
  const d = b.clone().sub(a);
  const len = d.length();
  const o = lathe([[0, 0], [0.022, 0], [0.023, 0.001], [0.023, len - 0.001], [0.022, len], [0, len]], M.aluBlasted);
  o.position.copy(a);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
  return o;
}
const hmiPivot = V(F.x0 - 0.02, 1.38, F.z1);
const hmiElbow = V(F.x0 - 0.10, 1.38, F.z1 + 0.08);
hmiRoot.updateMatrixWorld(true);
const hmiBack = V(0, 0, -0.032).applyQuaternion(hmiRoot.quaternion).add(hmiRoot.position);
armJoint(hmiPivot);
armJoint(hmiElbow);
armJoint(hmiBack);
armTube(hmiPivot, hmiElbow);
armTube(hmiElbow, hmiBack);

// Safety sign on front-right bay
const warnSign = labelPlane("COBOT ZONE · SCANNER ACTIVE", 0.40, 0.085, { bg: "#f2be00", fg: "#14161a", font: "700 28px system-ui, sans-serif", px: 128 });
warnSign.position.set(0.675, 1.24, F.z1 + 0.006);
world.add(warnSign);
guardPanels.push(warnSign);

brackets.instanceMatrix.needsUpdate = true;
bracketsMir.instanceMatrix.needsUpdate = true;
