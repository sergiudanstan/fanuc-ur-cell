// HMI, Gantt, operator mannequin, trails, and what-if belt speed.
// NIS2: no network, no eval, no new storage keys. Theme and HQ stay on their existing keys.

let mode = "program";

const GANTT_ACTORS = ["fanuc", "ur", "camera", "operator"];
const LANE = {
  fanuc: { short: "FANUC", name: "FANUC", color: "#d99b00" },
  ur: { short: "UR5e", name: "UR5e", color: "#1d6fb8" },
  camera: { short: "CAM", name: "Camera", color: "#4d5b66" },
  operator: { short: "OPER", name: "Operator", color: "#2b8a57" },
};
const KIND_LABEL = {
  pick: "Pick housing",
  load: "Load fixture",
  unload: "Unload fixture",
  swivel: "Swivel gripper",
  place_out: "Place outfeed",
  place_bin: "Reject to bin",
  cover: "Place cover",
  screw: "Drive screw",
  inspect: "Inspect",
  move: "Move",
  wait: "Wait",
  walk_in: "Walk in",
  walk_out: "Walk out",
  swap: "Swap tray",
  away: "In the aisle",
};
const PROGRAM_KINDS = new Set([
  "pick", "swivel", "load", "unload", "place_out", "place_bin",
  "cover", "screw", "inspect", "walk_in", "swap", "walk_out",
]);
const OWNER_LABEL = { fanuc: "FANUC", ur: "UR5e", camera: "Camera" };
const BELT_KEYS = [0.05, 0.10, 0.15, 0.20];

const openPanels = {
  program: new Set(["live-card"]),
  manual: new Set(["live-card"]),
};

function setText(id, value) {
  const el = $(id);
  if (el && el.textContent !== value) el.textContent = value;
}

function pct(x) {
  return (Number(x) * 100).toFixed(1) + "%";
}

function snapBelt(v) {
  return Math.round(clamp(Number(v), 0.05, 0.20) * 100) / 100;
}

function uiSegment(list, t) {
  if (!list || !list.length) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (list[mid].t0 <= t + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

function operatorInWarning(xz) {
  const c = CELL.scanner.center;
  return Math.hypot(xz[0] - c[0], xz[1] - c[1]) <= CELL.scanner.warn + 1e-9;
}

function sampleAt(t, model) {
  const [i0, i1, f] = robotSample(t);
  const a = model.S.opPos[i0];
  const b = model.S.opPos[i1] || a;
  const mix = (u, v) => u.map((x, j) => x + ((v[j] - x) * f));
  return {
    i0,
    xz: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    fq: mix(model.S.fq[i0], model.S.fq[i1]),
    uq: mix(model.S.uq[i0], model.S.uq[i1]),
    grip: model.S.fGrip[i0],
    swivel: model.S.fSwivel[i0],
    held: model.S.fHeld[i0] || [null, null],
    fanuc: uiSegment(model.segs.fanuc, t),
    ur: uiSegment(model.segs.ur, t),
    camera: uiSegment(model.segs.camera, t),
    operator: uiSegment(model.segs.operator, t),
  };
}

function actionText(seg) {
  if (!seg) return "Hold";
  const label = KIND_LABEL[seg.kind] || "Hold";
  if (seg.kind === "wait" || seg.kind === "away") return label;
  const bits = [label];
  if (Number.isInteger(seg.k)) bits.push(String(seg.k + 1));
  if (Number.isInteger(seg.i)) bits.push((seg.i + 1) + "/4");
  return bits.join(" ");
}

function detailText(seg) {
  const bits = [];
  if (Number.isInteger(seg.k)) bits.push("housing " + (seg.k + 1));
  if (Number.isInteger(seg.tray)) bits.push("tray " + (seg.tray + 1));
  if (Number.isInteger(seg.slot)) bits.push("slot " + (seg.slot + 1));
  if (Number.isInteger(seg.i)) bits.push("screw " + (seg.i + 1));
  bits.push(seg.t0.toFixed(1) + " s");
  return bits.join(" · ");
}

function slotName(h) {
  return h == null ? "empty" : ("H" + (h + 1));
}

function gripLine(sample) {
  const held = sample.held;
  const active = sample.grip === 1 ? "B" : "A";
  const deg = Math.round((sample.swivel || 0) * DEG);
  return "Active " + active + " · A " + slotName(held[0]) + " · B " + slotName(held[1]) + " · " + deg + "°";
}

function statusText(warn) {
  if (warn) return "Scanner warning";
  if (mode === "manual") return "Manual";
  if (playing) return "Running";
  return "Hold";
}

// ---------------------------------------------------------------- panels
function syncPanels() {
  document.querySelectorAll(".rail-item[data-panel]").forEach((b) => {
    const allowed = (b.dataset.modes || "").split(/\s+/).includes(mode);
    b.hidden = !allowed;
    b.setAttribute("aria-pressed", String(allowed && openPanels[mode].has(b.dataset.panel)));
  });
  document.querySelectorAll(".drawer .card").forEach((c) => {
    c.hidden = !openPanels[mode].has(c.id);
  });
  const drawer = $("drawer");
  if (drawer) drawer.hidden = openPanels[mode].size === 0;
  if (openPanels[mode].has("whatif-card")) ensureBeltCache();
}

function setMode(next) {
  const name = next === "manual" ? "manual" : "program";
  const changed = name !== mode;
  mode = name;
  document.querySelectorAll(".mode-switch button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  });
  if (changed && mode === "manual") setPlaying(false);
  syncPanels();
  syncTrailVisibility();
  if (changed) renderAt(time);
}

document.querySelectorAll(".rail-item[data-panel]").forEach((b) => {
  b.addEventListener("click", () => {
    if (!(b.dataset.modes || "").split(/\s+/).includes(mode)) return;
    const set = openPanels[mode];
    if (set.has(b.dataset.panel)) set.delete(b.dataset.panel);
    else set.add(b.dataset.panel);
    syncPanels();
  });
});
document.querySelectorAll(".card .close").forEach((b) => {
  b.addEventListener("click", () => {
    const card = b.closest(".card");
    if (card) openPanels[mode].delete(card.id);
    syncPanels();
  });
});
document.querySelectorAll(".mode-switch button").forEach((b) => {
  b.addEventListener("click", () => setMode(b.dataset.mode));
});

// ---------------------------------------------------------------- operator mannequin
// Local face is −z (nose and eyes sit at local z < 0).
// Heading uses rotation.y = atan2(-dx, -dz): aisle → station is (0, −z), so yaw 0 looks into the cell.
// A hanging arm (local −y) with positive rotation.x reaches toward that face.
const skinMat = new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.72, metalness: 0 });
const suitMat = new THREE.MeshStandardMaterial({ color: 0x1c3f66, roughness: 0.78, metalness: 0.02 });
const vestMat = new THREE.MeshStandardMaterial({ color: 0xe0a800, roughness: 0.62, metalness: 0.04 });
const shoeMat = new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.86, metalness: 0 });
const hairMat = new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.8, metalness: 0 });
const eyeMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.35, metalness: 0 });

const operatorRig = new THREE.Group();
operatorRig.name = "operator";
world.add(operatorRig);
box(0.12, 0.80, 0.14, suitMat, -0.09, 0.48, 0, operatorRig);
box(0.12, 0.80, 0.14, suitMat, 0.09, 0.48, 0, operatorRig);
box(0.12, 0.08, 0.26, shoeMat, -0.09, 0.04, -0.02, operatorRig);
box(0.12, 0.08, 0.26, shoeMat, 0.09, 0.04, -0.02, operatorRig);
box(0.38, 0.52, 0.20, suitMat, 0, 1.14, 0, operatorRig);
box(0.32, 0.34, 0.025, vestMat, 0, 1.18, -0.112, operatorRig);
const operatorHead = mesh(new THREE.SphereGeometry(0.115, 28, 18), skinMat, operatorRig);
operatorHead.position.set(0, 1.56, 0);
const operatorHair = mesh(new THREE.SphereGeometry(0.118, 20, 12), hairMat, operatorRig);
operatorHair.position.set(0, 1.63, 0.012);
operatorHair.scale.set(1.02, 0.52, 0.96);
box(0.035, 0.04, 0.04, skinMat, 0, 1.55, -0.125, operatorRig);
mesh(new THREE.SphereGeometry(0.016, 12, 8), eyeMat, operatorRig).position.set(-0.04, 1.585, -0.1);
mesh(new THREE.SphereGeometry(0.016, 12, 8), eyeMat, operatorRig).position.set(0.04, 1.585, -0.1);

function makeArm(x) {
  const g = new THREE.Group();
  g.position.set(x, 1.36, 0);
  operatorRig.add(g);
  box(0.09, 0.56, 0.09, suitMat, 0, -0.30, 0, g);
  box(0.075, 0.08, 0.08, skinMat, 0, -0.62, -0.01, g);
  return g;
}
const armL = makeArm(-0.25);
const armR = makeArm(0.25);

function poseOperator(sample, t) {
  const xz = sample.xz;
  operatorRig.position.set(xz[0], 0, xz[1]);
  const seg = sample.operator;
  // walk_out travels +z. atan2(-0, -(+1)) = π, so the −z face turns toward the aisle.
  operatorRig.rotation.y = seg && seg.kind === "walk_out" ? Math.PI : 0;
  const swapping = seg && seg.kind === "swap";
  const walking = seg && (seg.kind === "walk_in" || seg.kind === "walk_out");
  if (swapping) {
    armL.rotation.set(1.15, 0, 0.35);
    armR.rotation.set(1.15, 0, -0.35);
  } else if (walking) {
    const swing = Math.sin(t * 8) * 0.45;
    armL.rotation.set(0.15 + swing, 0, 0);
    armR.rotation.set(0.15 - swing, 0, 0);
  } else {
    armL.rotation.set(0.12, 0, 0.08);
    armR.rotation.set(0.12, 0, -0.08);
  }
}

// ---------------------------------------------------------------- guards and TCP trails
const scannerZoneMats = new Set([M.warnYellow, M.warnRing, M.protectRed, M.protectRing]);
const scannerZones = [];
world.traverse((o) => {
  if (!o.isMesh || !o.material) return;
  const list = Array.isArray(o.material) ? o.material : [o.material];
  if (list.some((m) => scannerZoneMats.has(m))) scannerZones.push(o);
});

function applyGuards(on) {
  guardPanels.visible = !!on;
  for (const o of scannerZones) o.visible = !!on;
}

const trailGroup = new THREE.Group();
trailGroup.name = "tcp-trails";
world.add(trailGroup);
let trailLive = [];

function rebuildTrails(model) {
  while (trailGroup.children.length) {
    const child = trailGroup.children[0];
    child.geometry.dispose();
    child.material.dispose();
    trailGroup.remove(child);
  }
  trailLive = [];
  const n = model.S.t.length;
  const add = (points, color, live) => {
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      arr[i * 3] = p[0];
      arr[i * 3 + 1] = p[1];
      arr[i * 3 + 2] = p[2];
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(arr, 3));
    if (live) geo.setDrawRange(0, 1);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: live ? 0.95 : 0.18 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    trailGroup.add(line);
    if (live) trailLive.push(line);
  };
  add(model.S.fTcp, 0xd99b00, false);
  add(model.S.fTcp, 0xd99b00, true);
  add(model.S.uTcp, 0x1d6fb8, false);
  add(model.S.uTcp, 0x1d6fb8, true);
  syncTrailVisibility();
}

function syncTrailVisibility() {
  const boxEl = $("trail");
  const on = !!(boxEl && boxEl.checked) && !document.documentElement.classList.contains("shot-mode");
  trailGroup.visible = on;
}

function updateTrailRange(t, model) {
  if (!trailLive.length) return;
  const count = Math.min(model.S.t.length, sampleAt(t, model).i0 + 1);
  for (const line of trailLive) line.geometry.setDrawRange(0, count);
}

$("guards").addEventListener("change", () => applyGuards($("guards").checked));
$("trail").addEventListener("change", () => syncTrailVisibility());

// ---------------------------------------------------------------- program, gantt, joints, report
let programItems = [];
let programRows = [];
let lastProgramRow = null;
let laneModel = null;
const trayAcquireCache = new WeakMap();

function acquiresOf(model) {
  let found = trayAcquireCache.get(model);
  if (!found) {
    found = Array(model.parts.length).fill(Infinity);
    for (const seg of model.segs.ur) {
      if (seg.kind === "move" && Number.isInteger(seg.k) && found[seg.k] === Infinity) found[seg.k] = seg.t1;
    }
    trayAcquireCache.set(model, found);
  }
  return found;
}

function trayRemaining(model, tray, t) {
  const swap = model.trays.swaps.find((s) => s.tray === tray);
  if (swap && t >= swap.t1 - 1e-9) return 6;
  const got = acquiresOf(model);
  let left = 0;
  for (let slot = 0; slot < 6; slot++) if (t < got[tray * 6 + slot]) left++;
  return left;
}

function yieldAt(model, t) {
  let good = 0;
  let bad = 0;
  for (const part of model.parts) {
    if (t + 1e-9 < part.end.t) continue;
    if (part.reject) bad++;
    else good++;
  }
  return { good, bad, total: model.parts.length };
}

function busySeconds(model, actor) {
  if (actor !== "operator" && model.util && model.util[actor] != null) return model.util[actor] * model.DURATION;
  return (model.segs[actor] || []).reduce((sum, seg) => {
    if (seg.kind === "wait" || seg.kind === "away") return sum;
    return sum + (seg.t1 - seg.t0);
  }, 0);
}

function buildProgram(model) {
  const list = $("program");
  list.replaceChildren();
  programItems = [];
  for (const actor of GANTT_ACTORS) {
    for (const seg of model.segs[actor]) {
      if (PROGRAM_KINDS.has(seg.kind)) programItems.push({ ...seg, actor });
    }
  }
  programItems.sort((a, b) => a.t0 - b.t0 || GANTT_ACTORS.indexOf(a.actor) - GANTT_ACTORS.indexOf(b.actor));
  setText("program-total", programItems.length + " steps · " + model.DURATION.toFixed(1) + " s");
  programRows = programItems.map((it) => {
    const li = document.createElement("li");
    const fill = document.createElement("i");
    fill.className = "fill";
    const chip = document.createElement("span");
    chip.className = "chip " + (it.actor === "operator" ? "op" : it.actor);
    chip.textContent = LANE[it.actor].short;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = KIND_LABEL[it.kind] || it.kind;
    const dur = document.createElement("span");
    dur.className = "dur";
    dur.textContent = (it.t1 - it.t0).toFixed(2) + " s";
    const code = document.createElement("code");
    code.textContent = detailText(it);
    li.append(fill, chip, label, dur, code);
    li.addEventListener("click", () => {
      const mid = Math.min(1e-3, Math.max(1e-4, (it.t1 - it.t0) * 0.25));
      seek(it.t0 + mid);
    });
    list.append(li);
    return li;
  });
  lastProgramRow = null;
}

function markProgram(t) {
  let first = null;
  for (let i = 0; i < programItems.length; i++) {
    const it = programItems[i];
    const li = programRows[i];
    const active = t >= it.t0 && t < it.t1;
    li.classList.toggle("active", active);
    li.classList.toggle("done", t >= it.t1);
    const width = active ? ((t - it.t0) / Math.max(1e-6, it.t1 - it.t0)) * 100 : 0;
    li.firstChild.style.width = width.toFixed(1) + "%";
    if (active && !first) first = li;
  }
  const card = $("program-card");
  if (first && playing && card && !card.hidden && first !== lastProgramRow) {
    lastProgramRow = first;
    const list = $("program");
    const delta = first.getBoundingClientRect().top - list.getBoundingClientRect().top;
    list.scrollTop += delta - 36;
  }
  if (!first) lastProgramRow = null;
}

const GANTT_W = 330;
const GANTT_LEFT = 54;
const GANTT_ROW = 22;
function renderGantt(model) {
  const dur = model.DURATION || 1;
  const top = 6;
  const plotW = GANTT_W - GANTT_LEFT - 8;
  const H = top + GANTT_ROW * GANTT_ACTORS.length + 22;
  const xOf = (t0) => GANTT_LEFT + (t0 / dur) * plotW;
  const parts = [`<svg viewBox="0 0 ${GANTT_W} ${H}" role="img" aria-label="Cycle timing">`];
  GANTT_ACTORS.forEach((actor, row) => {
    const y = top + row * GANTT_ROW;
    parts.push(`<text x="0" y="${y + 14}" fill="var(--muted)" font-size="11">${LANE[actor].short}</text>`);
    parts.push(`<rect x="${GANTT_LEFT}" y="${y + 4}" width="${plotW}" height="${GANTT_ROW - 10}" rx="3" fill="var(--panel-2)"/>`);
    for (const seg of model.segs[actor]) {
      if (seg.kind === "wait" || seg.kind === "away") continue;
      const x = xOf(seg.t0);
      const w = Math.max(0.8, xOf(seg.t1) - x);
      parts.push(`<rect x="${x.toFixed(2)}" y="${y + 4}" width="${w.toFixed(2)}" height="${GANTT_ROW - 10}" fill="${LANE[actor].color}"/>`);
    }
  });
  for (let i = 0; i <= 4; i++) {
    const tick = (dur * i) / 4;
    parts.push(`<text x="${xOf(tick).toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--faint)" font-size="10">${tick.toFixed(0)}</text>`);
  }
  parts.push(`<line id="gantt-cursor" x1="${GANTT_LEFT}" y1="${top}" x2="${GANTT_LEFT}" y2="${top + GANTT_ROW * GANTT_ACTORS.length - 4}" stroke="var(--accent)" stroke-width="2"/>`);
  parts.push("</svg>");
  const legend = GANTT_ACTORS.map((actor) => {
    const busy = busySeconds(model, actor);
    const share = dur > 0 ? (busy / dur) * 100 : 0;
    return `<span><i style="background:${LANE[actor].color}"></i>${LANE[actor].name} ${busy.toFixed(1)} s · ${share.toFixed(0)}%</span>`;
  }).join("");
  $("gantt").innerHTML = parts.join("") + `<div class="gantt-legend">${legend}</div>`;
}

function moveGanttCursor(t, model) {
  const line = document.getElementById("gantt-cursor");
  if (!line) return;
  const dur = model.DURATION || 1;
  const plotW = GANTT_W - GANTT_LEFT - 8;
  const x = GANTT_LEFT + (clamp(t, 0, dur) / dur) * plotW;
  line.setAttribute("x1", x.toFixed(2));
  line.setAttribute("x2", x.toFixed(2));
}

function drawLanes(model) {
  laneModel = model;
  const canvas = $("lanes");
  if (!canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const dur = model.DURATION || 1;
  const rowH = h / GANTT_ACTORS.length;
  const track = css("--line") || "#d8dce3";
  GANTT_ACTORS.forEach((actor, row) => {
    const y = row * rowH + 2;
    const bh = Math.max(3, rowH - 4);
    g.fillStyle = track;
    g.fillRect(0, y, w, bh);
    g.fillStyle = LANE[actor].color;
    for (const seg of model.segs[actor]) {
      if (seg.kind === "wait" || seg.kind === "away") continue;
      const x = (seg.t0 / dur) * w;
      g.fillRect(x, y, Math.max(1, ((seg.t1 - seg.t0) / dur) * w), bh);
    }
  });
}

let jointRows = [];
function buildJoints() {
  const root = $("joints");
  root.replaceChildren();
  jointRows = [];
  const add = (title, lims) => {
    const h = document.createElement("h3");
    h.textContent = title;
    root.append(h);
    lims.forEach((pair, index) => {
      const row = document.createElement("div");
      row.className = "joint";
      const name = document.createElement("span");
      name.textContent = "J" + (index + 1);
      const track = document.createElement("div");
      track.className = "track";
      const dot = document.createElement("i");
      track.append(dot);
      const value = document.createElement("span");
      value.className = "v";
      value.textContent = "0.0°";
      row.append(name, track, value);
      root.append(row);
      jointRows.push({ lo: pair[0], hi: pair[1], track, dot, v: value });
    });
  };
  add(FANUC.name, FANUC.lim);
  add(UR.name, UR.lim);
}

function showJoints(sample) {
  const vals = sample.fq.concat(sample.uq);
  for (let i = 0; i < jointRows.length; i++) {
    const row = jointRows[i];
    const q = vals[i];
    const span = row.hi - row.lo || 1;
    const f = (q - row.lo) / span;
    row.dot.style.left = (clamp(f, 0, 1) * 100).toFixed(2) + "%";
    row.v.textContent = (q * DEG).toFixed(1) + "°";
    row.track.classList.toggle("near", f < 0.04 || f > 0.96);
  }
}

function buildTcp() {
  const root = $("tcp");
  root.replaceChildren();
  for (const [id, label, chip] of [["fanuc", "FANUC", "fanuc"], ["ur", "UR5e", "ur"]]) {
    const badge = document.createElement("span");
    badge.className = "chip " + chip;
    badge.textContent = label;
    root.append(badge);
    for (const axis of ["x", "y", "z"]) {
      const cell = document.createElement("div");
      const small = document.createElement("small");
      small.textContent = axis;
      const b = document.createElement("b");
      b.id = "tcp-" + id + "-" + axis;
      b.textContent = "0";
      cell.append(small, b);
      root.append(cell);
    }
  }
}

function renderReport(model) {
  const good = model.parts.filter((part) => !part.reject).length;
  const bad = model.parts.length - good;
  const rows = [
    ["Cycle", model.DURATION.toFixed(2) + " s"],
    ["Infeed belt", model.beltSpeed.toFixed(2) + " m/s"],
    ["Housings good / reject", good + " / " + bad],
    ["FANUC utilisation", pct(model.util.fanuc)],
    ["UR5e utilisation", pct(model.util.ur)],
    ["Camera utilisation", pct(model.util.camera)],
    ["Minimum clearance", Math.round(model.minClear.m * 1000) + " mm at " + model.minClear.at.toFixed(2) + " s"],
    ["Clearance pair", "FANUC ↔ UR5e"],
    ["FANUC gripper", "Dual, on a 180° rotator"],
    ["UR TCP cap", "1.00 m/s, or 0.25 m/s in the warning field"],
    ["Scanner", "warn " + CELL.scanner.warn.toFixed(2) + " m · protect " + CELL.scanner.protect.toFixed(2) + " m"],
    ["Housing", Math.round(CELL.housing[0] * 1000) + " × " + Math.round(CELL.housing[1] * 1000) + " × " + Math.round(CELL.housing[2] * 1000) + " mm"],
    ["Fixture", "one mutex, FANUC / UR5e / camera"],
  ];
  $("report").innerHTML = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
}

function showTcp() {
  const write = (name, p) => {
    if (!p) return;
    setText("tcp-" + name + "-x", (p[0] * 1000).toFixed(0));
    setText("tcp-" + name + "-y", (p[1] * 1000).toFixed(0));
    setText("tcp-" + name + "-z", (p[2] * 1000).toFixed(0));
  };
  write("fanuc", tcp("fanuc"));
  write("ur", tcp("ur"));
}

function fixtureOwner(model, t) {
  const zones = model.zones && model.zones.fixture;
  if (!zones) return "";
  for (const name of ["fanuc", "ur", "camera"]) {
    for (const span of zones[name] || []) {
      if (t >= span[0] && t < span[1]) return name;
    }
  }
  return "";
}

function fillStatic(model) {
  const h = CELL.housing;
  setText("s-belt", model.beltSpeed.toFixed(2));
  setText("s-cycle", model.DURATION.toFixed(1));
  setText("s-clear", String(Math.round(model.minClear.m * 1000)));
  setText("s-clear-pair", "FANUC ↔ UR5e · " + model.minClear.at.toFixed(1) + " s");
  setText("s-util", "FANUC " + pct(model.util.fanuc) + " · UR " + pct(model.util.ur) + " · cam " + pct(model.util.camera));
  setText("clock-total", model.DURATION.toFixed(1));
  const tl = $("timeline");
  if (tl) tl.setAttribute("aria-valuemax", model.DURATION.toFixed(1));
  const note = $("live-note");
  if (note) {
    note.textContent = "12 housings " + Math.round(h[0] * 1000) + "×" + Math.round(h[1] * 1000) + "×" + Math.round(h[2] * 1000)
      + " mm · dual gripper on a 180° rotator · belt " + model.beltSpeed.toFixed(2)
      + " m/s · cycle " + model.DURATION.toFixed(1) + " s · FANUC " + pct(model.util.fanuc)
      + " · UR5e " + pct(model.util.ur) + " · camera " + pct(model.util.camera);
  }
}

function applyStack(warn) {
  const run = playing && mode === "program" && !warn;
  stackLamps.green.emissiveIntensity = run ? 1.7 : 0;
  stackLamps.amber.emissiveIntensity = warn ? 1.7 : 0;
  stackLamps.red.emissiveIntensity = 0;
}

function moveCursors(t, model) {
  const dur = model.DURATION || 1;
  const head = $("playhead");
  if (head) head.style.left = (clamp(t, 0, dur) / dur * 100) + "%";
  const tl = $("timeline");
  if (tl) tl.setAttribute("aria-valuenow", t.toFixed(1));
  moveGanttCursor(t, model);
}

function syncText(t, model, sample, warn) {
  const owner = fixtureOwner(model, t);
  const ownerEl = $("zone-owner-fixture");
  const ownerDot = $("zone-dot-fixture");
  if (ownerEl) ownerEl.textContent = owner ? OWNER_LABEL[owner] : "free";
  if (ownerDot) ownerDot.style.background = owner ? LANE[owner].color : "var(--faint)";
  const scanDot = $("zone-dot-scanner");
  if (scanDot) scanDot.style.background = warn ? "var(--accent)" : "var(--good)";
  setText("zone-owner-scanner", warn ? "warning" : "clear");

  const scannerStat = $("s-scanner-stat");
  if (scannerStat) {
    scannerStat.classList.toggle("warn", warn);
    scannerStat.classList.toggle("ok", !warn);
  }
  setText("s-scanner", warn ? "Warning" : "Clear");
  setText("s-scanner-sub", warn ? "Operator inside 1.20 m" : "warn 1.20 m · protect 0.60 m");

  const urStat = $("s-ur-stat");
  if (urStat) {
    urStat.classList.toggle("warn", warn);
    urStat.classList.toggle("ok", !warn);
  }
  setText("s-ur-speed", warn ? "≤ 0.25 m/s" : "1.00 m/s");
  setText("s-ur-speed-sub", warn ? "Reduced while the operator is in the field" : "Nominal TCP cap");

  const made = yieldAt(model, t);
  setText("s-yield", made.good + " / " + made.bad);
  setText("s-yield-sub", "of " + made.total + " housings");
  const yieldStat = $("s-yield-stat");
  if (yieldStat) {
    yieldStat.classList.toggle("bad", made.bad > 0);
    yieldStat.classList.toggle("ok", made.good > 0 && made.bad === 0);
  }
  setText("s-trays", trayRemaining(model, 0, t) + " · " + trayRemaining(model, 1, t));
  setText("s-grip", sample.grip === 1 ? "B" : "A");
  setText("s-grip-sub", gripLine(sample));

  setText("now-conv", model.beltSpeed.toFixed(2) + " m/s");
  setText("cmd-conv", playing && mode === "program" ? "Indexing" : "Hold");
  setText("now-fanuc", actionText(sample.fanuc));
  setText("cmd-fanuc", gripLine(sample));
  setText("now-ur", actionText(sample.ur));
  setText("cmd-ur", warn ? "Reduced TCP ≤ 0.25 m/s" : "TCP cap 1.00 m/s");
  setText("now-op", actionText(sample.operator));
  setText("cmd-op", "x " + sample.xz[0].toFixed(2) + " · z " + sample.xz[1].toFixed(2) + (warn ? " · warning field" : " · clear"));

  showJoints(sample);
  showTcp();
  markProgram(t);
}

let hmiStamp = -1e9;
function paintHmi(t, model, sample, warn, force) {
  const nowMs = performance.now();
  if (!force && nowMs - hmiStamp < 200) return;
  hmiStamp = nowMs;
  const canvas = hmiScreen.canvas;
  const g = canvas.getContext("2d");
  const run = playing && mode === "program" && !warn;
  g.fillStyle = "#12171e";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#f5b800";
  g.font = "700 34px sans-serif";
  g.fillText("FANUC + UR5e", 28, 52);
  g.fillStyle = warn ? "#e0b15a" : (run ? "#7ddea0" : "#e0b15a");
  g.font = "700 48px sans-serif";
  g.fillText(warn ? "WARN" : (run ? "RUN" : "HOLD"), 28, 114);
  g.fillStyle = "#d7dee6";
  g.font = "500 26px ui-monospace, monospace";
  const made = yieldAt(model, t);
  const lines = [
    "Time    " + t.toFixed(1) + " / " + model.DURATION.toFixed(1) + " s",
    "Good " + made.good + "   Reject " + made.bad,
    gripLine(sample),
    "Belt    " + model.beltSpeed.toFixed(2) + " m/s",
    "Clear   " + Math.round(model.minClear.m * 1000) + " mm",
  ];
  lines.forEach((line, i) => g.fillText(line, 28, 168 + i * 38));
  hmiScreen.texture.needsUpdate = true;
}

// ---------------------------------------------------------------- what-if
const beltCache = new Map();
let beltQueue = null;
let beltTimer = 0;

function fillWhatIf(model, preview) {
  const rows = [
    ["Cycle", model.DURATION.toFixed(2) + " s"],
    ["FANUC", pct(model.util.fanuc)],
    ["UR5e", pct(model.util.ur)],
    ["Camera", pct(model.util.camera)],
    ["Min. clearance", Math.round(model.minClear.m * 1000) + " mm"],
  ];
  $("whatif-kv").innerHTML = rows.map(([k, v]) => "<dt>" + k + "</dt><dd>" + v + "</dd>").join("");
  const note = $("whatif-note");
  if (note) {
    note.textContent = preview
      ? ("Preview at " + model.beltSpeed.toFixed(2) + " m/s. Release the slider to apply it.")
      : ("Applied. Cycle " + model.DURATION.toFixed(1) + " s at " + model.beltSpeed.toFixed(2) + " m/s.");
  }
}

function drawWhatIfChart() {
  const host = $("whatif-chart");
  if (!host) return;
  const speeds = BELT_KEYS.filter((s) => beltCache.has(s.toFixed(2)));
  if (!speeds.length) {
    host.replaceChildren();
    return;
  }
  const durations = speeds.map((s) => beltCache.get(s.toFixed(2)).DURATION);
  const max = Math.max(...durations, 1);
  const W = 300;
  const H = 112;
  const left = 8;
  const gap = 10;
  const bw = (W - left - 8) / speeds.length - gap;
  const parts = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cycle time against belt speed">`];
  speeds.forEach((s, i) => {
    const dur = beltCache.get(s.toFixed(2)).DURATION;
    const h = (dur / max) * (H - 28);
    const x = left + i * (bw + gap);
    const y = H - 18 - h;
    const on = Math.abs(s - current().beltSpeed) < 0.001;
    parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${on ? "#d97706" : "#8aa0b8"}"/>`);
    parts.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="var(--faint)" font-size="10">${s.toFixed(2)}</text>`);
  });
  parts.push("</svg>");
  host.innerHTML = parts.join("");
}

function ensureBeltCache() {
  if (beltQueue) return;
  const live = current();
  beltCache.set(live.beltSpeed.toFixed(2), live);
  beltQueue = BELT_KEYS.filter((s) => !beltCache.has(s.toFixed(2)));
  const step = () => {
    if (!beltQueue.length) {
      drawWhatIfChart();
      return;
    }
    const speed = beltQueue.shift();
    try {
      beltCache.set(speed.toFixed(2), cycleFor(speed));
    } catch (err) {
      const note = $("whatif-note");
      if (note) note.textContent = "Preview failed at " + speed.toFixed(2) + " m/s.";
    }
    drawWhatIfChart();
    if (beltQueue.length) setTimeout(step, 40);
  };
  setTimeout(step, 40);
}

function commitBelt(raw) {
  const speed = snapBelt(raw);
  const range = $("belt-speed");
  const num = $("belt-speed-n");
  if (range) range.value = speed.toFixed(2);
  if (num) num.value = speed.toFixed(2);
  if (Math.abs(speed - current().beltSpeed) < 0.001) {
    fillWhatIf(current(), false);
    drawWhatIfChart();
    return;
  }
  const was = playing;
  const keep = time;
  let model;
  try {
    model = rebuild(speed);
  } catch (err) {
    const note = $("whatif-note");
    if (note) note.textContent = "Rebuild failed. The running cycle was left unchanged.";
    return;
  }
  beltCache.set(speed.toFixed(2), model);
  refreshChrome(model);
  time = clamp(keep, 0, model.DURATION);
  renderAt(time);
  if (was) setPlaying(true);
  fillWhatIf(model, false);
  drawWhatIfChart();
}

function scheduleBelt(raw) {
  clearTimeout(beltTimer);
  beltTimer = setTimeout(() => commitBelt(raw), 200);
}

const beltRange = $("belt-speed");
const beltNum = $("belt-speed-n");
if (beltRange) {
  beltRange.addEventListener("input", () => {
    const speed = snapBelt(beltRange.value);
    if (beltNum) beltNum.value = speed.toFixed(2);
    const cached = beltCache.get(speed.toFixed(2));
    if (cached) fillWhatIf(cached, Math.abs(cached.beltSpeed - current().beltSpeed) > 0.001);
  });
  beltRange.addEventListener("change", () => scheduleBelt(beltRange.value));
}
if (beltNum) {
  beltNum.addEventListener("change", () => {
    const speed = snapBelt(beltNum.value);
    if (beltRange) beltRange.value = speed.toFixed(2);
    beltNum.value = speed.toFixed(2);
    scheduleBelt(speed);
  });
}

// ---------------------------------------------------------------- per-frame HMI
let uiStamp = -1e9;
let uiT = NaN;

function refreshChrome(model) {
  buildProgram(model);
  renderGantt(model);
  drawLanes(model);
  rebuildTrails(model);
  renderReport(model);
  fillStatic(model);
  fillWhatIf(model, false);
}

window.__uiSync = function (t) {
  const model = current();
  const sample = sampleAt(t, model);
  const warn = operatorInWarning(sample.xz);
  poseOperator(sample, t);
  moveCursors(t, model);
  applyStack(warn);
  updateTrailRange(t, model);
  setText("live-sub", statusText(warn));
  setText("clock-now", t.toFixed(1));
  const nowMs = performance.now();
  const jump = !(Math.abs(t - uiT) < 0.08);
  uiT = t;
  if (jump || nowMs - uiStamp >= 150) {
    uiStamp = nowMs;
    syncText(t, model, sample, warn);
    paintHmi(t, model, sample, warn, true);
  }
};

if (matchMedia("(max-width: 900px)").matches) {
  openPanels.program.clear();
  openPanels.manual.clear();
}
buildJoints();
buildTcp();
refreshChrome(current());
applyGuards($("guards").checked);
syncTrailVisibility();
syncPanels();
new ResizeObserver(() => { if (laneModel) drawLanes(laneModel); }).observe($("timeline"));
