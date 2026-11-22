// FANUC pedestal, UR table, fixture table & pneumatic clamp, reject bin,
// 2 x (2x3) cover trays, overhead inspection camera, and reusable housing/cover/screw geometries (Y-up, SPEC.md §2).

// ---------------------------------------------------------------- FANUC pedestal (CELL.fanuc.base = [0, 0.60, -0.05])
{
  const [fx, fy, fz] = CELL.fanuc.base;
  const g = new THREE.Group();
  world.add(g);
  // Floor baseplate & anchor bolts
  rbox(0.40, 0.020, 0.40, 0.003, M.pedestalSteel, fx, 0.010, fz, g);
  for (const sx of [-0.16, 0.16]) for (const sz of [-0.16, 0.16]) {
    addBolt(V(fx + sx, 0.020, fz + sz), UP, g);
  }
  // Column body + diagonal gussets
  const colH = fy - 0.040;
  rbox(0.24, colH, 0.24, 0.006, M.pedestalSteel, fx, 0.020 + colH / 2, fz, g);
  for (const [gx, gz] of [[0.14, 0], [-0.14, 0], [0, 0.14], [0, -0.14]]) {
    rbox(gx ? 0.04 : 0.014, 0.14, gz ? 0.04 : 0.014, 0.002, M.cabinet, fx + gx, 0.09, fz + gz, g);
  }
  // Machined steel top mounting plate (top plane exact at y = fy = 0.60)
  rbox(0.30, 0.022, 0.30, 0.003, M.aluMachined, fx, fy - 0.011, fz, g);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    addBolt(V(fx + Math.cos(a) * 0.115, fy, fz + Math.sin(a) * 0.115), UP, g);
  }
}

// ---------------------------------------------------------------- Fixture table & pneumatic clamp (CELL.fixture.pos = [0, 0.80, 0.25])
{
  const [px, py, pz] = CELL.fixture.pos;
  const g = new THREE.Group();
  world.add(g);
  // Compact fixture support stand inside the fence (z = 0.09..0.29)
  const tblZ = 0.19, tblD = 0.20, tblW = 0.36;
  rbox(tblW, 0.022, tblD, 0.003, M.aluMachined, px, py - 0.011, tblZ, g);
  for (const sx of [-0.14, 0.14]) for (const sz of [0.11, 0.27]) {
    rbox(0.036, py - 0.034, 0.036, 0.002, M.aluClear, px + sx, (py - 0.010) / 2, sz, g);
    vcyl(0.024, 0.008, M.blackRubber, px + sx, 0.004, sz, 20, g);
  }
  rbox(0.26, 0.026, 0.026, 0.0015, M.aluClear, px, 0.22, tblZ, g);

  // Precision datum fixture nest centered at CELL.fixture.pos (housing bottom sits at y = 0.800)
  // Flanking locating rails & datum pads around 120 x 80 mm housing footprint
  const hw = CELL.housing[0] / 2, hd = CELL.housing[2] / 2;
  for (const sx of [-1, 1]) {
    rbox(0.016, 0.018, 0.096, 0.002, M.fixtureBlue, px + sx * (hw + 0.010), py + 0.009, pz, g);
    // Steel locating datum pin
    vcyl(0.005, 0.022, M.steel, px + sx * (hw + 0.004), py + 0.011, pz - 0.025, 16, g);
  }
  // Back stop block (-z side)
  rbox(0.110, 0.018, 0.016, 0.002, M.fixtureBlue, px, py + 0.009, pz - hd - 0.010, g);
  // Pneumatic side-clamp cylinder (-z side)
  rbox(0.042, 0.034, 0.056, 0.003, M.aluMachined, px, py + 0.017, pz - hd - 0.052, g);
  hcylZ(0.006, 0.024, M.chrome, px, py + 0.020, pz - hd - 0.018, 16, g);
  rbox(0.032, 0.014, 0.010, 0.002, M.blackPlastic, px, py + 0.022, pz - hd - 0.006, g);
}

// ---------------------------------------------------------------- UR5e collaborative table (top y = 0.80, z = 0.36..1.42)
{
  const tx0 = -0.45, tx1 = 0.85, tz0 = 0.36, tz1 = 1.42;
  const tw = tx1 - tx0, td = tz1 - tz0;
  const tcx = (tx0 + tx1) / 2, tcz = (tz0 + tz1) / 2;
  const topY = CELL.ur.base[1];
  const g = new THREE.Group();
  world.add(g);

  // Top plate (y = 0.768..0.800)
  rbox(tw, 0.032, td, 0.004, M.aluMachined, tcx, topY - 0.016, tcz, g);

  // 40x40 extrusion frame & 4 legs down to rubber feet
  const inset = 0.045;
  const lx0 = tx0 + inset, lx1 = tx1 - inset, lz0 = tz0 + inset, lz1 = tz1 - inset;
  for (const lx of [lx0, lx1]) for (const lz of [lz0, lz1]) {
    profileBeam(V(lx, 0.016, lz), V(lx, topY - 0.032, lz));
    vcyl(0.028, 0.008, M.blackRubber, lx, 0.004, lz, 24, g);
    vcyl(0.006, 0.016, M.steel, lx, 0.014, lz, 16, g);
  }
  for (const lz of [lz0, lz1]) {
    profileBeam(V(lx0 + 0.02, 0.22, lz), V(lx1 - 0.02, 0.22, lz));
    profileBeam(V(lx0 + 0.02, topY - 0.052, lz), V(lx1 - 0.02, topY - 0.052, lz));
  }
  for (const lx of [lx0, lx1]) {
    profileBeam(V(lx, 0.22, lz0 + 0.02), V(lx, 0.22, lz1 - 0.02));
    profileBeam(V(lx, topY - 0.052, lz0 + 0.02), V(lx, topY - 0.052, lz1 - 0.02));
  }

  // UR5e base mounting ring & bolts at CELL.ur.base
  const [ux, uy, uz] = CELL.ur.base;
  vcyl(0.088, 0.012, M.steel, ux, uy + 0.002, uz, 36, g);
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    addBolt(V(ux + Math.cos(a) * 0.072, uy + 0.008, uz + Math.sin(a) * 0.072), UP, g);
  }

  // Operator-side E-stop box mounted on front-right corner of the UR table
  rbox(0.080, 0.065, 0.080, 0.004, M.estopYellow, tx1 - 0.06, topY + 0.032, tz1 - 0.06, g);
  vcyl(0.022, 0.016, M.estopRed, tx1 - 0.06, topY + 0.070, tz1 - 0.06, 24, g);
}

// ---------------------------------------------------------------- Reject bin (CELL.rejectBin)
{
  const RB = CELL.rejectBin;
  const [rx, ry, rz] = RB.pos;
  const [rw, rh, rd] = RB.size;
  const g = new THREE.Group();
  world.add(g);
  const yBot = ry - rh;
  const wallT = 0.008;

  // Bottom plate & 4 bin walls (open top at y = ry)
  rbox(rw, wallT, rd, 0.002, M.binRed, rx, yBot + wallT / 2, rz, g);
  rbox(wallT, rh, rd, 0.002, M.binRed, rx - rw / 2 + wallT / 2, ry - rh / 2, rz, g);
  rbox(wallT, rh, rd, 0.002, M.binRed, rx + rw / 2 - wallT / 2, ry - rh / 2, rz, g);
  rbox(rw - wallT * 2, rh, wallT, 0.002, M.binRed, rx, ry - rh / 2, rz - rd / 2 + wallT / 2, g);
  rbox(rw - wallT * 2, rh, wallT, 0.002, M.binRed, rx, ry - rh / 2, rz + rd / 2 - wallT / 2, g);
  // Flared stainless upper collar
  for (const sg of [-1, 1]) {
    const lipX = rbox(0.018, 0.012, rd + 0.012, 0.002, M.stainlessBrushed, rx + sg * (rw / 2 + 0.004), ry - 0.004, rz, g);
    lipX.rotation.z = -sg * 0.25;
  }
  // Support legs down to y = 0
  for (const sx of [-rw / 2 + 0.025, rw / 2 - 0.025]) for (const sz of [-rd / 2 + 0.025, rd / 2 - 0.025]) {
    rbox(0.026, yBot - 0.008, 0.026, 0.0015, M.aluDark, rx + sx, (yBot + 0.008) / 2, rz + sz, g);
    vcyl(0.018, 0.008, M.blackRubber, rx + sx, 0.004, rz + sz, 16, g);
  }
  // Reject label on +z front wall
  const tag = labelPlane("REJECT", 0.16, 0.044, { bg: "#1a1c20", fg: "#ffffff", font: "700 84px system-ui, sans-serif" });
  tag.position.set(rx, ry - rh * 0.45, rz + rd / 2 + 0.002);
  g.add(tag);
}

// ---------------------------------------------------------------- Reusable housing, cover & screw geometries
const [HW, HH, HD] = CELL.housing; // [0.12, 0.06, 0.08]
const COVER_W = 0.086, COVER_H = 0.010, COVER_D = 0.070;

const _tmpGeoGroup = new THREE.Group();
// Housing body (bottom-centered at y = 0..HH)
const housingBodyGeo = rbox(HW, HH, HD, 0.004, M.housingAlu, 0, HH / 2, 0, _tmpGeoGroup).geometry;
housingBodyGeo.translate(0, HH / 2, 0);
const housingFlangeGeo = rbox(HW + 0.003, 0.010, HD - 0.014, 0.002, M.aluBlasted, 0, 0.005, 0, _tmpGeoGroup).geometry;
housingFlangeGeo.translate(0, 0.005, 0);
const housingBossGeo = new THREE.CylinderGeometry(0.022, 0.024, 0.006, 28);
housingBossGeo.translate(0, HH - 0.003, 0); // top flush with the housing; the cover occupies y > HH
const housingBoreGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.008, 24);
housingBoreGeo.translate(0, HH - 0.004, 0);

const SCREW_OFFSETS = [
  [-0.032, -0.024],
  [0.032, -0.024],
  [-0.032, 0.024],
  [0.032, 0.024],
];

// Cover (bottom-centered at y = 0..COVER_H, with 4 real counterbored screw holes)
const COVER_HOLE_R = 0.0052;
const COVER_PLATE_H = 0.0085;
const coverPlateGeo = (() => {
  const hw = COVER_W / 2, hd = COVER_D / 2, r = 0.0035;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hd);
  shape.lineTo(hw - r, -hd);
  shape.absarc(hw - r, -hd + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hd - r);
  shape.absarc(hw - r, hd - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hd);
  shape.absarc(-hw + r, hd - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hd + r);
  shape.absarc(-hw + r, -hd + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  for (const [sx, sz] of SCREW_OFFSETS) {
    const hole = new THREE.Path();
    hole.absarc(sx, sz, COVER_HOLE_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }
  const bevel = 0.0005;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: COVER_PLATE_H - 2 * bevel,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 20,
  });
  geo.translate(0, 0, bevel);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, COVER_PLATE_H, 0);
  return geo;
})();
const coverCapGeo = new THREE.CylinderGeometry(0.020, 0.022, 0.005, 24);
coverCapGeo.translate(0, COVER_H - 0.0025, 0);

// Screw (M5 socket cap, bottom-centered y = 0..0.006, top at COVER_H TCP plane)
const screwGeo = new THREE.LatheGeometry([
  [0, 0], [0.0042, 0], [0.0042, 0.0053], [0.0035, 0.0060],
  [0.0020, 0.0060], [0.0020, 0.0043], [0, 0.0043],
].map(([r, y]) => new THREE.Vector2(r, y)), 18);
const screwSocketGeo = new THREE.CylinderGeometry(0.0020, 0.0020, 0.0008, 6);
screwSocketGeo.translate(0, 0.0046, 0);
_tmpGeoGroup.clear();

function makeHousingMesh(parent = world) {
  const g = new THREE.Group();
  mesh(housingBodyGeo, M.housingAlu, g);
  mesh(housingFlangeGeo, M.aluBlasted, g);
  mesh(housingBossGeo, M.aluMachined, g);
  mesh(housingBoreGeo, M.blackPlastic, g);
  for (const [sx, sz] of SCREW_OFFSETS) {
    const hole = vcyl(0.0035, 0.002, M.blackPlastic, sx, HH - 0.0012, sz, 12, g);
    hole.castShadow = false;
  }
  parent.add(g);
  return g;
}

function makeCoverMesh(parent = world) {
  const g = new THREE.Group();
  mesh(coverPlateGeo, M.coverSlate, g);
  mesh(coverCapGeo, M.aluDark, g);
  // Recessed dark hole bottom seats strictly below mounted screws (y = 0..0.0036 < 0.0040)
  for (const [sx, sz] of SCREW_OFFSETS) {
    const seat = vcyl(COVER_HOLE_R, 0.0036, M.blackPlastic, sx, 0.0018, sz, 16, g);
    seat.castShadow = false;
  }
  parent.add(g);
  return g;
}

function makeScrewMesh(parent = world) {
  const g = new THREE.Group();
  mesh(screwGeo, M.steel, g);
  const socket = mesh(screwSocketGeo, M.blackPlastic, g);
  socket.castShadow = false;
  parent.add(g);
  return g;
}

// ---------------------------------------------------------------- Cover trays (2 x 3 grid, pitch 0.10)
const TRAY_PITCH = 0.10;
const TRAY_COLS = 3; // along X (-0.10, 0, +0.10)
const TRAY_ROWS = 2; // along Z (-0.05, +0.05)

function traySlotLocal(idx) {
  const col = idx % TRAY_COLS;
  const row = Math.floor(idx / TRAY_COLS);
  return [(col - 1) * TRAY_PITCH, (row - 0.5) * TRAY_PITCH];
}

function makeTrayGroup(ti) {
  const g = new THREE.Group();
  world.add(g);
  const tw = 0.310, td = 0.210, th = 0.014;
  // Base tray body with recessed pockets
  rbox(tw, th, td, 0.003, M.trayPOM, 0, th / 2, 0, g);
  // Pocket locator bosses & initial covers
  const covers = [];
  for (let i = 0; i < TRAY_COLS * TRAY_ROWS; i++) {
    const [lx, lz] = traySlotLocal(i);
    rbox(COVER_W + 0.004, 0.004, COVER_D + 0.004, 0.001, M.aluDark, lx, th + 0.001, lz, g);
    const cv = makeCoverMesh(g);
    cv.position.set(lx, th + 0.003, lz);
    covers.push(cv);
  }
  const label = labelPlane(`TRAY ${ti + 1}`, 0.11, 0.026, { bg: "#1b2028", fg: "#e2e8f0", font: "700 72px system-ui, sans-serif", px: 128 });
  label.position.set(0, 0.015, td / 2 + 0.002);
  g.add(label);
  return { g, covers };
}

const trayGroups = [];
const trayCoverMeshes = [];
const spareTrayGroups = [];
CELL.trays.forEach((tr, ti) => {
  const [tx, ty, tz] = tr.pos;
  const tw = 0.310, td = 0.210;
  // Corner alignment rails fixed to the UR table
  const rails = new THREE.Group();
  rails.position.set(tx, ty, tz);
  world.add(rails);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    rbox(0.022, 0.018, 0.010, 0.001, M.aluClear, sx * (tw / 2 - 0.012), 0.009, sz * (td / 2 + 0.006), rails);
    rbox(0.010, 0.018, 0.022, 0.001, M.aluClear, sx * (tw / 2 + 0.006), 0.009, sz * (td / 2 - 0.012), rails);
  }

  const active = makeTrayGroup(ti);
  active.g.position.set(tx, ty, tz);
  trayGroups.push(active.g);
  trayCoverMeshes.push(active.covers);

  const spare = makeTrayGroup(ti);
  spare.g.visible = false;
  spareTrayGroups.push(spare.g);
});

// ---------------------------------------------------------------- Inspection camera (CELL.camera = [0, 1.45, 0.25])
const camFlash = new THREE.PointLight(0xeef6ff, 0, 0.9);
const camRingMat = M.whitePOM.clone();
camRingMat.emissive.setHex(0x000000);
{
  const [cx, cy, cz] = CELL.camera;
  const g = new THREE.Group();
  world.add(g);
  // Cantilever extrusion bracket from front fence header (y = 1.65, z = 0.30) to camera position
  profileBeam(V(cx, 1.65, CELL.fence.z1), V(cx, 1.65, cz));
  rbox(0.048, 0.16, 0.048, 0.002, M.aluDark, cx, 1.56, cz, g);
  // Machine vision camera housing + C-mount lens at y = 1.45 pointing straight down (-Y)
  rbox(0.056, 0.072, 0.056, 0.004, M.aluDark, cx, cy + 0.068, cz, g);
  vcyl(0.020, 0.034, M.lens, cx, cy + 0.017, cz, 24, g);
  vcyl(0.018, 0.004, M.glass, cx, cy + 0.001, cz, 24, g);
  // Ring illuminator around lens
  const ringBody = vcyl(0.044, 0.014, M.aluDark, cx, cy + 0.016, cz, 32, g);
  ringBody.castShadow = true;
  const ringGlow = mesh(new THREE.TorusGeometry(0.032, 0.005, 12, 36), camRingMat, g);
  ringGlow.rotation.x = Math.PI / 2;
  ringGlow.position.set(cx, cy + 0.008, cz);
  camFlash.position.set(cx, cy - 0.04, cz);
  world.add(camFlash);
}
