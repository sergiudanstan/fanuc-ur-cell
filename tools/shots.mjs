// Deterministic Playwright stills of the cell, with external-request & error enforcement.
// Usage:
//   node tools/shots.mjs --quick   -> loads index.html without params, writes shots/quick.png
//   node tools/shots.mjs           -> shoots all 7 SPEC §6 views at active cycle timestamps
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = await import("/opt/homebrew/lib/node_modules/playwright/index.mjs");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "shots");
const quick = process.argv.includes("--quick");
const VIEWS = ["iso", "front", "side", "top", "fanuc", "ur", "operator"];

mkdirSync(outDir, { recursive: true });

// Bind ephemeral free port on 127.0.0.1 so parallel nodes never collide
const server = spawn("python3", ["-u", "-m", "http.server", "0", "--bind", "127.0.0.1"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverLog = "";
const port = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("http.server did not bind a port in time\n" + serverLog)), 8000);
  const onData = (chunk) => {
    serverLog += chunk.toString();
    const m = serverLog.match(/Serving HTTP on 127\.0\.0\.1 port (\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  };
  server.stdout.on("data", onData);
  server.stderr.on("data", onData);
  server.on("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`http.server exited early (${code})\n${serverLog}`));
  });
});

const errors = [];
const externalReqs = [];
let browser;

try {
  browser = await chromium.launch({
    channel: "chrome",
    chromiumSandbox: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1") return route.continue();
    externalReqs.push(url.origin);
    return route.abort();
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    errors.push(`pageerror: ${String(err)}`);
  });

  async function capture(file) {
    await page.waitForLoadState("networkidle");
    const cellErrors = await page.evaluate(() => window.__cell.errors);
    for (const error of cellErrors) errors.push(`window.__cell.errors: ${error}`);
    if (errors.length || externalReqs.length) {
      throw new Error([...errors, ...externalReqs.map((origin) => `Blocked external request: ${origin}`)].join("\n"));
    }
    await page.screenshot({ path: file });
  }

  const baseUrl = `http://127.0.0.1:${port}/index.html`;

  if (quick) {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.__cell && window.__cell.ready === true, { timeout: 30000 });
    const file = join(outDir, "quick.png");
    await capture(file);
    console.log(file);
  } else {
    // Probe model timestamps from current() first
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => window.__cell && window.__cell.ready === true, { timeout: 30000 });
    const shotTimes = await page.evaluate(() => {
      const m = window.__cellCurrent?.() ?? (typeof current === "function" ? current() : null);
      const mid = (seg) => seg ? (seg.t0 + seg.t1) / 2 : 0;
      const fanucSeg = m?.segs?.fanuc?.find((s) => s.kind === "pick" || s.kind === "load") || m?.segs?.fanuc?.[0];
      const urSeg = m?.segs?.ur?.find((s) => s.kind === "cover" || s.kind === "screw") || m?.segs?.ur?.[0];
      const opSwap = m?.trays?.swaps?.[0];
      const opSeg = opSwap || m?.segs?.operator?.find((s) => s.kind === "swap");
      const dur = m?.DURATION || 0;
      const tDefault = urSeg ? mid(urSeg) : dur * 0.25;
      return {
        iso: tDefault,
        front: tDefault,
        side: tDefault,
        top: tDefault,
        fanuc: fanucSeg ? mid(fanucSeg) : dur * 0.20,
        ur: urSeg ? mid(urSeg) : dur * 0.30,
        operator: opSeg ? mid(opSeg) : dur * 0.50,
      };
    });

    for (const v of VIEWS) {
      const t = Number(shotTimes[v] ?? 0).toFixed(2);
      await page.goto(`${baseUrl}?shot=${encodeURIComponent(v)}&t=${t}`, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForFunction(() => window.__cell && window.__cell.ready === true, { timeout: 30000 });
      const file = join(outDir, `${v}.png`);
      await capture(file);
      console.log(`${file} (t=${t})`);
    }
  }

  if (externalReqs.length) {
    console.error(`external requests blocked (${externalReqs.length}):`);
    for (const u of externalReqs) console.error("  " + u);
    process.exitCode = 1;
  }
  if (errors.length) {
    console.error(`errors (${errors.length}):`);
    for (const e of errors) console.error("  " + e);
    process.exitCode = 1;
  }
  if (!externalReqs.length && !errors.length) {
    console.log("shots OK: 0 external requests, 0 errors");
  }
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
