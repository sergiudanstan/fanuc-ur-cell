// Infeed conveyor (with escapement & pick-window sensors) and outfeed conveyor (Y-up, SPEC.md §2).
const INF = CELL.infeed;
const OUT = CELL.outfeed;
const PW = CELL.pickWin;

function convCylinder(r, length, material, parent = world) {
  const b = Math.min(0.0005, length / 4, r / 4);
  return lathe([
    [0, -length / 2], [r - b, -length / 2], [r, -length / 2 + b],
    [r, length / 2 - b], [r - b, length / 2], [0, length / 2],
  ], material, parent);
}

function buildConveyor(cfg, opts = {}) {
  const { x0, x1, z, top, width } = cfg;
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  const group = new THREE.Group();
  world.add(group);

  // Textured moving belt top surface + solid belt core
  const beltTex = stripeTexture("#34433f", "#4b5e59", len / 0.14);
  const beltMat = M.beltDark.clone();
  beltMat.map = beltTex;
  const beltTop = mesh(new THREE.PlaneGeometry(len, width), beltMat, group);
  beltTop.rotation.x = -Math.PI / 2;
  beltTop.position.set(cx, top, z);
  beltTop.castShadow = false;
  beltTop.receiveShadow = true;
  rbox(len, 0.006, width - 0.004, 0.001, M.blackRubber, cx, top - 0.0035, z, group);

  // Stainless side frames and POM side guide rails (guiding 80 mm housing centered at z)
  const guideHalf = opts.guideHalf || 0.050;
  for (const sg of [-1, 1]) {
    rbox(len + 0.044, 0.068, 0.014, 0.002, M.stainlessBrushed, cx, top - 0.032, z + sg * (width / 2 + 0.009), group);
    rbox(len - 0.04, 0.014, 0.006, 0.0015, M.stainlessBrushed, cx, top + 0.022, z + sg * (guideHalf + 0.006), group);
    rbox(len - 0.04, 0.010, 0.005, 0.001, M.whitePOM, cx, top + 0.022, z + sg * guideHalf, group);
    for (let px = x0 + 0.14; px <= x1 - 0.10; px += 0.42) {
      rbox(0.010, 0.032, 0.036, 0.0015, M.stainlessBrushed, px, top + 0.008, z + sg * (guideHalf + 0.020), group);
    }
  }

  // Head & tail rollers
  for (const x of [x0, x1]) {
    const roller = convCylinder(0.024, width + 0.014, M.steel, group);
    roller.rotation.x = Math.PI / 2;
    roller.position.set(x, top - 0.024, z);
  }

  // Support legs down to floor (y = 0) with rubber leveling feet
  const legXs = opts.legXs || [x0 + 0.12, x1 - 0.12];
  const legTopY = top - 0.066;
  for (const lx of legXs) {
    for (const sg of [-1, 1]) {
      const lz = z + sg * (width / 2 + 0.009);
      rbox(0.036, legTopY - 0.024, 0.036, 0.002, M.aluClear, lx, (legTopY + 0.024) / 2, lz, group);
      convCylinder(0.024, 0.008, M.blackRubber, group).position.set(lx, 0.004, lz);
      convCylinder(0.005, 0.018, M.steel, group).position.set(lx, 0.016, lz);
    }
    // Cross tie bar between pair of legs
    rbox(0.028, 0.028, width + 0.016, 0.0015, M.aluClear, lx, 0.22, z, group);
  }

  // Geared drive motor mounted outside fence interference
  const mx = opts.motorX ?? (x1 - 0.08);
  const mzSign = opts.motorZSign ?? -1;
  rbox(0.082, 0.082, 0.082, 0.004, M.gearboxSilver, mx, top - 0.044, z + mzSign * (width / 2 + 0.056), group);
  const motor = convCylinder(0.038, 0.130, M.motorBlack, group);
  motor.rotation.x = Math.PI / 2;
  motor.position.set(mx, top - 0.044, z + mzSign * (width / 2 + 0.160));

  return { group, beltTex };
}

// ---------------------------------------------------------------- infeed conveyor
const infeedConv = buildConveyor(INF, {
  legXs: [INF.x0 + 0.14, -1.16, -0.10],
  motorX: INF.x0 + 0.16,
  motorZSign: -1,
});

// Escapement mechanism near infeed entry (x = -1.55, outside fence x0 = -1.00)
{
  const ex = -1.55;
  const g = infeedConv.group;
  // Portal arch over the belt
  for (const sg of [-1, 1]) {
    rbox(0.024, 0.24, 0.024, 0.002, M.aluClear, ex, INF.top + 0.11, INF.z + sg * (INF.width / 2 + 0.009), g);
  }
  rbox(0.032, 0.032, INF.width + 0.042, 0.002, M.aluClear, ex, INF.top + 0.23, INF.z, g);
  // Pneumatic cylinder + chrome rod + escapement stop gate
  rbox(0.038, 0.090, 0.038, 0.003, M.aluMachined, ex, INF.top + 0.21, INF.z, g);
  convCylinder(0.007, 0.075, M.chrome, g).position.set(ex, INF.top + 0.13, INF.z);
  rbox(0.012, 0.048, 0.090, 0.0015, M.curtainYellow, ex, INF.top + 0.072, INF.z, g);
  // Entry optical sensor
  rbox(0.016, 0.022, 0.018, 0.002, M.blackPlastic, ex - 0.06, INF.top + 0.032, INF.z + 0.065, g);
  convCylinder(0.004, 0.004, M.lens, g).position.set(ex - 0.06, INF.top + 0.032, INF.z + 0.056);
}

// Pick-window markings & line-tracking photo-eyes (CELL.pickWin = { x0: -0.45, x1: -0.05 })
{
  const g = infeedConv.group;
  const pwLen = PW.x1 - PW.x0;
  const pwCx = (PW.x0 + PW.x1) / 2;
  for (const sg of [-1, 1]) {
    rbox(pwLen, 0.006, 0.012, 0.001, M.curtainYellow, pwCx, INF.top + 0.004, INF.z + sg * (INF.width / 2 + 0.009), g);
  }
  for (const sx of [PW.x0, PW.x1]) {
    rbox(0.014, 0.052, 0.014, 0.002, M.stainlessBrushed, sx, INF.top + 0.012, INF.z + 0.078, g);
    rbox(0.016, 0.022, 0.020, 0.002, M.blackPlastic, sx, INF.top + 0.034, INF.z + 0.068, g);
  }
  const beamPts = new Float32Array([PW.x0, INF.top + 0.034, INF.z - 0.055, PW.x0, INF.top + 0.034, INF.z + 0.055]);
  const beamGeo = new THREE.BufferGeometry();
  beamGeo.setAttribute("position", new THREE.BufferAttribute(beamPts, 3));
  g.add(new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.55 })));
}

// ---------------------------------------------------------------- outfeed conveyor
const outfeedConv = buildConveyor(OUT, {
  legXs: [OUT.x0 + 0.12, 0.85, OUT.x1 - 0.14],
  motorX: OUT.x1 - 0.14,
  motorZSign: -1,
});

// End-of-line discharge sensor & bumper stop
{
  const g = outfeedConv.group;
  rbox(0.014, 0.034, 0.100, 0.002, M.blackRubber, OUT.x1 - 0.012, OUT.top + 0.018, OUT.z, g);
  rbox(0.016, 0.024, 0.020, 0.002, M.blackPlastic, OUT.x1 - 0.08, OUT.top + 0.032, OUT.z + 0.066, g);
}
