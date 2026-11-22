// Playback clock and the only requestAnimationFrame loop.
// While paused the loop moves the camera (flight, orbit damping) and redraws.
// It does not pose the cell and it does not call __cell. renderAt runs only in play.

let time = 0;
let playing = false;
let speed = 1;

const PLAY_PATH = '<path d="M7 4.5v15l13-7.5z"/>';
const PAUSE_PATH = '<path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z"/>';

function setPlaying(on) {
  playing = !!on;
  const icon = $("play-icon");
  if (icon) icon.innerHTML = playing ? PAUSE_PATH : PLAY_PATH;
  const btn = $("play");
  if (btn) btn.setAttribute("aria-label", playing ? "Pause" : "Play");
}

$("play").addEventListener("click", () => {
  if (mode !== "program") setMode("program");
  const dur = current().DURATION;
  if (!playing && time >= dur - 1e-4) time = 0;
  setPlaying(!playing);
});

$("restart").addEventListener("click", () => {
  time = 0;
  renderAt(0);
});

document.querySelectorAll(".chips button").forEach((b) => {
  b.addEventListener("click", () => {
    const n = Number(b.dataset.speed);
    if (!Number.isFinite(n) || n <= 0) return;
    speed = n;
    document.querySelectorAll(".chips button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
});

const timelineEl = $("timeline");
let scrubbing = false;
function scrubTo(e) {
  const rect = timelineEl.getBoundingClientRect();
  const dur = current().DURATION;
  const u = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  seek(u * dur);
}
timelineEl.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  timelineEl.setPointerCapture(e.pointerId);
  scrubTo(e);
});
timelineEl.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e); });
timelineEl.addEventListener("pointerup", () => { scrubbing = false; });
timelineEl.addEventListener("pointercancel", () => { scrubbing = false; });
timelineEl.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  e.preventDefault();
  e.stopPropagation();
  seek(time + (e.key === "ArrowRight" ? 0.5 : -0.5));
});

window.addEventListener("keydown", (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  if (e.code === "Space" && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(tag)) {
    e.preventDefault();
    $("play").click();
  }
  if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !/INPUT|SELECT|TEXTAREA/.test(tag) && document.activeElement !== timelineEl) {
    e.preventDefault();
    seek(time + (e.key === "ArrowRight" ? 0.5 : -0.5));
  }
});

let _playLast = performance.now();
function playbackFrame(now) {
  const dt = Math.min(0.05, Math.max(0, (now - _playLast) / 1000));
  _playLast = now;
  tickFlight(dt);
  if (playing && mode === "program") {
    const dur = current().DURATION;
    time += dt * speed;
    if (time >= dur) {
      if ($("loop").checked) time %= dur || 1;
      else {
        time = dur;
        setPlaying(false);
      }
    }
    renderAt(time);
  } else {
    window.__uiSync?.(time);
    controls.update();
    renderFrame();
  }
  requestAnimationFrame(playbackFrame);
}
requestAnimationFrame(playbackFrame);
