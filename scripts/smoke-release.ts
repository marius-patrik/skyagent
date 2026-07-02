#!/usr/bin/env bun

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const expectedVersion = process.argv[2]
  ?? JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version
  ?? "0.0.0";

function currentTarget() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === "win32" && arch === "x64") return { id: "windows-x64", exe: "skyagent.exe" };
  if (platform === "linux" && arch === "x64") return { id: "linux-x64", exe: "skyagent" };
  if (platform === "darwin" && arch === "x64") return { id: "darwin-x64", exe: "skyagent" };
  if (platform === "darwin" && arch === "arm64") return { id: "darwin-arm64", exe: "skyagent" };
  throw new Error(`Unsupported release smoke target for current host: ${platform}-${arch}`);
}

async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function runJson(exePath: string, args: string[], env: NodeJS.ProcessEnv) {
  const proc = Bun.spawnSync([exePath, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
    env,
  });
  if (proc.exitCode !== 0) {
    throw new Error(`${path.basename(exePath)} ${args.join(" ")} failed with exit code ${proc.exitCode}`);
  }
  return JSON.parse(proc.stdout.toString());
}

function run(command: string[], env: NodeJS.ProcessEnv = process.env) {
  const proc = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "inherit", env });
  if (proc.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed with exit code ${proc.exitCode}`);
  }
  return proc.stdout.toString();
}

async function smokeInternalGatewayExecutable(exePath: string, env: NodeJS.ProcessEnv) {
  const port = await freePort();
  const token = "release-smoke-token";
  const proc = Bun.spawn([exePath, "--host=127.0.0.1", `--port=${port}`, `--token=${token}`], {
    cwd: root,
    stdout: "pipe",
    stderr: "inherit",
    stdin: "ignore",
    env: { ...env, SKYAGENT_INTERNAL_GATEWAY: "1" },
  });
  try {
    const reader = proc.stdout.getReader();
    const chunk = await reader.read();
    reader.releaseLock();
    const status = JSON.parse(new TextDecoder().decode(chunk.value));
    if (status.port !== port || status.host !== "127.0.0.1") {
      throw new Error("Internal gateway executable did not report the requested host/port.");
    }
    const version = await fetch(`http://127.0.0.1:${port}/version`, {
      headers: { authorization: `Bearer ${token}` },
    }).then((response) => response.json());
    if (!version.ok || version.version !== expectedVersion) {
      throw new Error("Internal gateway executable did not serve the expected version.");
    }
    await fetch(`http://127.0.0.1:${port}/shutdown`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`Internal gateway executable exited with ${exitCode}`);
    }
  } finally {
    if (!proc.killed) {
      proc.kill();
    }
  }
}

const cleanupDirs: string[] = [];
const cleanupStops: Array<{ exePath: string; env: NodeJS.ProcessEnv }> = [];
function cleanupSmoke() {
  for (const stop of cleanupStops.reverse()) {
    Bun.spawnSync([stop.exePath, "gateway", "stop", "--json"], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
      env: stop.env,
    });
  }
  for (const dir of cleanupDirs.reverse()) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

try {
const target = currentTarget();
const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-release-smoke-"));
const smokePort = await freePort();
const smokeEnv = { ...process.env, SKYAGENT_HOME: smokeHome, SKYAGENT_GATEWAY_PORT: String(smokePort) };
const smokeInstallDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-install-smoke-"));
const smokeReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-release-metadata-smoke-"));
cleanupDirs.push(smokeHome, smokeInstallDir, smokeReleaseDir);
const exePath = path.join(root, "dist", "release", target.id, target.exe);
if (!fs.existsSync(exePath)) {
  throw new Error(`Release executable was not found: ${exePath}`);
}
cleanupStops.push({ exePath, env: smokeEnv });

const archiveName = `skyagent-${target.id}.zip`;
const archivePath = path.join(root, "dist", "release", archiveName);
if (!fs.existsSync(archivePath)) {
  throw new Error(`Release archive was not found: ${archivePath}`);
}
const smokeArchivePath = path.join(smokeReleaseDir, archiveName);
fs.copyFileSync(archivePath, smokeArchivePath);

const version = runJson(exePath, ["version", "--json"], smokeEnv);
if (version.version !== expectedVersion) {
  throw new Error(`Expected release version ${expectedVersion}, got ${version.version ?? "unknown"}`);
}

run(["bun", "./scripts/write-release-metadata.ts", expectedVersion], {
  ...smokeEnv,
  SKYAGENT_RELEASE_OUT_DIR: smokeReleaseDir,
});
const metadata = JSON.parse(fs.readFileSync(path.join(smokeReleaseDir, "update.json"), "utf8"));
const checksumText = fs.readFileSync(path.join(smokeReleaseDir, "SHA256SUMS.txt"), "utf8");
const asset = metadata.assets?.find((entry: any) => entry.name === archiveName);
if (metadata.version !== expectedVersion || metadata.tag !== `v${expectedVersion}` || !asset?.sha256) {
  throw new Error("Release update metadata does not describe the current archive.");
}
if (!checksumText.includes(`${asset.sha256}  ${archiveName}`)) {
  throw new Error("SHA256SUMS.txt does not include the current archive checksum.");
}

const doctor = runJson(exePath, ["doctor", "--json"], smokeEnv);
if (!doctor.ok) {
  throw new Error("Release doctor check did not report ok=true");
}

await smokeInternalGatewayExecutable(exePath, smokeEnv);

const defaultStarted = runJson(exePath, ["start", "--json", "--cache-only", "--allow-stale"], smokeEnv);
if (!defaultStarted.agent?.ready || !defaultStarted.gateway?.url?.startsWith("http://127.0.0.1:")) {
  throw new Error("Release default start check did not report a ready local agent gateway.");
}
runJson(exePath, ["gateway", "stop", "--json"], smokeEnv);

const fallbackSmokeEnv = { ...smokeEnv, SKYAGENT_FORCE_GATEWAY_FALLBACK: "1" };
const started = runJson(exePath, ["start", "--json", "--cache-only", "--allow-stale"], fallbackSmokeEnv);
if (!started.agent?.ready || !started.gateway?.url?.startsWith("http://127.0.0.1:")) {
  throw new Error("Release fallback start check did not report a ready local agent gateway.");
}
runJson(exePath, ["gateway", "stop", "--json"], fallbackSmokeEnv);

const tui = runJson(exePath, ["tui", "--smoke"], smokeEnv);
if (tui.surface !== "tui" || !tui.screens?.includes("agent")) {
  throw new Error("Release TUI smoke did not expose the agent surface.");
}

if (process.platform === "win32") {
  run([
    "powershell",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    ".\\install\\install.ps1",
    "-Archive",
    archivePath,
    "-InstallDir",
    smokeInstallDir,
    "-NoPath",
  ], smokeEnv);
} else {
  run(["sh", "./install/install.sh"], {
    ...smokeEnv,
    SKYAGENT_ARCHIVE: archivePath,
    SKYAGENT_INSTALL_DIR: smokeInstallDir,
  });
}

const installedExePath = path.join(smokeInstallDir, process.platform === "win32" ? "skyagent.exe" : "skyagent");
if (!fs.existsSync(installedExePath)) {
  throw new Error(`Installed SkyAgent executable was not found: ${installedExePath}`);
}
cleanupStops.push({ exePath: installedExePath, env: smokeEnv });
const installedVersion = runJson(installedExePath, ["version", "--json"], smokeEnv);
if (installedVersion.version !== expectedVersion) {
  throw new Error(`Installed release version ${installedVersion.version ?? "unknown"} did not match ${expectedVersion}`);
}
const installedDoctor = runJson(installedExePath, ["doctor", "--json"], smokeEnv);
if (!installedDoctor.ok) {
  throw new Error("Installed release doctor check did not report ok=true");
}
await smokeInternalGatewayExecutable(installedExePath, smokeEnv);
const installedDefaultStarted = runJson(installedExePath, ["start", "--json", "--cache-only", "--allow-stale"], smokeEnv);
if (!installedDefaultStarted.agent?.ready || !installedDefaultStarted.gateway?.url?.startsWith("http://127.0.0.1:")) {
  throw new Error("Installed release default start check did not report a ready local agent gateway.");
}
runJson(installedExePath, ["gateway", "stop", "--json"], smokeEnv);

const installedFallbackSmokeEnv = { ...smokeEnv, SKYAGENT_FORCE_GATEWAY_FALLBACK: "1" };
const installedStarted = runJson(installedExePath, ["start", "--json", "--cache-only", "--allow-stale"], installedFallbackSmokeEnv);
if (!installedStarted.agent?.ready || !installedStarted.gateway?.url?.startsWith("http://127.0.0.1:")) {
  throw new Error("Installed release fallback start check did not report a ready local agent gateway.");
}
runJson(installedExePath, ["gateway", "stop", "--json"], installedFallbackSmokeEnv);

const installedTui = runJson(installedExePath, ["tui", "--smoke"], smokeEnv);
if (installedTui.surface !== "tui" || !installedTui.screens?.includes("agent")) {
  throw new Error("Installed release TUI smoke did not expose the agent surface.");
}

console.log(JSON.stringify({
  ok: true,
  target: target.id,
  version: version.version,
  installPath: doctor.installPath,
  defaultStartUrl: defaultStarted.gateway.url,
  startUrl: started.gateway.url,
  tuiScreens: tui.screens,
  updateMetadata: { tag: metadata.tag, asset: asset.name },
  installSmokeDir: smokeInstallDir,
  installedVersion: installedVersion.version,
}, null, 2));
} finally {
  cleanupSmoke();
}
