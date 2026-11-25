// Scene acceptance test (SPEC §6). Serves this project on 127.0.0.1 only.
// Any other host is aborted inside Playwright and counted as a failure, so the
// page cannot send a request off the machine. The logic block is evaluated
// locally from the file under test (SPEC §4); it is not sent anywhere.
// Usage: node tests/scene.mjs [--fixture <path>]
import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TCP_TOL_M = 0.002; // 2 mm, SPEC §6
const SAMPLES = 12;

function pageFile(args) {
  const fixture = args.length === 0 ? "index.html" : args[1];
  if ((args.length && (args.length !== 2 || args[0] !== "--fixture")) ||
      !fixture || isAbsolute(fixture)) {
    throw new Error("usage: node tests/scene.mjs [--fixture <project-relative path>]");
  }
  const abs = realpathSync(resolve(root, fixture));
  const rel = relative(realpathSync(root), abs);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("fixture path escapes the project");
  }
  return { abs, urlPath: rel.split(sep).map(encodeURIComponent).join("/") };
}

function loadLogic(abs) {
  const html = readFileSync(abs, "utf8");
  const m = html.match(/\/\/ @@logic-start[^\n]*\n([\s\S]*?)\/\/ @@logic-end/);
  if (!m) throw new Error("logic block not found");
  // Local file only. The function receives a mute console and no other bindings.
  const api = new Function("console", `${m[1]}\nreturn { current: typeof current === "function" ? current : undefined };`)({ log() {} });
  if (typeof api.current !== "function") throw new Error("current() is missing");
  const model = api.current();
  if (!model || !model.S || !Array.isArray(model.S.t)) throw new Error("current().S.t is missing");
  return model;
}

function pickIndices(n, k) {
  const idx = [];
  for (let i = 0; i < k; i++) idx.push(Math.round((i * (n - 1)) / (k - 1)));
  return idx;
}

function asVec(v) {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => Number.isFinite(n))) return null;
  return v;
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function oneLine(s) {
  return String(s).replace(/\s+/g, " ").slice(0, 500);
}

function startServer() {
  return spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1"], {
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function serverPort(server) {
  return new Promise((resolvePort, reject) => {
    let output = "";
    const timer = setTimeout(() => finish(new Error("http.server startup timeout")), 8000);

    function finish(error, port) {
      clearTimeout(timer);
      server.stdout.off("data", onData);
      server.off("error", onError);
      server.off("exit", onExit);
      if (error) reject(error);
      else resolvePort(port);
    }

    function onData(chunk) {
      output += chunk;
      const match = output.match(/Serving HTTP on 127\.0\.0\.1 port (\d+)/);
      if (match) finish(null, Number(match[1]));
    }

    function onError(error) {
      finish(error);
    }

    function onExit(code) {
      finish(new Error(`http.server exited during startup (${code})`));
    }

    server.stdout.on("data", onData);
    server.once("error", onError);
    server.once("exit", onExit);
  });
}

function stopServer(server) {
  if (!server || !server.pid || server.exitCode != null || server.signalCode != null) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      server.kill("SIGKILL");
      resolveStop();
    }, 2000);
    server.once("exit", () => {
      clearTimeout(timer);
      resolveStop();
    });
    server.kill("SIGTERM");
  });
}

const fails = [];
function check(ok, msg) {
  console.log(`${ok ? "PASS" : "FAIL"} ${oneLine(msg)}`);
  if (!ok) fails.push(msg);
}

let browser;
let server;
try {
  const pagePath = pageFile(process.argv.slice(2));
  const model = loadLogic(pagePath.abs);
  const n = model.S.t.length;
  if (n < SAMPLES || !Array.isArray(model.S.fTcp) || model.S.fTcp.length !== n ||
      !Array.isArray(model.S.uTcp) || model.S.uTcp.length !== n ||
      !model.S.t.every(Number.isFinite)) {
    throw new Error("invalid logic samples");
  }
  check(true, `logic samples ${n}`);

  // playwright-core from node_modules (CI, npm ci); the Homebrew global install is the local fallback.
  const { chromium } = await import("playwright-core").catch(() => import("/opt/homebrew/lib/node_modules/playwright/index.mjs"));
  server = startServer();
  const port = await serverPort(server);
  const origin = `http://127.0.0.1:${port}`;

  browser = await chromium.launch({
    channel: "chrome",
    chromiumSandbox: true,
    // http.server never forwards proxy traffic. This also contains redirects
    // and browser requests that Playwright routing cannot intercept.
    proxy: { server: origin, bypass: "<-loopback>,127.0.0.1" },
    args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
  });
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const blocked = new Set();
  const isLocal = (url) => new URL(url).hostname === "127.0.0.1";

  context.on("request", (request) => {
    const url = request.url();
    if (!isLocal(url)) blocked.add(url);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(oneLine(msg.text()));
  });
  page.on("pageerror", (err) => pageErrors.push(oneLine(err)));
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isLocal(url)) await route.continue();
    else {
      blocked.add(url);
      await route.abort();
    }
  });
  await context.routeWebSocket("**/*", (socket) => {
    if (isLocal(socket.url())) socket.connectToServer();
    else {
      blocked.add(socket.url());
      return socket.close();
    }
  });

  await page.goto(`${origin}/${pagePath.urlPath}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  let ready = false;
  try {
    await page.waitForFunction(() => window.__cell && window.__cell.ready === true, { timeout: 20000 });
    ready = true;
    check(true, "ready");
  } catch {
    check(false, "ready timeout");
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

  if (ready) {
    const idx = pickIndices(n, SAMPLES);
    for (const i of idx) {
      const t = model.S.t[i];
      let got = null;
      try {
        got = await page.evaluate(async (time) => {
          await window.__cell.seek(time);
          return {
            fanuc: window.__cell.tcp("fanuc"),
            ur: window.__cell.tcp("ur"),
          };
        }, t);
      } catch (error) {
        check(false, `seek t=${Number(t).toFixed(3)}: ${error.message}`);
        continue;
      }
      for (const name of ["fanuc", "ur"]) {
        const key = name === "fanuc" ? "fTcp" : "uTcp";
        const exp = asVec(model.S[key][i]);
        const act = asVec(got[name]);
        if (!exp || !act) {
          check(false, `tcp ${name} t=${Number(t).toFixed(3)} missing position`);
          continue;
        }
        const mm = dist(act, exp) * 1000;
        check(mm <= TCP_TOL_M * 1000 + 1e-6, `tcp ${name} t=${Number(t).toFixed(3)} err=${mm.toFixed(2)} mm`);
      }
    }
  }

  let cellErrors = [];
  if (ready) {
    try {
      cellErrors = await page.evaluate(() => {
        const e = window.__cell && window.__cell.errors;
        return Array.isArray(e) ? e.map((x) => String(x)) : ["errors is not an array"];
      });
    } catch (error) {
      cellErrors = [error.message];
    }
  }
  check(cellErrors.length === 0, cellErrors.length ? `cell errors: ${cellErrors.join(" | ")}` : "cell errors empty");
  check(consoleErrors.length === 0, consoleErrors.length ? `console errors: ${consoleErrors.join(" | ")}` : "console errors 0");
  check(pageErrors.length === 0, pageErrors.length ? `pageerror: ${pageErrors.join(" | ")}` : "pageerror 0");
  check(blocked.size === 0, blocked.size ? `external requests blocked: ${[...blocked].join(" | ")}` : "external requests 0");
} catch (error) {
  check(false, error.message || String(error));
} finally {
  if (browser) await browser.close().catch((error) => check(false, `browser close: ${error.message}`));
  await stopServer(server);
}

process.exit(fails.length ? 1 : 0);
