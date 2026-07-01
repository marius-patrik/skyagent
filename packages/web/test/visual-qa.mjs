import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.resolve(webDir, "../..");
const distDir = path.join(webDir, "dist");
const artifactsDir = path.join(root, "artifacts", "web-visual");

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function ensureBuilt() {
  const result = spawnSync("bun", ["run", "--cwd", "packages/web", "build"], {
    cwd: root,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`web build failed\n${result.stdout}\n${result.stderr}`);
  }
}

function serve() {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const requestPath = url.pathname === "/" ? "/index.html" : url.pathname;
    const target = path.normalize(path.join(distDir, requestPath));
    const filePath = target.startsWith(distDir) && fs.existsSync(target) && fs.statSync(target).isFile()
      ? target
      : path.join(distDir, "index.html");
    response.setHeader("content-type", mime[path.extname(filePath)] ?? "application/octet-stream");
    fs.createReadStream(filePath).pipe(response);
  });
}

const tabs = ["Overview", "Inventory", "Networth", "Accessories", "Progression", "Planner", "Resource Packs", "Settings"];

async function assertViewport(browser, url, name, viewport) {
  const page = await browser.newPage({ viewport });
  await page.goto(url, { waitUntil: "networkidle" });
  for (const tab of tabs) {
    await page.getByRole("tab", { name: tab }).click();
    await page.screenshot({ path: path.join(artifactsDir, `${name}-${tab.toLowerCase().replaceAll(" ", "-")}.png`), fullPage: true });
  }
  const result = await page.evaluate(() => ({
    textLength: document.body.innerText.trim().length,
    horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    panels: document.querySelectorAll(".panel, .metric, .profile-band").length,
    selectedTab: document.querySelector('[role="tab"][data-state="active"]')?.textContent,
  }));
  await page.close();
  if (result.textLength < 300) throw new Error(`${name} rendered too little text`);
  if (result.panels < 1) throw new Error(`${name} rendered too few content panels`);
  if (result.horizontalOverflow) throw new Error(`${name} has horizontal overflow`);
  if (result.selectedTab !== "Settings") throw new Error(`${name} did not visit all tabs`);
}

ensureBuilt();
fs.mkdirSync(artifactsDir, { recursive: true });
const server = serve();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const browser = await chromium.launch({ timeout: 15_000 });

try {
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  await assertViewport(browser, url, "desktop", { width: 1440, height: 960 });
  await assertViewport(browser, url, "mobile", { width: 390, height: 844 });
  console.log(JSON.stringify({ ok: true, artifactsDir }));
} finally {
  await browser.close();
  server.close();
}
