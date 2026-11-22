// Deterministic cycle film for the FANUC + UR assembly cell.
// Frames are streamed to one ffmpeg process through stdin (nothing is written to disk).
// Usage:
//   node tools/record.mjs             -> media/fanuc_ur_cell.mp4 (7761 frames at 30 fps)
//   node tools/record.mjs --frames N  -> media/fanuc_ur_cell.part.mp4, no rename (pipeline probe)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("/opt/homebrew/lib/node_modules/playwright/index.mjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "media");
const finalPath = join(outDir, "fanuc_ur_cell.mp4");
const partPath = join(outDir, "fanuc_ur_cell.part.mp4");
const probeArg = process.argv.indexOf("--frames");
const probeFrames = probeArg >= 0 ? Math.max(1, Math.floor(Number(process.argv[probeArg + 1]))) : 0;

// ---- cycle length straight from the logic block in index.html (the page hook has no current())
function cycleDuration() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const m = html.match(/\/\/ @@logic-start[^\n]*\n([\s\S]*?)\/\/ @@logic-end/);
  if (!m) throw new Error("logic block missing in index.html");
  const model = new Function("console", `${m[1]}\nreturn rebuild(0.10);`)({ log() {}, warn() {}, error() {} });
  if (!(model && Number.isFinite(model.DURATION) && model.DURATION > 0)) throw new Error("rebuild(0.10).DURATION is invalid");
  return model;
}

// ---- free local port
function startServer() {
  const proc = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  const port = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("http.server did not bind a port in time\n" + log)), 8000);
    const onData = (chunk) => {
      const m = String(chunk).match(/Serving HTTP on 127\.0\.0\.1 port (\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.once("exit", (code) => { clearTimeout(timer); reject(new Error(`http.server exited early (${code})\n${log}`)); });
    proc.once("error", (err) => { clearTimeout(timer); reject(err); });
  });
  return { proc, port };
}

// ---- camera schedule: iso -> fanuc -> ur -> operator (during a tray swap) -> iso
// Each change is a 1.5 s smoothstep blend of position and target.
function cameraAt(views, t, duration) {
  const swaps = currentModel?.trays?.swaps ?? [];
  const swap = swaps[0];
  const opIn = swap ? (swap.t0 + swap.t1) / 2 : duration * 0.5;
  const opFrom = Math.max(0, Math.min(duration - 2.5, opIn - 3.6));
  const segments = [
    { name: "iso", from: 0, to: 11 },
    { name: "fanuc", from: 12.5, to: 40 },
    { name: "ur", from: 41.5, to: opFrom },
    { name: "operator", from: opFrom + 1.5, to: opFrom + 15 },
    { name: "iso", from: opFrom + 16.5, to: duration },
  ];
  const pose = (name) => {
    const v = views[name];
    return { pos: [v.pos[0], v.pos[1], v.pos[2]], target: [v.target[0], v.target[1], v.target[2]] };
  };
  const ease = (u) => {
    const x = Math.max(0, Math.min(1, u));
    return x * x * (3 - 2 * x);
  };
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (t >= seg.from && t <= seg.to) return pose(seg.name);
    const next = segments[i + 1];
    if (next && t > seg.to && t < next.from) {
      const u = ease((t - seg.to) / (next.from - seg.to));
      const a = pose(seg.name), b = pose(next.name);
      const mix = (p, q) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
      return { pos: mix(a.pos, b.pos), target: mix(a.target, b.target) };
    }
  }
  return pose(segments[segments.length - 1].name);
}

let currentModel = null;
let server = null;
let browser = null;
let ffmpeg = null;

async function shutdown(code) {
  if (server?.proc && server.proc.exitCode == null) server.proc.kill("SIGTERM");
  if (browser) await browser.close().catch(() => {});
  if (code !== 0) rmSync(partPath, { force: true });
  process.exit(code);
}

mkdirSync(outDir, { recursive: true });
currentModel = cycleDuration();
const DURATION = currentModel.DURATION;
const total = Math.round(DURATION * 30);
const count = probeFrames ? Math.min(probeFrames, total) : total;
console.log(`cycle ${DURATION.toFixed(2)} s, ${total} frames at 30 fps, recording ${count}${probeFrames ? " (probe)" : ""}`);

try {
  server = startServer();
  const port = await server.port;
  const origin = `http://127.0.0.1:${port}`;

  browser = await chromium.launch({ channel: "chrome", chromiumSandbox: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const external = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (new URL(url).hostname === "127.0.0.1") return route.continue();
    external.push(url);
    return route.abort();
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (new URL(socket.url()).hostname === "127.0.0.1") socket.connectToServer();
    else { external.push(socket.url()); socket.close(); }
  });

  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (err) => errors.push(String(err)));

  await page.goto(`${origin}/index.html?shot=iso`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(() => window.__cell && window.__cell.ready === true, null, { timeout: 45000 });
  const views = await page.evaluate(() => JSON.parse(JSON.stringify(window.__cell.views)));
  for (const name of ["iso", "front", "side", "top", "fanuc", "ur", "operator"]) {
    const v = views[name];
    if (!v || !Array.isArray(v.pos) || !Array.isArray(v.target)) throw new Error(`view ${name} missing from __cell.views`);
  }

  ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f", "image2pipe", "-framerate", "30", "-c:v", "png", "-i", "-",
    "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
    "-pix_fmt", "yuv420p", "-r", "30", "-s", "1920x1080",
    "-movflags", "+faststart",
    partPath,
  ], { stdio: ["pipe", "ignore", "pipe"] });
  let ffLog = "";
  ffmpeg.stderr.on("data", (d) => { ffLog = (ffLog + d).slice(-4000); });
  const ffExit = new Promise((resolve) => ffmpeg.once("exit", (code, signal) => resolve({ code, signal })));
  ffmpeg.stdin.on("error", () => {});

  const t0 = Date.now();
  for (let k = 0; k < count; k++) {
    const t = Math.min(k / 30, DURATION);
    const cam = cameraAt(views, t, DURATION);
    await page.evaluate(([time, pos, target]) => {
      window.__cell.seek(time);
      window.__cell.camera(pos, target);
    }, [t, cam.pos, cam.target]);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (errors.length) throw new Error(`page errors: ${errors.slice(0, 3).join(" | ")}`);
    if (external.length) throw new Error(`external requests: ${external.slice(0, 3).join(" | ")}`);
    const png = await page.screenshot({ type: "png" });
    if (!Buffer.isBuffer(png) || png.length < 1000) throw new Error(`frame ${k}: screenshot is empty`);
    if (ffmpeg.exitCode != null) throw new Error(`ffmpeg exited early (${ffmpeg.exitCode})\n${ffLog}`);
    if (!ffmpeg.stdin.write(png)) await once(ffmpeg.stdin, "drain");
    if ((k + 1) % 300 === 0 || k + 1 === count) {
      const elapsed = (Date.now() - t0) / 1000;
      const fps = (k + 1) / elapsed;
      const eta = (count - k - 1) / Math.max(fps, 1e-9);
      console.log(`frame ${k + 1}/${count}  ${fps.toFixed(2)} fps  eta ${(eta / 60).toFixed(1)} min`);
    }
  }
  ffmpeg.stdin.end();
  const { code, signal } = await ffExit;
  if (code !== 0) throw new Error(`ffmpeg exit ${code ?? signal}\n${ffLog}`);
  if (errors.length || external.length) throw new Error("page errors or external requests");
  if (probeFrames) {
    console.log(partPath);
  } else {
    renameSync(partPath, finalPath);
    console.log(`film: ${finalPath}`);
  }
  await shutdown(0);
} catch (error) {
  console.error("record failed:", error?.message ?? error);
  if (ffmpeg && ffmpeg.exitCode == null) ffmpeg.kill("SIGKILL");
  await shutdown(1);
}
