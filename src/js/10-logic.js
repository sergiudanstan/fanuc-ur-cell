// @@logic-start
const CELL = {
  infeed:  { x0: -1.80, x1: 0.10, z: -0.60, top: 0.80, width: 0.30, speed: 0.10 },
  pickWin: { x0: -0.45, x1: -0.05 },            // FANUC pick window on the infeed belt
  outfeed: { x0: 0.30, x1: 1.60, z: -0.40, top: 0.80, width: 0.30, speed: 0.20 },
  fanuc:   { base: [0.00, 0.60, -0.05], yaw: 0 },        // pedestal top = robot mounting plane
  ur:      { base: [0.00, 0.80, 0.85], yaw: Math.PI },   // table top = robot mounting plane
  fixture: { pos: [0.00, 0.80, 0.25] },                  // table top centre under the housing
  rejectBin: { pos: [-0.45, 0.65, 0.20], size: [0.30, 0.25, 0.30] }, // pos = top-centre of opening
  trays:   [ { pos: [0.55, 0.80, 0.95] }, { pos: [0.55, 0.80, 1.20] } ], // 2 × 3 grid, pitch 0.10
  camera:  [0.00, 1.45, 0.25],
  scanner: { center: [0.00, 0.85], warn: 1.20, protect: 0.60 }, // xz centre, radii
  operator:{ aisle: [0.55, 2.40], station: [0.55, 1.70] },      // xz positions
  fence:   { x0: -1.00, x1: 1.00, z0: -0.95, z1: 0.30, h: 2.00 }, // window at the fixture
  housing: [0.12, 0.06, 0.08],                                   // x, y, z size
};
const N_PARTS = 12;
const REJECTS = new Set([4, 9]);
const INTERLOCK_LAG = 0;
const ESC_X = -1.50;
const lcRad = Math.PI / 180;
const lcHalf = Math.PI / 2;
const FANUC = {
  name: "FANUC LR Mate 200iD/7L",
  dh: { d1: 0.330, a1: 0.050, a2: 0.440, a3: 0.035, d4: 0.420, d6: 0.080 },
  lim: [[-170, 170], [-90, 155], [-215, 215], [-190, 190], [-125, 125], [-360, 360]]
    .map(pair => pair.map(x => x * lcRad)),
  vmax: [370, 310, 410, 550, 545, 1000].map(x => x * lcRad),
  tool: 0.100, vTcp: 1.50, aTcp: 6,
};
const UR = {
  name: "UR5e",
  dh: { d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 },
  // UR SW10.13 UR5e technical specifications give the elbow range as ±160°.
  // https://www.universal-robots.com/manuals/EN/HTML/SW10_13/Content/prod-usr-man/complianceUR5e/H_g5_sections/appendix_g5/tech_spec_sheet.htm
  lim: [360, 360, 160, 360, 360, 360].map(x => [-x * lcRad, x * lcRad]),
  vmax: Array(6).fill(Math.PI),
  tool: 0.150, vTcp: 1.00, aTcp: 2.5,
};

const lcClamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const lcAdd = (a, b) => a.map((x, j) => x + b[j]);
const lcSub = (a, b) => a.map((x, j) => x - b[j]);
const lcScale = (a, s) => a.map(x => x * s);
const lcDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lcCross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const lcCol = (R, j) => [R[0][j], R[1][j], R[2][j]];
const lcTranspose = R => [lcCol(R, 0), lcCol(R, 1), lcCol(R, 2)];
const lcApply = (R, p) => R.map(row => lcDot(row, p));
const lcMul = (A, B) => {
  const columns = lcTranspose(B);
  return A.map(row => columns.map(col => lcDot(row, col)));
};
const lcMix = (a, b, s) => a.map((x, j) => x + s * (b[j] - x));
function lcRx(q) {
  const c = Math.cos(q), s = Math.sin(q);
  return [[1,0,0],[0,c,-s],[0,s,c]];
}
function lcRy(q) {
  const c = Math.cos(q), s = Math.sin(q);
  return [[c,0,s],[0,1,0],[-s,0,c]];
}
function lcRz(q) {
  const c = Math.cos(q), s = Math.sin(q);
  return [[c,-s,0],[s,c,0],[0,0,1]];
}
// Base Z is up, base X is forward, base Y maps to world -Z before the
// right-handed world-Y yaw about the mounting point. Tool advance is local +Z.
const lcBaseRotation = actor => lcMul(lcRy(CELL[actor].yaw), [[1,0,0],[0,0,1],[0,-1,0]]);
const lcFB = lcBaseRotation("fanuc"), lcUB = lcBaseRotation("ur");

function lcForward(actor, q, links) {
  const fanuc = actor === "fanuc";
  const robot = fanuc ? FANUC : UR;
  const { dh, tool } = robot;
  let p = CELL[actor].base, R = fanuc ? lcFB : lcUB;
  const points = links ? [p] : null;
  const step = (offset, rotation) => {
    p = lcAdd(p, lcApply(R, offset));
    if (rotation) R = lcMul(R, rotation);
    if (points) points.push(p);
  };
  if (fanuc) {
    // At zero the upper arm points up, forearm and flange point forward.
    // J1 rotates about base +Z, J2/J3 about successive +Y axes, then
    // J4/J5/J6 about tool-frame +Z/+Y/+Z (positive right-hand rotations).
    step([0,0,dh.d1], lcRz(q[0]));
    step([dh.a1,0,0], lcRy(q[1]));
    step([0,0,dh.a2], lcRy(q[2]));
    step([dh.d4,0,dh.a3], lcMul(lcRy(lcHalf), lcMul(lcRz(q[3]), lcMul(lcRy(q[4]), lcRz(q[5])))));
    step([0,0,dh.d6]);
  } else {
    // Standard DH zero: all theta = 0, long links point along base -X.
    // Each joint rotates right-handed about the preceding frame's +Z.
    const a = [0,dh.a2,dh.a3,0,0,0];
    const d = [dh.d1,0,0,dh.d4,dh.d5,dh.d6];
    const alpha = [lcHalf,0,0,lcHalf,-lcHalf,0];
    for (let j = 0; j < 6; j++) {
      step([a[j]*Math.cos(q[j]), a[j]*Math.sin(q[j]), d[j]], lcMul(lcRz(q[j]), lcRx(alpha[j])));
    }
  }
  step([0,0,tool]);
  return points ?? { p, R };
}
function fanucFK(q) { return lcForward("fanuc", q, false); }
function urFK(q) { return lcForward("ur", q, false); }
function fanucLinks(q) { return lcForward("fanuc", q, true); }
function urLinks(q) { return lcForward("ur", q, true); }

function lcNearest(branches, lim, ref) {
  const turn = 2 * Math.PI;
  let best = null, score = Infinity;
  for (const branch of branches) {
    const q = branch.map((x, j) => {
      const [lo, hi] = lim[j];
      const first = Math.ceil((lo - x - 1e-10) / turn);
      const last = Math.floor((hi - x + 1e-10) / turn);
      return first > last ? NaN : lcClamp(x + turn * lcClamp(Math.round((ref[j] - x) / turn), first, last), lo, hi);
    });
    const cost = q.reduce((sum, x, j) => sum + (x - ref[j]) ** 2, 0);
    if (cost < score) { best = q; score = cost; }
  }
  return best;
}
function lcAcos(x) {
  return Math.abs(x) <= 1 + 1e-10 ? Math.acos(lcClamp(x, -1, 1)) : NaN;
}
function fanucIK(p, R, qRef = Array(6).fill(0)) {
  const { dh, lim, tool } = FANUC;
  const inv = lcTranspose(lcFB);
  R = lcMul(inv, R);
  const w = lcSub(lcApply(inv, lcSub(p, CELL.fanuc.base)), lcScale(lcCol(R, 2), tool + dh.d6));
  const azimuth = Math.hypot(w[0], w[1]) < 1e-12 ? qRef[0] : Math.atan2(w[1], w[0]);
  const forearm = Math.hypot(dh.d4, dh.a3), bend = Math.atan2(dh.d4, dh.a3);
  const branches = [];
  for (const j1 of [azimuth, azimuth + Math.PI]) {
    const x = w[0]*Math.cos(j1) + w[1]*Math.sin(j1) - dh.a1, z = w[2] - dh.d1;
    const elbow = lcAcos((x*x + z*z - dh.a2**2 - forearm**2) / (2*dh.a2*forearm));
    if (!Number.isFinite(elbow)) continue;
    for (const e of [elbow, -elbow]) {
      const j2 = Math.atan2(x, z) - Math.atan2(forearm*Math.sin(e), dh.a2 + forearm*Math.cos(e));
      const j3 = e - bend;
      const arm = lcMul(lcRz(j1), lcRy(j2 + j3 + lcHalf));
      const W = lcMul(lcTranspose(arm), R);
      const j5 = Math.atan2(Math.hypot(W[0][2], W[1][2]), W[2][2]);
      if (Math.sin(j5) < 1e-10) {
        const sign = W[2][2] >= 0 ? 1 : -1;
        const phase = Math.atan2(sign * W[1][0], sign * W[0][0]);
        for (let n = -3; n <= 3; n++) {
          const sum = phase + 2*Math.PI*n;
          const bounds = lim[5].map(x => sum - sign*x).sort((a,b) => a-b);
          const lo = Math.max(lim[3][0], bounds[0]), hi = Math.min(lim[3][1], bounds[1]);
          if (lo <= hi) {
            const j4 = lcClamp((qRef[3] + sum - sign*qRef[5])/2, lo, hi);
            branches.push([j1,j2,j3,j4,j5,sign*(sum-j4)]);
          }
        }
      } else {
        const j4 = Math.atan2(W[1][2], W[0][2]), j6 = Math.atan2(W[2][1], -W[2][0]);
        branches.push([j1,j2,j3,j4,j5,j6], [j1,j2,j3,j4+Math.PI,-j5,j6+Math.PI]);
      }
    }
  }
  return lcNearest(branches, lim, qRef);
}
function urIK(p, R, qRef = Array(6).fill(0)) {
  const { dh, lim, tool } = UR;
  const inv = lcTranspose(lcUB);
  R = lcMul(inv, R);
  const w = lcSub(lcApply(inv, lcSub(p, CELL.ur.base)), lcScale(lcCol(R, 2), tool + dh.d6));
  const azimuth = Math.atan2(w[1], w[0]), radius = Math.hypot(w[0], w[1]);
  const shoulder = lcAcos(dh.d4 / radius);
  if (!Number.isFinite(shoulder)) return null;
  const branches = [];
  for (const j1 of [azimuth + lcHalf - shoulder, azimuth + lcHalf + shoulder]) {
    const radial = [Math.cos(j1), Math.sin(j1), 0], tangent = [-radial[1], radial[0], 0];
    const x6 = -lcDot(tangent, lcCol(R, 0)), y6 = lcDot(tangent, lcCol(R, 1));
    const sinWrist = Math.hypot(x6, y6);
    const wrist = Math.atan2(sinWrist, -lcDot(tangent, lcCol(R, 2)));
    const roll = Math.atan2(y6, x6);
    // At wrist singularity q6 is free. Start with the reference and also
    // consider rolls aimed towards and away from the shoulder in the arm plane.
    let wrists = [[wrist,roll], [-wrist,roll+Math.PI]];
    if (sinWrist < 1e-10) {
      const delta = lcSub(w, [0,0,dh.d1]);
      const aim = Math.atan2(lcDot(delta,lcCol(R,0)), lcDot(delta,lcCol(R,1)));
      wrists = [qRef[5], aim, aim+Math.PI].map(j6 => [wrist,j6]);
    }
    for (const [j5,j6] of wrists) {
      const R4 = lcMul(R, lcMul(lcRz(-j6), lcMul(lcRx(lcHalf), lcRz(-j5))));
      const p4 = lcSub(w, lcScale(lcCol(R4, 2), dh.d5));
      const x = lcDot(radial, p4), y = p4[2] - dh.d1;
      const elbow = lcAcos((x*x + y*y - dh.a2**2 - dh.a3**2) / (2*dh.a2*dh.a3));
      if (!Number.isFinite(elbow)) continue;
      const x4 = lcCol(R4, 0), pitch = Math.atan2(x4[2], lcDot(radial, x4));
      for (const j3 of [elbow, -elbow]) {
        const j2 = Math.atan2(-y, -x) - Math.atan2(-dh.a3*Math.sin(j3), -dh.a2 - dh.a3*Math.cos(j3));
        branches.push([j1,j2,j3,pitch-j2-j3,j5,j6]);
      }
    }
  }
  return lcNearest(branches, lim, qRef);
}

const lcDt = 0.02;
const lcGrid = t => Math.ceil(t/lcDt - 1e-8) * lcDt;
const lcDown = [[1,0,0],[0,0,-1],[0,1,0]];
function lcMotion(from, to, vmax, accel) {
  const length = Math.hypot(...lcSub(to, from));
  if (length === 0) return { duration: 0, at: () => from };
  const ramp = Math.min(vmax/accel, Math.sqrt(length/accel));
  const span = ramp + length/(accel*ramp);
  const duration = lcGrid(span);
  return { duration, at(elapsed) {
    const t = lcClamp(elapsed/duration, 0, 1) * span;
    const displacement = t < ramp ? accel*t*t/2 :
      t > span-ramp ? length-accel*(span-t)**2/2 : accel*ramp*(t-ramp/2);
    return lcMix(from, to, displacement/length);
  } };
}

function lcClearance(f, u) {
  let best = Infinity;
  for (let i = 1; i < f.length; i++) {
    const a = lcSub(f[i], f[i-1]), aa = lcDot(a,a);
    for (let j = 1; j < u.length; j++) {
      const b = lcSub(u[j], u[j-1]), bb = lcDot(b,b), w = lcSub(f[i-1], u[j-1]);
      const ab = lcDot(a,b), aw = lcDot(a,w), bw = lcDot(b,w);
      const squared = (s,t) => (w[0]+s*a[0]-t*b[0])**2 +
        (w[1]+s*a[1]-t*b[1])**2 + (w[2]+s*a[2]-t*b[2])**2;
      const project = x => lcClamp(x, 0, 1);
      let d = Math.min(squared(0,project(bw/bb)), squared(1,project((bw+ab)/bb)),
        squared(project(-aw/aa),0), squared(project((ab-aw)/aa),1));
      const n = lcCross(a,b), det = lcDot(n,n);
      if (det > 1e-24) {
        const s = lcDot(lcCross(b,w),n)/det, t = lcDot(lcCross(a,w),n)/det;
        if (s >= 0 && s <= 1 && t >= 0 && t <= 1) d = Math.min(d,squared(s,t));
      }
      best = Math.min(best, Math.sqrt(d) - (i === f.length-1 ? 0.05 : 0.06)
        - (j === u.length-1 ? 0.05 : 0.055));
    }
  }
  return best;
}

function cycleFor(beltSpeed = CELL.infeed.speed) {
  if (!Number.isFinite(beltSpeed) || beltSpeed <= 0 || beltSpeed > 0.20) {
    throw new RangeError("Belt speed must be in (0, 0.20] m/s");
  }
  const parts = [], trays = { swaps: [] };
  const segs = { fanuc: [], ur: [], camera: [], operator: [] };
  const zones = { fixture: { fanuc: [], ur: [], camera: [] } };
  const clock = { fanuc: 0, ur: 0, camera: 0, operator: 0 };
  const paths = { fanuc: [], ur: [] };
  const fHome = [0.34,1.09,-0.33], uHome = [0.48,1.12,1.08];
  const pose = { fanuc: fHome, ur: uHome };
  let fixtureFree = 0;
  function append(actor, t1, kind, fields, at) {
    const t0 = clock[actor];
    if (t1 <= t0 + 1e-9) return;
    segs[actor].push({ t0, t1, kind, ...fields });
    if (paths[actor]) {
      const fixed = pose[actor];
      paths[actor].push(at ?? (() => fixed));
    }
    clock[actor] = t1;
  }
  const pause = (actor, t) => append(actor, t, actor === "operator" ? "away" : "wait");
  function reserve(actor, tReady) {
    const start = Math.max(tReady, fixtureFree - INTERLOCK_LAG);
    pause(actor, start);
    return start;
  }
  function vacate(actor, start) {
    fixtureFree = clock[actor];
    zones.fixture[actor].push([start, fixtureFree]);
  }
  const inWarning = p => Math.hypot(...lcSub(p, CELL.scanner.center)) <= CELL.scanner.warn;
  function operatorPosition(t, segment) {
    const { aisle, station } = CELL.operator;
    if (segment?.kind === "swap") return station;
    if (segment?.kind === "walk_in" || segment?.kind === "walk_out") {
      const s = lcClamp((t-segment.t0)/(segment.t1-segment.t0), 0, 1);
      return lcMix(aisle, station, segment.kind === "walk_in" ? s : 1-s);
    }
    return aisle;
  }
  function warningDuring(t0, t1) {
    return segs.operator.some(s => {
      const from = Math.max(t0-lcDt, s.t0), to = Math.min(t1+lcDt, s.t1);
      // On either walk the distance to scanner centre changes monotonically.
      return from <= to && (inWarning(operatorPosition(from, s)) || inWarning(operatorPosition(to, s)));
    });
  }
  function move(actor, to, kind = "move", fields) {
    const robot = actor === "fanuc" ? FANUC : UR;
    const speed = actor === "fanuc" ? 0.72 : 0.55;
    const start = clock[actor];
    let motion = lcMotion(pose[actor], to, speed, robot.aTcp * 0.65);
    if (actor === "ur" && warningDuring(start, start+motion.duration)) {
      motion = lcMotion(pose[actor], to, 0.24, robot.aTcp * 0.65);
    }
    append(actor, lcGrid(start + motion.duration), kind, fields, motion.at);
    pose[actor] = to;
  }
  function dwell(actor, duration, kind, fields) {
    append(actor, lcGrid(clock[actor] + duration), kind, fields);
  }

  // Housing TCP at its centre, cover TCP at the centre of its top face, screw
  // TCP at its head. Tray columns at x ±0.10 or 0, rows at z ±0.05, lid top
  // at tray.y + 0.027. Mounted lid top is fixture.y + 0.070. Holes are ordered
  // by rows at z ±0.024, each with x -0.032 then +0.032.
  const fixture = CELL.fixture.pos;
  const housing = lcAdd(fixture, [0,CELL.housing[1]/2,0]);
  const lid = lcAdd(fixture, [0,0.070,0]);
  const fEntry = [0.30,1.08,0.10], fAbove = [0,1.06,0.25];
  const uEntry = [0.16,1.08,0.50], uAbove = [0,1.04,0.25];
  // The active gripper g tracks fTcp and rests at swivel angle g * PI.
  // A swivel interpolates the angle and activates the other gripper at its end.
  // fHeld lists both slots. Pick/unload acquire at the segment end, and
  // load/place release at the segment end. Only the active slot handles parts.
  const swivel = () => dwell("fanuc", 0.40, "swivel");
  function place(k) {
    const part = parts[k];
    const out = [0.51,CELL.outfeed.top + CELL.housing[1]/2,CELL.outfeed.z];
    const bin = lcAdd(CELL.rejectBin.pos,[0,0.04,0]);
    if (part.reject) {
      move("fanuc", [-0.43,1.06,0.25]);
      move("fanuc", bin, "place_bin", { k });
      part.end = { t: lcGrid(clock.fanuc+0.30), p: lcAdd(bin,[0,-0.26,0]) };
      move("fanuc", [-0.43,1.06,0.25]);
      move("fanuc", fEntry);
    } else {
      move("fanuc", [out[0],1.07,out[2]]);
      move("fanuc", out, "place_out", { k });
      part.end = { t: clock.fanuc, p: out };
    }
    move("fanuc", fHome);
  }
  let previousCoverStart = 0;
  for (let k = 0; k < N_PARTS; k++) {
    const from = [-0.22,CELL.infeed.top + CELL.housing[1]/2,CELL.infeed.z];
    const ramp = 0.20, grip = 0.30;
    const lead = lcAdd(from, [-beltSpeed*ramp/2,0,0]);
    const end = lcAdd(from, [beltSpeed*grip,0,0]);
    const trail = lcAdd(end, [beltSpeed*ramp/2,0,0]);
    const travel = (from[0]-ESC_X)/beltSpeed;
    pause("fanuc", lcGrid(travel-ramp-2));
    move("fanuc", [lead[0],1.07,lead[2]]);
    move("fanuc", lead);
    pause("fanuc", lcGrid(Math.max(travel, previousCoverStart) - ramp));
    append("fanuc", lcGrid(clock.fanuc+ramp), "move", undefined,
      t => lcAdd(lead,[beltSpeed*t*t/(2*ramp),0,0]));
    const pick = clock.fanuc;
    append("fanuc", lcGrid(pick+grip), "pick", { k }, t => lcAdd(from,[beltSpeed*t,0,0]));
    append("fanuc", lcGrid(clock.fanuc+ramp), "move", undefined,
      t => lcAdd(end,[beltSpeed*(t-t*t/(2*ramp)),0,0]));
    pose.fanuc = trail;
    const reject = REJECTS.has(k);
    parts.push({ k, reject, dest: reject ? "bin" : "out", cover: true, screws: 4,
      release: pick-travel, pick: { t: pick, tcp: from, part: from } });
    move("fanuc", [trail[0],1.07,trail[2]]);
    move("fanuc", fHome);
    move("fanuc", fEntry);
    if (k) swivel(); // Present the empty slot before entering the fixture.
    const load = reserve("fanuc", clock.fanuc);
    move("fanuc", fAbove);
    if (k) {
      move("fanuc", housing, "unload", { k: k-1 });
      move("fanuc", fAbove);
      swivel();
    }
    move("fanuc", housing, "load", { k });
    move("fanuc", fAbove);
    move("fanuc", fEntry);
    vacate("fanuc", load);
    if (k) {
      swivel(); // Present the finished housing after leaving the fixture.
      place(k-1);
    } else {
      move("fanuc", fHome);
    }

    const tray = Math.floor(k/6), slot = k%6;
    const cover = lcAdd(CELL.trays[tray].pos, [(slot%3-1)*0.10,0.027,slot<3 ? -0.05 : 0.05]);
    const aboveCover = lcAdd(cover,[0,0.13,0]);
    const assembly = reserve("ur", clock.ur);
    move("ur", aboveCover);
    move("ur", cover, "move", { k, tray, slot });
    move("ur", aboveCover, "move", { k, tray, slot });
    if (slot === 5) {
      pause("operator", clock.ur);
      dwell("operator", 1.40, "walk_in");
      const t0 = clock.operator;
      dwell("operator", 8, "swap", { tray });
      trays.swaps.push({ t0, t1: clock.operator, tray });
      dwell("operator", 1.40, "walk_out");
    }
    move("ur", uEntry);
    move("ur", uAbove);
    previousCoverStart = clock.ur;
    move("ur", lid, "cover", { k, tray, slot });
    for (let i = 0; i < 4; i++) {
      const hole = lcAdd(lid,[i%2 ? 0.032 : -0.032,0,i<2 ? -0.024 : 0.024]);
      move("ur", lcAdd(pose.ur,[0,0.045,0]));
      move("ur", lcAdd(hole,[0,0.045,0]));
      move("ur", hole);
      dwell("ur", 1, "screw", { k, i });
    }
    move("ur", uAbove);
    move("ur", uEntry);
    vacate("ur", assembly);
    move("ur", uHome);

    const inspect = reserve("camera", clock.camera);
    dwell("camera", 0.80, "inspect", { k });
    vacate("camera", inspect);
  }
  move("fanuc", fEntry);
  const lastUnload = reserve("fanuc", clock.fanuc);
  move("fanuc", fAbove);
  move("fanuc", housing, "unload", { k: N_PARTS-1 });
  move("fanuc", fAbove);
  move("fanuc", fEntry);
  vacate("fanuc", lastUnload);
  place(N_PARTS-1);
  const DURATION = Math.max(...Object.values(clock), ...parts.map(part => part.end.t));
  for (const actor of Object.keys(segs)) pause(actor, DURATION);
  const util = {};
  for (const actor of ["fanuc","ur","camera"]) {
    util[actor] = segs[actor].reduce((sum,s) => sum + (s.kind === "wait" ? 0 : s.t1-s.t0),0)/DURATION;
  }

  const S = { dt: lcDt, t: [], fq: [], uq: [], fTcp: [], uTcp: [], opIn: [], opPos: [], fGrip: [], fSwivel: [], fHeld: [] };
  const minClear = { m: Infinity, at: 0 };
  const indices = { fanuc: 0, ur: 0, operator: 0 };
  const segmentAt = (actor, t) => {
    const segments = segs[actor];
    while (indices[actor]+1 < segments.length && t >= segments[indices[actor]].t1-1e-9) indices[actor]++;
    return segments[indices[actor]];
  };
  let fq = [0,0,0,0,0,0], uq = [0,-1.6,1.7,0,-1.5,-2];
  let activeGrip = 0, completed = 0;
  const held = [null, null];
  for (let j = 0; j <= Math.round(DURATION/lcDt); j++) {
    const t = j*lcDt;
    const fs = segmentAt("fanuc",t), us = segmentAt("ur",t);
    while (completed < segs.fanuc.length && segs.fanuc[completed].t1 <= t + 1e-9) {
      const { kind, k } = segs.fanuc[completed++];
      if (kind === "swivel") activeGrip = 1-activeGrip;
      if (kind === "pick" || kind === "unload") held[activeGrip] = k;
      if (kind === "load" || kind === "place_out" || kind === "place_bin") held[activeGrip] = null;
    }
    const progress = fs.kind === "swivel" ? lcClamp((t-fs.t0)/(fs.t1-fs.t0), 0, 1) : 0;
    S.fGrip.push(activeGrip);
    S.fSwivel.push(Math.PI * (activeGrip + (1-2*activeGrip)*progress));
    S.fHeld.push([...held]);
    const f = paths.fanuc[indices.fanuc](t-fs.t0), u = paths.ur[indices.ur](t-us.t0);
    fq = fanucIK(f,lcDown,fq);
    uq = urIK(u,lcDown,uq);
    if (!fq || !uq) throw new Error(`Unreachable ${fq ? "UR" : "FANUC"} TCP at ${t}: ${fq ? u : f}`);
    const op = operatorPosition(t,segmentAt("operator",t));
    S.t.push(t);
    S.fq.push(fq); S.uq.push(uq);
    S.fTcp.push(f); S.uTcp.push(u);
    S.opPos.push(op); S.opIn.push(inWarning(op));
    const m = lcClearance(fanucLinks(fq),urLinks(uq));
    if (m < minClear.m) { minClear.m = m; minClear.at = t; }
  }
  return { beltSpeed, DURATION, parts, segs, zones, S, trays, minClear, util };
}
let lcModel;
function rebuild(beltSpeed = CELL.infeed.speed) {
  lcModel = cycleFor(beltSpeed);
  return lcModel;
}
function current() { return lcModel; }
rebuild(CELL.infeed.speed);
// @@logic-end
