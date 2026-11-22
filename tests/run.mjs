/*
 * CONTRACT
 * FANUC.dh = { d1: 0.330, a1: 0.050, a2: 0.440, a3: 0.035, d4: 0.420, d6: 0.080 }
 * UR.dh = { d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 }
 * lim is [[lo, hi] × 6] in radians (compare hi − lo to SPEC §3), vmax is [6] in rad/s,
 * tool is flange-to-TCP distance along the tool axis in metres (FANUC 0.100, UR 0.150),
 * and vTcp and aTcp are numbers in m/s and m/s².
 * name includes the model designation ("LR Mate 200iD/7L" or "UR5e").
 * DATE_ROBOTI.md corrections use | constantă | valoare | sursă | (source URL).
 * Keys use FANUC or UR followed by .dh.<parameter>, .lim[j] (total span),
 * .vmax[j], .tool, .vTcp or .aTcp. UR endpoints use UR.lim[j].lo / .hi.
 * Joint indices start at 0. Use ° or °/s for degrees, otherwise use SI units.
 * Models are data snapshots suitable for structuredClone. The evaluator
 * supplies a silent console.log.
 * FANUC pick/load/unload/place_out/place_bin, UR cover/screw and camera inspect
 * segments carry k (housing index). Screw segments also carry i (hole 0…3).
 * Match segments to housings only by k.
 * Logic exports ESC_X. Belt position at t is [ESC_X + v*(t − release),
 * CELL.infeed.top + CELL.housing[1]/2, CELL.infeed.z]. pick.part and pick.tcp
 * refer to the housing centre (grip point).
 * fanucLinks(q) and urLinks(q) return at least five world points from base
 * through flange to TCP. The last capsule has radius 0.05 m. The other
 * radii are 0.06 m for FANUC and 0.055 m for UR.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const file = args.find(arg => !arg.startsWith("--")) ?? resolve(root, "index.html");
const perturb = args.includes("--perturb");
const target = "const INTERLOCK_LAG = 0;";
const replacement = "const INTERLOCK_LAG = 1.5;";
const speeds = [0.05, 0.10, 0.15, 0.20];
const eps = 1e-9;
const rad = Math.PI / 180;
const rejectIds = [4, 9];
const partIds = Array.from({ length: 12 }, (_, k) => k);
const cell = {
  infeed: { x0: -1.80, x1: 0.10, z: -0.60, top: 0.80, width: 0.30, speed: 0.10 },
  pickWin: { x0: -0.45, x1: -0.05 },
  outfeed: { x0: 0.30, x1: 1.60, z: -0.40, top: 0.80, width: 0.30, speed: 0.20 },
  fanuc: { base: [0.00, 0.60, -0.05], yaw: 0 },
  ur: { base: [0.00, 0.80, 0.85], yaw: Math.PI },
  fixture: { pos: [0.00, 0.80, 0.25] },
  rejectBin: { pos: [-0.45, 0.65, 0.20], size: [0.30, 0.25, 0.30] },
  trays: [{ pos: [0.55, 0.80, 0.95] }, { pos: [0.55, 0.80, 1.20] }],
  camera: [0.00, 1.45, 0.25],
  scanner: { center: [0.00, 0.85], warn: 1.20, protect: 0.60 },
  operator: { aisle: [0.55, 2.40], station: [0.55, 1.70] },
  fence: { x0: -1.00, x1: 1.00, z0: -0.95, z1: 0.30, h: 2.00 },
  housing: [0.12, 0.06, 0.08],
};
const robots = [
  {
    key: "FANUC", actor: "fanuc", axis: "f", radius: 0.06, name: "LR Mate 200iD/7L",
    dh: { d1: 0.330, a1: 0.050, a2: 0.440, a3: 0.035, d4: 0.420, d6: 0.080 },
    ranges: [340, 245, 430, 380, 250, 720], speeds: [370, 310, 410, 550, 545, 1000],
    tool: 0.100, vTcp: 1.50, aTcp: 6,
  },
  {
    key: "UR", actor: "ur", axis: "u", radius: 0.055, name: "UR5e",
    dh: { d1: 0.1625, a2: -0.425, a3: -0.3922, d4: 0.1333, d5: 0.0997, d6: 0.0996 },
    ranges: Array(6).fill(720), speeds: Array(6).fill(180), tool: 0.150, vTcp: 1.00, aTcp: 2.5,
  },
];
const kinds = {
  fanuc: ["wait", "pick", "load", "unload", "swivel", "place_out", "place_bin", "move"],
  ur: ["wait", "cover", "screw", "move"],
  camera: ["wait", "inspect"],
  operator: ["away", "walk_in", "swap", "walk_out"],
};

function stop(code, message) {
  console.error(message);
  process.exit(code);
}

function evaluate(source) {
  const names = ["CELL", "FANUC", "UR", "N_PARTS", "REJECTS", "ESC_X",
    "fanucFK", "urFK", "fanucIK", "urIK", "fanucLinks", "urLinks", "rebuild", "cycleFor", "current"];
  // An absent export is malformed test data. An exception in the block itself is exit 3.
  const exports = names.map(name => `${name}: typeof ${name} === "undefined" ? undefined : ${name}`);
  try {
    return new Function("console", `${source}\nreturn { ${exports.join(", ")} };`)({ log() {} });
  } catch (error) {
    stop(3, `logic evaluation: ${messageOf(error)}`);
  }
}

function need(ok, message) {
  if (!ok) throw new Error(message);
}
const messageOf = error => String(error?.message ?? error).split("\n")[0];
const finite = Number.isFinite;
const close = (a, b, tolerance = eps) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const vector = (a, n) => Array.isArray(a) && a.length === n && Array.from(a).every(finite);
const distance = (a, b) => Math.hypot(...a.map((v, j) => v - b[j]));
const near = (a, b, tolerance) => vector(a, b.length) && distance(a, b) <= tolerance + eps;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(x, hi));
const byIndex = (a, b) => a - b;
const partSegments = (m, actor, kind, k) =>
  m.segs[actor].filter(segment => segment.kind === kind && segment.k === k);

function segment(m, actor, kind, k) {
  const matches = partSegments(m, actor, kind, k);
  need(matches.length === 1, `${actor} ${kind} ${k}: expected one segment, found ${matches.length}`);
  need(finite(matches[0].t0) && matches[0].t1 > matches[0].t0, `${kind} ${k}: invalid timing`);
  return matches[0];
}

function corrections() {
  let text;
  try {
    text = readFileSync(resolve(root, "DATE_ROBOTI.md"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    throw error;
  }
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trimStart().startsWith("|")) continue;
    const [key, raw, source] = line.trim().slice(1).split("|").map(s => s.trim().replaceAll("`", ""));
    if (!source || !key || !raw) continue;
    const match = raw.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(m|m\/s|m\/s²|m\/s\^2|°|deg|°\/s|deg\/s|rad|rad\/s)?$/i);
    if (match) rows.set(key, { value: Number(match[1]), unit: match[2] ?? "" });
  }
  return rows;
}

function constants(L) {
  assert.deepEqual(L.CELL, cell, "CELL differs from SPEC §2");
  assert.equal(L.N_PARTS, partIds.length, "N_PARTS");
  assert.deepEqual(L.REJECTS, new Set(rejectIds), "REJECTS");
  const documented = corrections();
  function compare(key, actual, expected) {
    const entry = documented.get(key);
    const degrees = entry && /^(?:°|deg)/.test(entry.unit);
    need(close(actual, expected) || (entry && close(actual, entry.value * (degrees ? rad : 1))),
      `${key}: got ${actual}, expected ${expected} or a documented correction`);
  }
  for (const spec of robots) {
    const r = L[spec.key];
    need(typeof r?.name === "string" && r.name.includes(spec.name), `${spec.key}.name`);
    assert.deepEqual(Object.keys(r.dh).sort(), Object.keys(spec.dh).sort(), `${spec.key}.dh keys`);
    for (const [key, value] of Object.entries(spec.dh)) compare(`${spec.key}.dh.${key}`, r.dh[key], value);
    need(Array.isArray(r.lim) && r.lim.length === 6 && Array.from(r.lim).every(pair => vector(pair, 2) && pair[1] > pair[0]),
      `${spec.key}.lim must contain six increasing intervals`);
    need(vector(r.vmax, 6), `${spec.key}.vmax must contain six speeds`);
    for (let j = 0; j < 6; j++) {
      compare(`${spec.key}.lim[${j}]`, r.lim[j][1] - r.lim[j][0], spec.ranges[j] * rad);
      compare(`${spec.key}.vmax[${j}]`, r.vmax[j], spec.speeds[j] * rad);
      if (spec.key === "UR") {
        compare(`UR.lim[${j}].lo`, r.lim[j][0], -360 * rad);
        compare(`UR.lim[${j}].hi`, r.lim[j][1], 360 * rad);
      }
    }
    for (const key of ["tool", "vTcp", "aTcp"]) compare(`${spec.key}.${key}`, r[key], spec[key]);
  }
}

function processParts(m) {
  need(finite(m.DURATION) && m.DURATION > 0, "invalid DURATION");
  assert.deepEqual(m.parts.map(p => p.k).sort(byIndex), partIds, "housing indices");
  for (const p of m.parts) {
    const reject = rejectIds.includes(p.k);
    need(p.reject === reject && p.dest === (reject ? "bin" : "out"), `housing ${p.k}: wrong destination`);
    need(p.cover === true && p.screws === 4, `housing ${p.k}: cover or screws missing`);
    const place = segment(m, "fanuc", reject ? "place_bin" : "place_out", p.k);
    need(finite(p.end.t) && p.end.t >= 0 && p.end.t >= place.t1 - eps && p.end.t <= m.DURATION + eps,
      `housing ${p.k}: settled at ${p.end.t} s, expected between placement end ${place.t1} and cycle end ${m.DURATION} s`);
    need(vector(p.end.p, 3), `housing ${p.k}: invalid settled position`);
    const b = cell.rejectBin;
    const [x, y, z] = p.end.p;
    if (reject) {
      need(Math.abs(x - b.pos[0]) <= b.size[0] / 2 + eps &&
        Math.abs(z - b.pos[2]) <= b.size[2] / 2 + eps &&
        y >= b.pos[1] - b.size[1] - eps && y <= b.pos[1] + eps, `housing ${p.k}: outside bin`);
    } else {
      const belt = cell.outfeed;
      need(x >= belt.x0 - eps && x <= belt.x1 + eps && Math.abs(z - belt.z) <= belt.width / 2 + eps &&
        close(y, belt.top + cell.housing[1] / 2, 0.002), `housing ${p.k}: off the outfeed`);
    }
  }
  need(m.segs.ur.filter(s => s.kind === "cover").length === 12, "expected twelve cover segments");
  need(Array.isArray(m.trays.swaps) && m.trays.swaps.length > 0, "no tray swap");
}

function verifyMutex(m) {
  const zones = m.zones.fixture;
  const intervals = ["fanuc", "ur", "camera"].flatMap(actor => {
    need(Array.isArray(zones[actor]) && zones[actor].length > 0, `${actor}: missing fixture intervals`);
    return zones[actor].map(pair => {
      need(vector(pair, 2) && pair[0] >= -eps && pair[1] > pair[0] &&
        pair[1] <= m.DURATION + eps, `${actor}: invalid fixture interval`);
      return { actor, t0: pair[0], t1: pair[1] };
    });
  }).sort((a, b) => a.t0 - b.t0);
  for (let j = 1; j < intervals.length; j++) {
    const previous = intervals[j - 1], next = intervals[j];
    need(next.t0 >= previous.t1 - eps, `fixture overlap: ${previous.actor} and ${next.actor} at ${next.t0} s`);
  }
  const covered = (actor, s) => zones[actor].some(([t0, t1]) => t0 <= s.t0 + eps && t1 >= s.t1 - eps);
  for (const k of partIds) {
    const pick = segment(m, "fanuc", "pick", k);
    const load = segment(m, "fanuc", "load", k);
    const unload = segment(m, "fanuc", "unload", k);
    const place = segment(m, "fanuc", rejectIds.includes(k) ? "place_bin" : "place_out", k);
    const cover = segment(m, "ur", "cover", k);
    const screws = partSegments(m, "ur", "screw", k).sort((a, b) => a.t0 - b.t0);
    const inspect = segment(m, "camera", "inspect", k);
    assert.deepEqual(screws.map(s => s.i).sort(byIndex), [0, 1, 2, 3], `housing ${k}: screw holes`);
    const sequence = [pick, load, cover, ...screws, inspect, unload, place];
    need(sequence.every((s, j) => finite(s.t0) && finite(s.t1) && s.t1 > s.t0 &&
      (!j || s.t0 >= sequence[j - 1].t1 - eps)), `housing ${k}: process order`);
    need(covered("fanuc", load) && covered("fanuc", unload) &&
      covered("ur", cover) && screws.every(s => covered("ur", s)) && covered("camera", inspect),
      `housing ${k}: fixture work is outside its declared interval`);
    need(screws.every(s => close(s.t1 - s.t0, 1)) && close(inspect.t1 - inspect.t0, 0.8),
      `housing ${k}: screw or inspection duration`);
  }
}

const gripperFields = ["fGrip", "fSwivel", "fHeld"];

function singleGripperModel(m) {
  return gripperFields.every(field => !(field in m.S)) && !m.segs.fanuc.some(s => s.kind === "swivel");
}

function verifyDualGripper(m, speed) {
  const swivels = m.segs.fanuc.filter(s => s.kind === "swivel");
  for (const k of partIds.slice(1)) {
    const pick = segment(m, "fanuc", "pick", k);
    const unload = segment(m, "fanuc", "unload", k - 1);
    const load = segment(m, "fanuc", "load", k);
    const place = segment(m, "fanuc", rejectIds.includes(k - 1) ? "place_bin" : "place_out", k - 1);
    need(pick.t1 <= unload.t0 + eps && load.t1 <= place.t0 + eps,
      `housing ${k}: expected pick before previous unload and load before previous placement`);
    const exchange = swivels.filter(s => unload.t1 <= s.t0 + eps && s.t1 <= load.t0 + eps);
    need(exchange.length === 1, `housing ${k}: expected one swivel between previous unload and load`);
    need(m.zones.fixture.fanuc.some(([t0, t1]) => t0 <= unload.t0 + eps && t1 >= load.t1 - eps),
      `housing ${k}: unload, swivel and load must share a FANUC fixture interval`);
    if (k >= 2) {
      const cover = segment(m, "ur", "cover", k - 1);
      const lastScrewEnd = Math.max(...partSegments(m, "ur", "screw", k - 1).map(s => s.t1));
      need(pick.t1 > cover.t0, `housing ${k}: pick finishes before or at the start of the previous housing's UR work`);
      need(pick.t1 < lastScrewEnd, `housing ${k}: pick ends after or with the previous housing's screws`);
    }
  }
  const { t, fGrip, fSwivel, fHeld } = m.S;
  for (const s of swivels) {
    need(close(s.t1 - s.t0, 0.40, 1e-6), `swivel at ${s.t0} s: expected 0.40 s`);
    // Bracket the motion with real samples even when its endpoints fall between ticks.
    const before = t.findLastIndex(time => time <= s.t0 + eps);
    const after = t.findIndex(time => time >= s.t1 - eps);
    need(before >= 0 && after > before && [0, 1].includes(fGrip?.[before]) &&
      fGrip[after] === 1 - fGrip[before], `swivel at ${s.t0} s: active gripper did not flip`);
  }
  for (let j = 0; j < t.length; j++) {
    need(fGrip?.[j] === 0 || fGrip?.[j] === 1, `invalid fGrip at sample ${j}`);
    const angle = fSwivel?.[j];
    need(finite(angle) && angle >= 0 && angle <= Math.PI, `invalid fSwivel at sample ${j}`);
    const held = fHeld?.[j];
    need(Array.isArray(held) && held.length === 2 && Array.from(held).every(k => k === null || partIds.includes(k)) &&
      (held[0] === null || held[0] !== held[1]), `invalid or duplicated housing in fHeld at sample ${j}`);
  }
  const busy = m.segs.ur.filter(s => s.kind !== "wait").reduce((sum, s) => sum + (s.t1 - s.t0), 0);
  const utilisation = busy / m.DURATION;
  need(close(m.util?.ur, utilisation), `UR utilisation: reported ${m.util?.ur}, measured ${utilisation}`);
  if (speed === 0.10) {
    need(utilisation >= 0.70 && m.util.ur >= 0.70, `UR utilisation below 0.70: measured ${utilisation}, reported ${m.util.ur}`);
  }
}

function segments(m) {
  for (const [actor, allowed] of Object.entries(kinds)) {
    let end = 0;
    for (const s of m.segs[actor]) {
      need(close(s.t0, end) && finite(s.t1) && s.t1 > s.t0 && allowed.includes(s.kind),
        `${actor}: invalid segment or gap at ${end}`);
      if (["pick", "load", "unload", "place_out", "place_bin", "cover", "screw", "inspect"].includes(s.kind)) {
        need(partIds.includes(s.k), `${actor} ${s.kind}: invalid housing index`);
      }
      end = s.t1;
    }
    need(m.DURATION > 0 && close(end, m.DURATION), `${actor}: timeline does not cover the full cycle`);
  }
}

function interpolate(t, samples, time) {
  need(time >= t[0] && time <= t.at(-1), `time ${time} outside sampled trajectory`);
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (t[mid] <= time) lo = mid;
    else hi = mid;
  }
  const fraction = (time - t[lo]) / (t[hi] - t[lo]);
  return samples[lo].map((x, j) => x + fraction * (samples[hi][j] - x));
}

function tracking(m, L, speed) {
  need(finite(L.ESC_X) && L.ESC_X >= cell.infeed.x0 + cell.housing[0] / 2 - eps &&
    L.ESC_X < cell.pickWin.x0, "ESC_X is outside the release region");
  need(m.parts.length === 12, "missing housings");
  for (const p of m.parts) {
    const s = segment(m, "fanuc", "pick", p.k);
    const start = p.pick.t, end = start + 0.30;
    need(close(s.t0, start) && close(s.t1, end) && finite(p.release) && p.release >= 0 && p.release <= start,
      `housing ${p.k}: invalid release or pick time`);
    const beltPoint = t => [L.ESC_X + speed * (t - p.release),
      cell.infeed.top + cell.housing[1] / 2, cell.infeed.z];
    const from = beltPoint(start), to = beltPoint(end);
    need(from[0] >= cell.pickWin.x0 - eps && to[0] <= cell.pickWin.x1 + eps,
      `housing ${p.k}: grip leaves the pick window`);
    need(near(p.pick.part, from, eps) && near(p.pick.tcp, from, 0.002), `housing ${p.k}: recorded pick pose`);
    for (const time of [start, end]) {
      need(near(interpolate(m.S.t, m.S.fTcp, time), beltPoint(time), 0.002),
        `housing ${p.k}: sampled TCP misses belt position at ${time} s`);
    }
  }
}

function randomSource() {
  let state = 0x8d40c9;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}
const randomQ = (lim, random) => lim.map(([lo, hi]) => lo + random() * (hi - lo));
const within = (q, lim) => vector(q, 6) && q.every((x, j) => x >= lim[j][0] - eps && x <= lim[j][1] + eps);

function validateRotation(R, context) {
  need(Array.isArray(R) && R.length === 3 && Array.from(R).every(row => vector(row, 3)),
    `${context}: expected a finite 3×3 rotation matrix`);
  for (let i = 0; i < 3; i++) {
    for (let j = i; j < 3; j++) {
      need(close(dot(R[i], R[j]), i === j ? 1 : 0, 1e-6), `${context}: rotation rows are not orthonormal`);
    }
  }
  need(close(dot(R[0], cross(R[1], R[2])), 1, 1e-6), `${context}: rotation determinant differs from +1`);
}

function rotationError(a, b) {
  const trace = a.reduce((sum, row, j) => sum + row.reduce((dot, x, k) => dot + x * b[j][k], 0), 0);
  return Math.acos(clamp((trace - 1) / 2, -1, 1));
}

function roundTrips(L) {
  const random = randomSource();
  for (const { key, actor } of robots) {
    const { lim } = L[key];
    const fk = L[actor + "FK"], ik = L[actor + "IK"];
    let firstPosition, moved = false;
    for (let j = 0; j < 300; j++) {
      const q = randomQ(lim, random);
      const ref = q.map((x, i) => clamp(x + 0.6 * random() - 0.3, ...lim[i]));
      const pose = fk(q);
      need(vector(pose.p, 3), `${actor} round trip ${j}: invalid FK position`);
      validateRotation(pose.R, `${actor} round trip ${j} target`);
      firstPosition ??= [...pose.p];
      if (!near(pose.p, firstPosition, 0.0001)) moved = true;
      // FK may reuse its output buffers. Keep the original target for the comparison.
      const targetP = [...pose.p], targetR = pose.R.map(row => [...row]);
      const solution = ik(pose.p, pose.R, ref);
      need(within(solution, lim), `${actor} round trip ${j}: no in-range IK solution`);
      const found = fk(solution);
      validateRotation(found.R, `${actor} round trip ${j} solution`);
      need(near(found.p, targetP, 0.0001) && rotationError(found.R, targetR) <= 0.1 * rad,
        `${actor} round trip ${j}: pose mismatch`);
    }
    const base = cell[actor].base;
    const ref = lim.map(([lo, hi]) => (lo + hi) / 2);
    need(ik([base[0] + 2, base[1], base[2]], fk(ref).R, ref) === null,
      `${actor}: IK accepted a target 2 m from base`);
    need(moved, `${actor}: FK returned the same TCP position within 0.1 mm across 300 joint configurations`);
  }
}

function sampleGrid(m) {
  const { t, dt } = m.S;
  need(close(dt, 0.02) && Array.isArray(t) && t.length >= 2 && close(t[0], 0) &&
    finite(m.DURATION) && Math.abs(t.at(-1) - m.DURATION) <= dt + eps, "invalid sample extent or dt");
  for (let j = 1; j < t.length; j++) {
    const step = t[j] - t[j - 1];
    const clippedEnd = j === t.length - 1 && close(t[j], m.DURATION) && step > 0 && step <= dt + eps;
    need(finite(t[j]) && (close(step, dt) || clippedEnd), `invalid time grid at sample ${j}`);
  }
  return t;
}

function trajectories(m, L) {
  const t = sampleGrid(m);
  // A wholly single-gripper model already fails [3]. Partial rev. 2 exports must fail [7].
  if (!singleGripperModel(m)) {
    for (const field of gripperFields) {
      need(Array.isArray(m.S[field]) && m.S[field].length === t.length, `S.${field}: expected ${t.length} samples`);
    }
  }
  for (const { key, actor, axis } of robots) {
    const { lim, vmax } = L[key];
    const q = m.S[axis + "q"], tcp = m.S[axis + "Tcp"];
    need(q.length === t.length && tcp.length === t.length, `${actor}: sample counts differ`);
    for (let j = 0; j < t.length; j++) {
      need(within(q[j], lim) && vector(tcp[j], 3) && near(L[actor + "FK"](q[j]).p, tcp[j], 0.0001),
        `${actor}: invalid joint positions or FK at sample ${j}`);
      if (j) need(q[j].every((x, k) => Math.abs(x - q[j - 1][k]) <= vmax[k] * (t[j] - t[j - 1]) * 1.05 + eps),
        `${actor}: joint speed at sample ${j}`);
    }
  }
}

function operatorAndSpeed(m, L) {
  const t = sampleGrid(m);
  const { opIn, opPos, fTcp, uTcp } = m.S;
  need([opIn, opPos, fTcp, uTcp].every(a => a.length === t.length), "operator/TCP sample counts differ");
  const operator = m.segs.operator;
  let index = 0, warningTime = 0;
  for (let j = 0; j < t.length; j++) {
    const p = opPos[j];
    need(vector(p, 2), `invalid operator position at sample ${j}`);
    const radius = distance(p, cell.scanner.center);
    need(opIn[j] === (radius <= cell.scanner.warn) && radius >= cell.scanner.protect,
      `scanner state or clearance at sample ${j}`);
    while (index + 1 < operator.length && t[j] >= operator[index].t1) index++;
    const kind = operator[index].kind;
    if (kind === "away" || kind === "swap") {
      need(near(p, cell.operator[kind === "away" ? "aisle" : "station"], 0.001),
        `operator at wrong position during ${kind} at sample ${j}`);
    }
    need(vector(fTcp[j], 3) && vector(uTcp[j], 3), `invalid TCP at sample ${j}`);
    if (!j) continue;
    const dt = t[j] - t[j - 1];
    const urLimit = opIn[j] ? Math.min(0.25, L.UR.vTcp) : L.UR.vTcp;
    if (opIn[j]) warningTime += dt;
    need(distance(fTcp[j], fTcp[j - 1]) <= L.FANUC.vTcp * dt * 1.01 + eps &&
      distance(uTcp[j], uTcp[j - 1]) <= urLimit * dt * 1.01 + eps, `TCP speed at sample ${j}`);
  }
  need(warningTime >= 8 - eps, `operator warning-field time: ${warningTime} s`);
  need(m.trays.swaps.length > 0, "no tray swaps");
  for (const swap of m.trays.swaps) {
    need(close(swap.t1 - swap.t0, 8) && [0, 1].includes(swap.tray) &&
      operator.some(s => s.kind === "swap" && s.t0 <= swap.t0 + eps && s.t1 >= swap.t1 - eps),
      "tray swap outside operator swap segment, wrong duration or unknown tray");
  }
}

const subtract = (a, b) => a.map((v, j) => v - b[j]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];

function capsules(points, radius) {
  return points.slice(1).map((end, j, ends) => {
    const start = points[j];
    const direction = subtract(end, start);
    return { start, direction, squared: dot(direction, direction), radius: j === ends.length - 1 ? 0.05 : radius };
  });
}

function capsuleClearance(a, b) {
  const u = a.direction, v = b.direction, w = subtract(a.start, b.start);
  const aa = a.squared, bb = b.squared;
  const uv = dot(u, v), uw = dot(u, w), vw = dot(v, w);
  function squaredAt(s, t) {
    return (w[0] + s * u[0] - t * v[0]) ** 2 +
      (w[1] + s * u[1] - t * v[1]) ** 2 + (w[2] + s * u[2] - t * v[2]) ** 2;
  }
  // The minimum is either on the perimeter of [0,1]² or at its stationary point.
  const project = (numerator, denominator) => denominator > 0 ? clamp(numerator / denominator, 0, 1) : 0;
  let minimum = Math.min(
    squaredAt(0, project(vw, bb)), squaredAt(1, project(vw + uv, bb)),
    squaredAt(project(-uw, aa), 0), squaredAt(project(uv - uw, aa), 1),
  );
  const normal = cross(u, v);
  const determinant = dot(normal, normal);
  if (determinant > 0) {
    const s = dot(cross(v, w), normal) / determinant;
    const t = dot(cross(u, w), normal) / determinant;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) minimum = Math.min(minimum, squaredAt(s, t));
  }
  return Math.sqrt(minimum) - a.radius - b.radius;
}

function checkedLinks(L, actor, q) {
  const points = L[actor + "Links"](q);
  need(Array.isArray(points) && points.length >= 5 && Array.from(points).every(p => vector(p, 3)),
    `${actor}: malformed capsule chain`);
  need(near(points[0], cell[actor].base, 0.0001) && near(points.at(-1), L[actor + "FK"](q).p, 0.0001),
    `${actor}: capsule endpoints disagree with base or FK`);
  const robot = actor === "fanuc" ? L.FANUC : L.UR;
  need(close(distance(points.at(-2), points.at(-1)), robot.tool, 1e-6),
    `${actor}: flange-to-TCP distance differs from tool length`);
  return points;
}

function rigidLinks(L) {
  const random = randomSource();
  for (const { actor, key } of robots) {
    let lengths;
    for (let j = 0; j < 50; j++) {
      const points = checkedLinks(L, actor, randomQ(L[key].lim, random));
      const measured = points.slice(1).map((p, k) => distance(p, points[k]));
      lengths ??= measured;
      need(lengths.length === measured.length && lengths.every((length, k) => close(length, measured[k], 1e-6)),
        `${actor}: capsule link lengths change with joint pose`);
    }
  }
}

function clearance(m, L) {
  const t = sampleGrid(m);
  const { fq, uq } = m.S;
  const reported = m.minClear;
  need(finite(reported.m) && finite(reported.at) && reported.at >= t[0] && reported.at <= t.at(-1),
    "invalid reported clearance or time");
  need(fq.length === t.length && uq.length === t.length, "clearance sample counts differ");
  let minimum = Infinity, nearestTime = Infinity, nearestClearance;
  for (let j = 0; j < t.length; j++) {
    const f = capsules(checkedLinks(L, "fanuc", fq[j]), robots[0].radius);
    const u = capsules(checkedLinks(L, "ur", uq[j]), robots[1].radius);
    let measured = Infinity;
    for (const a of f) {
      for (const b of u) measured = Math.min(measured, capsuleClearance(a, b));
    }
    minimum = Math.min(minimum, measured);
    const dt = Math.abs(t[j] - reported.at);
    if (dt < nearestTime) {
      nearestTime = dt;
      nearestClearance = measured;
    }
  }
  need(minimum >= 0.05 - eps && reported.m >= 0.05 - eps && close(minimum, reported.m, 0.001) &&
    close(nearestClearance, reported.m, 0.001),
    `capsule clearance: measured ${minimum} m, reported ${reported.m} m, at reported time ${nearestClearance} m`);
}

function determinism(L) {
  let previous = Infinity;
  for (const speed of speeds) {
    const active = L.current();
    const before = structuredClone(active);
    const cycle = structuredClone(L.cycleFor(speed));
    need(L.current() === active, "cycleFor replaced current model");
    assert.deepEqual(L.current(), before, "cycleFor mutated current model");
    const rebuilt = L.rebuild(speed);
    need(L.current() === rebuilt, "rebuild did not set the current model");
    need(close(rebuilt.beltSpeed, speed) && finite(rebuilt.DURATION) && rebuilt.DURATION > 0,
      "invalid model speed or duration");
    assert.deepEqual(rebuilt, cycle, "cycleFor and rebuild differ");
    const saved = structuredClone(rebuilt);
    assert.deepEqual(L.rebuild(speed), saved, "repeated rebuild differs");
    need(saved.DURATION <= previous + eps, "duration increased with belt speed");
    previous = saved.DURATION;
  }
}

function loadModels(L) {
  return speeds.map(speed => {
    try {
      return { speed, model: structuredClone(L.rebuild(speed)) };
    } catch (error) {
      return { speed, error };
    }
  });
}

function eachModel(models, check) {
  const errors = [];
  for (const { speed, model, error } of models) {
    try {
      if (error) throw error;
      check(model, speed);
    } catch (problem) {
      errors.push(`${speed.toFixed(2)} m/s: ${messageOf(problem)}`);
    }
  }
  need(errors.length === 0, errors.join(" | "));
}

function verifyPerturbation(models, baseline) {
  // The original single-gripper model remains a control for the interlock mutation.
  function checkProcess(model, speed) {
    verifyMutex(model);
    if (!singleGripperModel(model)) verifyDualGripper(model, speed);
  }
  let overlap = false;
  for (const [i, { model, speed, error }] of models.entries()) {
    if (error) throw error;
    try {
      checkProcess(model, speed);
    } catch (problem) {
      if (!messageOf(problem).startsWith("fixture overlap:")) throw problem;
      if (baseline) {
        if (baseline[i].error) throw baseline[i].error;
        // A pre-existing failure at this speed cannot demonstrate the effect of the lag.
        try {
          checkProcess(baseline[i].model, speed);
        } catch {
          continue;
        }
      }
      overlap = true;
    }
  }
  need(overlap, baseline ? "no speed changed from a passing check 3 to a fixture overlap" :
    "perturbed check 3 did not detect a fixture overlap");
}

let source;
try {
  source = readFileSync(file, "utf8");
} catch (error) {
  stop(2, `cannot read logic file: ${error.message}`);
}
const block = source.match(/^[\t ]*\/\/ @@logic-start[\t ]*\r?\n([\s\S]*?)^[\t ]*\/\/ @@logic-end[\t ]*\r?$/m);
if (!block) stop(2, "logic markers not found");
const code = block[1];
if (!code.includes(target)) stop(2, "perturbation target not found");
const perturbedCode = code.replace(target, replacement);
const L = evaluate(perturb ? perturbedCode : code);
const perturbed = perturb ? L : evaluate(perturbedCode);
const models = loadModels(L);

let failures = 0;
function report(n, label, check) {
  try {
    check();
    console.log(`PASS [${n}] ${label}`);
  } catch (error) {
    failures++;
    console.log(`FAIL [${n}] ${label}: ${messageOf(error)}`);
  }
}

report(1, "cell and robot constants", () => constants(L));
report(2, "housing outcomes and tray replenishment", () => eachModel(models, processParts));
report(3, "fixture mutex and dual-gripper process", () => eachModel(models, (m, speed) => {
  verifyMutex(m);
  verifyDualGripper(m, speed);
}));
report(4, "contiguous actor segments", () => eachModel(models, segments));
report(5, "moving belt line tracking", () => eachModel(models, (m, speed) => tracking(m, L, speed)));
report(6, "seeded FK/IK round trips and unreachable targets", () => roundTrips(L));
report(7, "sampled joint limits, speeds and FK", () => eachModel(models, m => trajectories(m, L)));
report(8, "TCP speeds, scanner state and operator swaps", () => eachModel(models, m => operatorAndSpeed(m, L)));
report(9, "capsule geometry and clearance", () => {
  rigidLinks(L);
  eachModel(models, m => clearance(m, L));
});
report(10, "duration, model isolation and determinism", () => determinism(L));
report(11, perturb ? "perturbed check 3 detects fixture overlap" : "perturbation introduces fixture overlap", () => {
  if (perturb) verifyPerturbation(models);
  else verifyPerturbation(loadModels(perturbed), models);
});

const baseline = models[1].model;
if ([baseline?.DURATION, baseline?.util?.fanuc, baseline?.util?.ur, baseline?.util?.camera,
  baseline?.minClear?.m].every(finite)) {
  const percent = fraction => (100 * fraction).toFixed(1) + "%";
  console.log(`0.10 m/s: cycle ${baseline.DURATION.toFixed(2)} s, utilisation FANUC ${percent(baseline.util.fanuc)}, ` +
    `UR ${percent(baseline.util.ur)}, camera ${percent(baseline.util.camera)}, ` +
    `minimum clearance ${(baseline.minClear.m * 1000).toFixed(1)} mm`);
}
process.exitCode = failures ? 1 : 0;
