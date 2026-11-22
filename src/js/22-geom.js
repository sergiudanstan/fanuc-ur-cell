function mesh(geo, m, parent = world) {
  const o = new THREE.Mesh(geo, m);
  o.castShadow = o.receiveShadow = true;
  parent.add(o);
  return o;
}
function box(w, h, d, m, x, y, z, parent) {
  const o = mesh(new THREE.BoxGeometry(w, h, d), m, parent);
  o.position.set(x, y, z);
  return o;
}
function rbox(w, h, d, r, m, x, y, z, parent) {
  const rr = Math.max(1e-5, Math.min(r, Math.min(w, h, d) / 2 - 1e-5));
  const o = mesh(new RoundedBoxGeometry(w, h, d, 4, rr), m, parent);
  o.position.set(x, y, z);
  return o;
}
// Vertical cylinder along Y (Y-up)
function vcyl(r, h, m, x, y, z, seg = 32, parent) {
  const o = mesh(new THREE.CylinderGeometry(r, r, h, seg), m, parent);
  o.position.set(x, y, z);
  return o;
}
// Horizontal cylinder along X
function hcylX(r, len, m, x, y, z, seg = 32, parent) {
  const o = vcyl(r, len, m, x, y, z, seg, parent);
  o.rotation.z = Math.PI / 2;
  return o;
}
// Horizontal cylinder along Z
function hcylZ(r, len, m, x, y, z, seg = 32, parent) {
  const o = vcyl(r, len, m, x, y, z, seg, parent);
  o.rotation.x = Math.PI / 2;
  return o;
}
const UP = V(0, 1, 0);
function rod(r, m, seg = 12) { return mesh(new THREE.CylinderGeometry(r, r, 1, seg), m); }
function placeRod(o, a, b) {
  const d = b.clone().sub(a);
  o.position.copy(a).addScaledVector(d, 0.5);
  o.scale.set(1, d.length(), 1);
  o.quaternion.setFromUnitVectors(UP, d.normalize());
}

function stripeTexture(base, stripe, repeatX, repeatY = 1) {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 16;
  const g = c.getContext("2d");
  g.fillStyle = base; g.fillRect(0, 0, 256, 16);
  g.fillStyle = stripe;
  for (let i = 0; i < 256; i += 32) g.fillRect(i, 0, 4, 16);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

const toShape = (pts) => (pts instanceof THREE.Shape ? pts : new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x !== undefined ? p.x : p[0], p.y !== undefined ? p.y : p[1]))));

function shrinkOutline(pts, dist) {
  const list = pts instanceof THREE.Shape ? pts.getPoints(48) : pts;
  const xy = list.map((p) => [p.x !== undefined ? p.x : p[0], p.y !== undefined ? p.y : p[1]]);
  let cx = 0, cy = 0;
  for (const [x, y] of xy) { cx += x; cy += y; }
  cx /= xy.length; cy /= xy.length;
  return xy.map(([x, y]) => {
    const dx = cx - x, dy = cy - y, len = Math.hypot(dx, dy) || 1;
    const t = Math.min(dist, len * 0.85);
    return [x + (dx / len) * t, y + (dy / len) * t];
  });
}

function extrudeShapeGeo(pts, depthTotal, bevel) {
  const b = Math.max(0, Math.min(bevel || 0, depthTotal / 2 - 1e-4));
  const geo = new THREE.ExtrudeGeometry(toShape(b > 0 ? shrinkOutline(pts, b) : pts), {
    depth: depthTotal - 2 * b, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelOffset: 0, bevelSegments: 3, curveSegments: 24,
  });
  if (b > 0) geo.translate(0, 0, b);
  return geo;
}

// Plan outline [[x, y], ...] extruded along Z from z0 to z1
function extrudeXY(pts, z0, z1, m, parent, bevel = 0) {
  const geo = extrudeShapeGeo(pts, z1 - z0, bevel);
  geo.translate(0, 0, z0);
  return mesh(geo, m, parent);
}

// Floor plan outline [[x, z], ...] extruded vertically along Y from y0 to y1 (Y-up)
function extrudeXZ(pts, y0, y1, m, parent, bevel = 0) {
  const geo = extrudeShapeGeo(pts, y1 - y0, bevel);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y1, 0);
  return mesh(geo, m, parent);
}

// Profile [[r, y], ...] revolved about the local Y axis (Y-up)
function lathe(prof, m, parent, seg = 48) {
  const geo = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  return mesh(geo, m, parent);
}

function tubeGeo(pts, r, tub, rad) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => (p.isVector3 ? p : V(p[0], p[1], p[2]))), false, "centripetal");
  return new THREE.TubeGeometry(curve, tub, r, rad, false);
}
function tubeAlong(pts, r, m, parent, tub = 64, rad = 12) {
  const o = mesh(tubeGeo(pts, r, tub, rad), m, parent);
  o.userData.tube = { r, tub, rad };
  return o;
}
function updateTube(o, pts) {
  const { r, tub, rad } = o.userData.tube;
  o.geometry.dispose();
  o.geometry = tubeGeo(pts, r, tub, rad);
}

// 40x40 slot-8 aluminium extrusion section, metres. Unit-length along Z, instanced with scale z = length.
function profile4040Shape() {
  const s = 0.001, r = 4;
  const face = [[20, -4], [15.5, -4], [15.5, -8], [9.75, -8], [7.75, -6], [7.75, 6], [9.75, 8], [15.5, 8], [15.5, 4], [20, 4]];
  const shape = new THREE.Shape();
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2, c = Math.cos(a), si = Math.sin(a);
    const R = ([x, y]) => [(x * c - y * si) * s, (x * si + y * c) * s];
    const [cx, cy] = R([16, -16]);
    if (k === 0) shape.moveTo(...R([16, -20]));
    shape.absarc(cx, cy, r * s, a - Math.PI / 2, a, false);
    for (const p of face) shape.lineTo(...R(p));
    shape.lineTo(...R([20, 16]));
  }
  shape.closePath();
  const hole = (x, y, rad) => { const p = new THREE.Path(); p.absarc(x * s, y * s, rad * s, 0, Math.PI * 2, true); return p; };
  shape.holes.push(hole(0, 0, 3.4), hole(14, 14, 3), hole(-14, 14, 3), hole(-14, -14, 3), hole(14, -14, 3));
  return shape;
}

const PROFILE_CAP = 800;
const BOLT_CAP = 1500;
const profileGeo = new THREE.ExtrudeGeometry(profile4040Shape(), { depth: 1, bevelEnabled: false, curveSegments: 3 });
const boltGeo = new THREE.LatheGeometry([
  new THREE.Vector2(0, 0.0022), new THREE.Vector2(0.0048, 0.0022), new THREE.Vector2(0.0064, 0.0015),
  new THREE.Vector2(0.007, 0.0006), new THREE.Vector2(0.007, -0.0015), new THREE.Vector2(0.0062, -0.0022), new THREE.Vector2(0, -0.0022),
], 20);

function makeInstanced(geo, material, cap, parent) {
  const o = new THREE.InstancedMesh(geo, material, cap);
  o.count = 0;
  o.castShadow = o.receiveShadow = true;
  o.frustumCulled = false;
  o.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  parent.add(o);
  return o;
}

const profiles = makeInstanced(profileGeo, M.aluClear, PROFILE_CAP, world);
const bolts = makeInstanced(boltGeo, M.steel, BOLT_CAP, world);
const extraProfiles = new Map();
const extraBolts = new Map();

function pooledMesh(map, parent, geo, material, cap) {
  let o = map.get(parent);
  if (!o) { o = makeInstanced(geo, material, cap, parent); map.set(parent, o); }
  return o;
}

const _beamQ = new THREE.Quaternion();
const _beamS = new THREE.Vector3();
const _beamM = new THREE.Matrix4();
const _beamD = new THREE.Vector3();
const _zAxis = V(0, 0, 1);
const _boltP = new THREE.Vector3();
const _boltN = new THREE.Vector3();
let profileWarned = false, boltWarned = false;

function profileBeam(a, b, parent = world) {
  const pool = parent === world ? profiles : pooledMesh(extraProfiles, parent, profileGeo, M.aluClear, PROFILE_CAP);
  _beamD.subVectors(b, a);
  const L = _beamD.length();
  if (L < 1e-6) return pool;
  if (pool.count >= PROFILE_CAP) { if (!profileWarned) { profileWarned = true; console.warn("profileBeam: capacity", PROFILE_CAP); } return pool; }
  _beamD.multiplyScalar(1 / L);
  _beamQ.setFromUnitVectors(_zAxis, _beamD);
  _beamS.set(1, 1, L);
  _beamM.compose(a, _beamQ, _beamS);
  pool.setMatrixAt(pool.count, _beamM);
  pool.count += 1;
  return pool;
}

let profilesFinal = false;
function finalizeProfiles() {
  if (profilesFinal) return;
  profilesFinal = true;
  profiles.instanceMatrix.needsUpdate = true;
  bolts.instanceMatrix.needsUpdate = true;
  extraProfiles.forEach((o) => { o.instanceMatrix.needsUpdate = true; });
  extraBolts.forEach((o) => { o.instanceMatrix.needsUpdate = true; });
}

function addBolt(pos, normal, parent = world) {
  const pool = parent === world ? bolts : pooledMesh(extraBolts, parent, boltGeo, M.steel, BOLT_CAP);
  if (pool.count >= BOLT_CAP) { if (!boltWarned) { boltWarned = true; console.warn("addBolt: capacity", BOLT_CAP); } return pool; }
  _boltN.copy(normal);
  if (_boltN.lengthSq() < 1e-12) _boltN.copy(_zAxis); else _boltN.normalize();
  _beamQ.setFromUnitVectors(UP, _boltN);
  _boltP.copy(pos).addScaledVector(_boltN, 0.0022);
  _beamS.set(1, 1, 1);
  _beamM.compose(_boltP, _beamQ, _beamS);
  pool.setMatrixAt(pool.count, _beamM);
  pool.count += 1;
  return pool;
}

function labelPlane(text, w, h, opts = {}) {
  const { bg = "#ffffff", fg = "#111111", font = "700 130px system-ui, sans-serif", px = 256 } = opts;
  const c = document.createElement("canvas");
  c.height = px;
  c.width = Math.max(px, Math.round(px * w / h));
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = fg; g.font = font; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.72 }));
  o.receiveShadow = true;
  return o;
}
