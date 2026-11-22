const HALF_PI = Math.PI / 2;

function mixVec(a, b, s) {
  return a.map((x, j) => x + s * (b[j] - x));
}

function robotFrame(parent, name, x = 0, y = 0, z = 0) {
  const frame = new THREE.Group();
  frame.name = name;
  frame.position.set(x, y, z);
  parent.add(frame);
  return frame;
}

function robotBase(actor) {
  const base = robotFrame(world, actor, ...CELL[actor].base);
  base.rotation.set(-HALF_PI, 0, 0);
  base.rotateOnWorldAxis(UP, CELL[actor].yaw);
  return base;
}

function robotSample(t) {
  const { S } = current();
  const index = clamp(t / S.dt, 0, S.t.length - 1);
  const nearest = Math.round(index);
  if (Math.abs(index - nearest) < 1e-9) return [nearest, nearest, 0];
  const lo = Math.floor(index);
  return [lo, lo + 1, index - lo];
}

const fanucScene = (() => {
  const { d1, a1, a2, a3, d4, d6 } = FANUC.dh;
  const yellow = M.fanucYellow, dark = M.blackPlastic;
  const base = robotBase("fanuc");
  hcylZ(0.108, 0.025, yellow, 0, 0, 0.013, 40, base);
  hcylZ(0.089, 0.056, M.aluDark, 0, 0, 0.049, 40, base);
  for (const x of [-0.064, 0.064]) for (const y of [-0.064, 0.064]) {
    addBolt(V(x, y, 0.026), V(0, 0, 1), base);
  }

  const j1 = robotFrame(base, "FANUC J1", 0, 0, d1);
  rbox(0.165, 0.155, d1 - 0.055, 0.040, yellow, -0.014, 0, -(d1 - 0.055) / 2, j1);
  const j2 = robotFrame(j1, "FANUC J2", a1);
  vcyl(0.080, 0.174, yellow, 0, 0, 0, 40, j2);
  vcyl(0.055, 0.012, M.aluDark, 0, -0.091, 0, 36, j2);
  extrudeXZ([[-0.066, 0], [0.067, 0], [0.055, 0.15], [0.041, a2],
    [-0.056, a2], [-0.086, 0.17]], -0.057, 0.057, yellow, j2, 0.013);
  const logo = labelPlane("FANUC", 0.103, 0.027, { bg: "#f5b800", fg: "#231d14" });
  logo.position.set(-0.012, -0.058, 0.22);
  logo.rotation.set(HALF_PI, 0, HALF_PI);
  j2.add(logo);

  const j3 = robotFrame(j2, "FANUC J3", 0, 0, a2);
  vcyl(0.067, 0.132, yellow, 0, 0, 0, 40, j3);
  vcyl(0.039, 0.012, M.aluDark, 0, -0.069, 0, 32, j3);
  extrudeXZ([[0, -0.055], [0.17, -0.037], [d4, a3 - 0.036],
    [d4, a3 + 0.041], [0.14, 0.071], [0, 0.059]], -0.048, 0.048, yellow, j3, 0.010);
  const wrist = robotFrame(j3, "FANUC wrist datum", d4, 0, a3);
  wrist.rotation.y = HALF_PI;
  const j4 = robotFrame(wrist, "FANUC J4");
  hcylZ(0.053, 0.054, yellow, 0, 0, -0.013, 36, j4);
  const j5 = robotFrame(j4, "FANUC J5");
  vcyl(0.043, 0.106, yellow, 0, 0, 0.007, 32, j5);
  vcyl(0.028, 0.008, M.aluDark, 0, 0.055, 0.007, 32, j5);
  rbox(0.073, 0.072, 0.070, 0.021, yellow, 0, 0, 0.039, j5);
  const j6 = robotFrame(j5, "FANUC J6");
  hcylZ(0.035, 0.014, M.aluDark, 0, 0, d6 - 0.007, 36, j6);
  const flange = robotFrame(j6, "FANUC flange", 0, 0, d6);
  const tcp = robotFrame(flange, "FANUC nominal TCP", 0, 0, FANUC.tool);

  // Dual gripper with +X lateral offset (clears UR table and light curtain) and
  // pneumatic Z-extension during swivel (keeps inactive side beside the wrist at 0/pi
  // and clears J5/J6 at mid-swivel). Cylinder is offset in +Y and behind the flange
  // plane so neither barrel, rod, nor bracket enters the swept housing/gripper volume.
  const lateral = 0.095, advance = 0.070, swivelStroke = 0.105, cylY = 0.092;
  const support = robotFrame(flange, "FANUC swivel support");
  hcylZ(0.035, 0.012, M.aluDark, 0, 0, -0.006, 32, support);
  rbox(lateral + 0.026, 0.034, 0.014, 0.004, M.aluDark, lateral / 2, 0, -0.017, support);
  rbox(0.034, cylY + 0.026, 0.014, 0.004, M.aluDark, lateral, cylY / 2, -0.017, support);
  hcylZ(0.018, 0.115, M.aluMachined, lateral, cylY, -0.0225, 32, support);
  const piston = robotFrame(support, "FANUC swivel piston", lateral, 0, advance);
  hcylZ(0.009, 0.145, M.chrome, 0, cylY, -0.0725, 24, piston);
  hcylZ(0.016, 0.020, M.aluDark, 0, cylY, 0, 24, piston);
  rbox(0.026, cylY - 0.010, 0.018, 0.004, M.aluDark, 0, (cylY + 0.022) / 2, 0, piston);

  const swivel = robotFrame(support, "FANUC pneumatic swivel", lateral, 0, advance);
  vcyl(0.022, 0.052, M.aluDark, 0, 0, 0, 32, swivel);
  const grips = [0, 1].map(g => {
    const side = robotFrame(swivel, "FANUC tool side " + g);
    side.rotation.y = g * Math.PI;
    const tipZ = FANUC.tool - advance;
    const mount = robotFrame(side, "FANUC gripper " + g, -lateral, 0, tipZ);
    rbox(lateral, 0.030, 0.018, 0.004, M.aluDark, -lateral / 2, 0, -0.012, side);
    rbox(0.026, 0.034, Math.abs(tipZ - (-0.012)) + 0.016, 0.004, M.aluDark, -lateral, 0, (tipZ - 0.012) / 2, side);
    rbox(0.072, 0.102, 0.028, 0.007, M.aluMachined, 0, 0, -0.044, mount);
    const fingers = [-1, 1].map(sign => {
      const finger = robotFrame(mount, "Parallel jaw");
      rbox(0.032, 0.015, 0.046, 0.003, M.steel, 0, 0, -0.016, finger);
      rbox(0.030, 0.005, 0.022, 0.001, dark, 0, -sign * 0.009, -0.002, finger);
      return finger;
    });
    const marker = robotFrame(mount, "FANUC grip point " + g);
    return { marker, fingers };
  });
  return { flange, tcp, swivel, piston, advance, swivelStroke, grips, joints: [j1, j2, j3, j4, j5, j6] };
})();
window.__robotMarkers = { fanuc: { flange: fanucScene.flange, tcp: fanucScene.tcp } };

function poseFanuc(t) {
  const { S, segs } = current();
  const [lo, hi, mix] = robotSample(t);
  const q = mixVec(S.fq[lo], S.fq[hi], mix);
  fanucScene.joints.forEach((joint, i) => { joint.rotation[i === 1 || i === 2 || i === 4 ? "y" : "z"] = q[i]; });
  const swAngle = lerp(S.fSwivel[lo], S.fSwivel[hi], mix);
  const swZ = fanucScene.advance + fanucScene.swivelStroke * Math.sin(swAngle);
  fanucScene.swivel.rotation.y = swAngle;
  fanucScene.swivel.position.z = swZ;
  fanucScene.piston.position.z = swZ;
  const segment = segs.fanuc.find(s => t >= s.t0 && t < s.t1);
  fanucScene.grips.forEach(({ fingers }, g) => {
    const active = S.fGrip[lo] === g;
    const closing = active && segment?.kind === "pick" ? clamp((t - segment.t0) / (segment.t1 - segment.t0), 0, 1) : 0;
    const gap = S.fHeld[lo][g] !== null ? 0.052 : lerp(0.063, 0.052, closing);
    fingers.forEach((finger, i) => { finger.position.y = (2 * i - 1) * gap; });
  });
}
