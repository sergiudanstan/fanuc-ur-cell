// Scene contract hooks (SPEC.md §6 + mediu brief).
// Assigned once, only here, after all scene modules have loaded.
const _cellErrors = [];
window.addEventListener("error", (e) => {
  _cellErrors.push(String(e.message || e.error || e));
});
window.addEventListener("unhandledrejection", (e) => {
  _cellErrors.push(String(e.reason || e));
});

const _markerTmp = new THREE.Vector3();
function _readMarkerWorld(marker) {
  if (!marker) return null;
  world.updateMatrixWorld(true);
  marker.getWorldPosition(_markerTmp);
  return [_markerTmp.x, _markerTmp.y, _markerTmp.z];
}

function flange(name) {
  const reg = window.__robotMarkers;
  if (!reg) return null;
  return _readMarkerWorld(reg[name]?.flange);
}

function tcp(name) {
  const reg = window.__robotMarkers;
  if (!reg) return null;
  return _readMarkerWorld(reg[name]?.tcp);
}

function renderAt(t) {
  poseAt(t);
  window.__uiSync?.(t);
  controls.update();
  renderFrame();
}

function seek(t) {
  setPlaying(false);
  const dur = current().DURATION;
  const n = Number(t);
  time = clamp(Number.isFinite(n) ? n : 0, 0, dur);
  renderAt(time);
}

const _params = new URLSearchParams(location.search);
const _shotParam = _params.get("shot");
const _tParam = _params.get("t");

window.__cell = {
  ready: true,
  seek,
  flange,
  tcp,
  errors: _cellErrors,
  view: setView,
  views,
  camera: setCamera,
};
window.__cellCurrent = () => current();

// ?shot= cuts the camera. An animated setView would still be in flight when a
// still is taken, and the pause loop must not pose the cell back to t = 0.
if (_shotParam && views[_shotParam]) {
  document.documentElement.classList.add("shot-mode");
  setCamera(views[_shotParam].pos, views[_shotParam].target);
}
if (_tParam !== null && _tParam !== "" && Number.isFinite(Number(_tParam))) {
  seek(Number(_tParam));
} else {
  renderAt(0);
}
