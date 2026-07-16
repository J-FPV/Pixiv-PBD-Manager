// Screenshot driver for the mock GUI. Boots `npm run dev:mock` (the real React
// frontend against src/mockApi.ts — no Tauri shell, no Python) if it is not
// already running, drives it headless in Chrome, and writes PNGs of the main
// views. Agents use this to *see* frontend changes without a WebView2 window.
//
//   cd desktop
//   node e2e/screenshot.mjs                # all views
//   node e2e/screenshot.mjs library detail # just these
//   node e2e/screenshot.mjs --out=C:\tmp\shots artists
//
// Views: artists, library, detail, scan-preview, similar, settings
// Output: desktop/test-results/screenshots/<view>.png (gitignored) unless --out=.
// The mock UI is pinned to zh (mockData settings), so labels below are zh.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:1421";
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const VIEWS = {
  artists: async (page) => {
    await page.getByRole("button", { name: "艺术家" }).click();
    await page.getByText("Sample Artist", { exact: true }).waitFor();
  },
  library: async (page) => {
    // exact: true — on the library tab itself, "图库" also matches "图库体检".
    await page.getByRole("button", { name: "图库", exact: true }).click();
    await page.getByRole("button", { name: /101000001_p0\.jpg/ }).waitFor();
  },
  // Modal views return a cleanup that closes the modal after the screenshot —
  // an open modal overlay intercepts every click the next view would make.
  detail: async (page) => {
    await VIEWS.library(page);
    await page.getByRole("button", { name: /101000001_p0\.jpg/ }).click();
    await page.getByRole("heading", { name: "101000001_p0.jpg" }).waitFor();
    return () => page.getByRole("button", { name: "关闭" }).click();
  },
  "scan-preview": async (page) => {
    await page.getByRole("button", { name: "艺术家" }).click();
    await page.getByRole("button", { name: "扫描", exact: true }).click();
    await page.getByRole("heading", { name: "扫描预览" }).waitFor();
    return () => page.getByRole("button", { name: "取消", exact: true }).click();
  },
  similar: async (page) => {
    await page.getByRole("button", { name: "相似图片" }).click();
    await page.getByRole("button", { name: "查找相似图片" }).click();
    await page.getByText(/4 files.*1 groups/i).waitFor();
  },
  settings: async (page) => {
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByText("扫描与解析", { exact: true }).waitFor();
  }
};

async function serverUp() {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

// Kill whatever owns :1421. taskkill /T on the npm shell tree is not enough —
// vite's node child can get orphaned and keep the port (seen in practice).
function killPortOwner() {
  const out = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8" }).stdout ?? "";
  for (const line of out.split("\n")) {
    if (!line.includes(":1421") || !line.includes("LISTENING")) continue;
    const pid = line.trim().split(/\s+/).pop();
    if (pid && pid !== "0") {
      spawnSync("taskkill", ["/PID", pid, "/T", "/F"], { stdio: "ignore" });
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const outArg = args.find((arg) => arg.startsWith("--out="))?.slice(6);
  const outDir = outArg
    ? isAbsolute(outArg) ? outArg : resolve(process.cwd(), outArg)
    : join(desktopDir, "test-results", "screenshots");
  const wanted = args.filter((arg) => !arg.startsWith("--"));
  const names = wanted.length ? wanted : Object.keys(VIEWS);
  for (const name of names) {
    if (!VIEWS[name]) {
      console.error(`unknown view "${name}" — have: ${Object.keys(VIEWS).join(", ")}`);
      process.exit(2);
    }
  }
  mkdirSync(outDir, { recursive: true });

  let server = null;
  if (!(await serverUp())) {
    // Single command string: args + shell:true triggers Node's DEP0190 warning.
    server = spawn("npm run dev:mock", { cwd: desktopDir, shell: true, stdio: "ignore" });
    const deadline = Date.now() + 60_000;
    while (!(await serverUp())) {
      if (Date.now() > deadline) throw new Error("dev:mock did not come up on :1421 within 60s");
      await new Promise((tick) => setTimeout(tick, 300));
    }
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(BASE_URL);
    await page.getByText("Sample Artist", { exact: true }).waitFor();
    for (const name of names) {
      const cleanup = await VIEWS[name](page);
      const file = join(outDir, `${name}.png`);
      await page.screenshot({ path: file });
      console.log(file);
      if (cleanup) await cleanup();
    }
    if (errors.length) {
      console.error(`page errors:\n${errors.join("\n")}`);
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
    if (server?.pid) {
      spawnSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      killPortOwner();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
