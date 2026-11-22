// SPEC §6 camera views. World metres, Y-up. pos/target stay plain arrays so
// __cell.views can hand them to the film one frame at a time.
// Local face of the operator mannequin is unrelated; these are camera poses only.
const views = {
  iso: { pos: [2.55, 4.05, 5.15], target: [-0.05, 0.85, 0.15] },
  front: { pos: [-1.45, 2.45, 4.35], target: [0.25, 1.05, 0.05] },
  side: { pos: [4.70, 2.05, 0.35], target: [0.00, 0.95, 0.15] },
  top: { pos: [0.15, 6.10, 0.70], target: [0.05, 0.00, 0.30] },
  fanuc: { pos: [-1.65, 1.35, -0.05], target: [-0.15, 0.98, -0.55] },
  ur: { pos: [1.45, 1.60, 2.05], target: [0.05, 1.02, 0.55] },
  operator: { pos: [2.35, 1.70, 2.90], target: [0.50, 1.30, 1.48] },
};

let flight = null;

function ease(u) {
  const t = clamp(u, 0, 1);
  return t * t * (3 - 2 * t);
}

function viewVector(tuple) {
  return new THREE.Vector3(tuple[0], tuple[1], tuple[2]);
}

function setView(name) {
  const v = views[name];
  if (!v) return;
  flight = {
    t: 0,
    fromP: camera.position.clone(),
    fromT: controls.target.clone(),
    toP: viewVector(v.pos),
    toT: viewVector(v.target),
  };
  document.querySelectorAll(".views button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.view === name));
  });
}

// Instant cut. Cancels an in-progress flight. The film calls this every frame.
function setCamera(pos, target) {
  if (!pos || !target || pos.length < 3 || target.length < 3) return;
  flight = null;
  camera.position.set(pos[0], pos[1], pos[2]);
  controls.target.set(target[0], target[1], target[2]);
  controls.update();
  document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-pressed", "false"));
}

// Advance the 0.8 s view flight. Does not pose robots.
function tickFlight(dt) {
  if (!flight) return;
  flight.t = Math.min(1, flight.t + dt / 0.8);
  const e = ease(flight.t);
  camera.position.lerpVectors(flight.fromP, flight.toP, e);
  controls.target.lerpVectors(flight.fromT, flight.toT, e);
  if (flight.t >= 1) flight = null;
}

camera.position.set(views.iso.pos[0], views.iso.pos[1], views.iso.pos[2]);
controls.target.set(views.iso.target[0], views.iso.target[1], views.iso.target[2]);
controls.update();

document.querySelectorAll(".views button").forEach((b) => {
  b.addEventListener("click", () => setView(b.dataset.view));
});
controls.addEventListener("start", () => {
  flight = null;
  document.querySelectorAll(".views button").forEach((b) => b.setAttribute("aria-pressed", "false"));
});
