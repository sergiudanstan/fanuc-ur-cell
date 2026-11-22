const urScene = (() => {
  const { d1, a2, a3, d4, d5, d6 } = UR.dh;
  const silver = M.aluBlasted, white = M.whitePOM;
  const base = robotBase("ur");
  hcylZ(0.076, 0.016, M.aluDark, 0, 0, 0.008, 36, base);
  hcylZ(0.065, 0.081, silver, 0, 0, 0.053, 36, base);
  const joints = [];
  let frame = base;
  const rows = [[0, d1, HALF_PI], [a2, 0, 0], [a3, 0, 0],
    [0, d4, HALF_PI], [0, d5, -HALF_PI], [0, d6, 0]];
  rows.forEach(([a, d, alpha], i) => {
    const joint = robotFrame(frame, "UR5e J" + (i + 1));
    joints.push(joint);
    frame = robotFrame(joint, "UR5e link " + (i + 1), a, 0, d);
    frame.rotation.x = alpha;
    const radius = [0.067, 0.063, 0.054, 0.043, 0.042, 0.039][i];
    const center = i < 3 ? Math.max(0, d - 0.045) : d * 0.35;
    hcylZ(radius, i < 3 ? 0.096 : 0.072, white, 0, 0, center, 36, joint);
    hcylZ(radius * 0.84, 0.012, M.urBlue, 0, 0, center + (i === 0 ? -0.050 : -0.037), 36, joint);
    if (a) {
      hcylX(radius * 0.69, -a, silver, a / 2, 0, 0.019, 36, joint);
      for (const x of [-0.055, a + 0.052]) {
        hcylX(radius * 0.76, 0.055, white, x, 0, 0.019, 36, joint);
      }
    } else {
      hcylZ(radius * 0.71, d * 0.67, silver, 0, 0, d * 0.65, 36, joint);
    }
  });
  const flange = frame;
  flange.name = "UR5e flange";
  const tcp = robotFrame(flange, "UR5e TCP", 0, 0, UR.tool);
  hcylZ(0.032, 0.012, M.aluDark, 0, 0, 0.006, 32, flange);
  rbox(0.105, 0.063, 0.052, 0.008, M.aluMachined, 0, 0, 0.035, flange);
  hcylZ(0.018, 0.072, M.aluDark, 0, 0, 0.087, 32, flange);
  hcylZ(0.009, 0.026, M.steel, 0, 0, 0.131, 24, flange);
  hcylZ(0.0038, 0.010, M.steel, 0, 0, UR.tool - 0.005, 16, flange);
  rbox(0.027, 0.041, 0.070, 0.006, M.aluDark, 0.058, 0, 0.061, flange);
  tubeAlong([V(0.056, 0, 0.030), V(0.075, 0.034, 0.048), V(0.059, 0.038, 0.116),
    V(0.022, 0.018, 0.128), V(0.009, 0.006, 0.136)], 0.005, M.urBlue, flange, 24, 10);
  const fingers = [-1, 1].map(sign => {
    const finger = robotFrame(flange, "UR5e cover jaw");
    rbox(0.010, 0.024, 0.077, 0.003, M.steel, 0, 0, 0.097, finger);
    rbox(0.009, 0.024, 0.022, 0.002, M.blackPlastic, -sign * 0.004, 0, 0.147, finger);
    return finger;
  });
  return { flange, tcp, joints, fingers };
})();
window.__robotMarkers.ur = { flange: urScene.flange, tcp: urScene.tcp };

function poseUr(t) {
  const { S } = current();
  const [lo, hi, mix] = robotSample(t);
  mixVec(S.uq[lo], S.uq[hi], mix).forEach((q, i) => { urScene.joints[i].rotation.z = q; });
  const carrying = partSchedule().some(({ acquire, cover }) => t >= acquire && t < cover);
  urScene.fingers.forEach((finger, i) => { finger.position.x = (2 * i - 1) * (carrying ? 0.0515 : 0.067); });
}
