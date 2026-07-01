import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import packageMetadata from "../../../package.json" with { type: "json" };
import { setupStatus } from "@skyagent/core/setup";
import { gatewayCommand } from "./gateway.ts";
import { webCommand } from "./web.ts";

type UpdateAsset = {
  name: string;
  size?: number;
  sha256: string;
};

type UpdateMetadata = {
  version: string;
  tag: string;
  assets: UpdateAsset[];
};

type UpdateOptions = {
  repo?: string;
  version?: string | null;
  installPath?: string | null;
  dryRun?: boolean;
  restart?: "none" | "gateway" | "web" | "all";
  fetchText?: (url: string) => Promise<string>;
  fetchBytes?: (url: string) => Promise<Uint8Array>;
  validateInstallPath?: (installPath: string) => Promise<unknown>;
};

function targetId() {
  if (process.platform === "win32" && process.arch === "x64") return { id: "windows-x64", exe: "skyagent.exe" };
  if (process.platform === "linux" && process.arch === "x64") return { id: "linux-x64", exe: "skyagent" };
  if (process.platform === "darwin" && process.arch === "x64") return { id: "darwin-x64", exe: "skyagent" };
  if (process.platform === "darwin" && process.arch === "arm64") return { id: "darwin-arm64", exe: "skyagent" };
  throw new Error(`Unsupported update target: ${process.platform}-${process.arch}`);
}

function releaseBase(repo: string, version?: string | null) {
  const release = version ? `download/${version.startsWith("v") ? version : `v${version}`}` : "latest/download";
  return `https://github.com/${repo}/releases/${release}`;
}

function releaseRepo(options: UpdateOptions) {
  if (options.repo) return options.repo;
  const url = packageMetadata.repository?.url ?? "";
  const match = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(url);
  if (!match) throw new Error("Could not determine SkyAgent release repository from package metadata.");
  return match[1];
}

async function defaultFetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return await response.text();
}

async function defaultFetchBytes(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function compareVersions(a: string, b: string) {
  const parse = (value: string) => {
    const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value);
    if (!match) return [0, 0, 0];
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < 3; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

export async function updatePlan(options: UpdateOptions = {}) {
  const repo = releaseRepo(options);
  const current = setupStatus().version;
  const target = targetId();
  const base = releaseBase(repo, options.version);
  const fetchText = options.fetchText ?? defaultFetchText;
  const metadata: UpdateMetadata = JSON.parse(await fetchText(`${base}/update.json`));
  const checksumText = await fetchText(`${base}/SHA256SUMS.txt`);
  const asset = metadata.assets.find((entry) => entry.name === `skyagent-${target.id}.zip`);
  if (!asset) {
    throw new Error(`Release ${metadata.tag} does not include an asset for ${target.id}`);
  }
  const checksum = checksumText.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find((parts) => parts[1] === asset.name)?.[0];
  if (!checksum) throw new Error(`SHA256SUMS.txt does not include ${asset.name}`);
  if (asset.sha256 && asset.sha256 !== checksum) throw new Error(`Checksum metadata mismatch for ${asset.name}`);
  const verifiedAsset = { ...asset, sha256: checksum };
  return {
    currentVersion: current,
    latestVersion: metadata.version,
    updateAvailable: compareVersions(metadata.version, current) > 0,
    requestedVersion: options.version ?? null,
    repo,
    tag: metadata.tag,
    target: target.id,
    asset: verifiedAsset,
    artifactUrl: `${base}/${asset.name}`,
    checksumUrl: `${base}/SHA256SUMS.txt`,
    metadataUrl: `${base}/update.json`,
  };
}

function assertChecksum(bytes: Uint8Array, expected: string) {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch: expected ${expected}, got ${actual}`);
  }
  return actual;
}

function assertSafeZipPath(entryName: string) {
  const normalized = entryName.replace(/\\/g, "/");
  if (
    normalized.startsWith("/")
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(`Unsafe update archive entry: ${entryName}`);
  }
  return normalized;
}

function extractExecutableFromZip(bytes: Uint8Array, exeName: string, destination: string) {
  const buffer = Buffer.from(bytes);
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset < 0) throw new Error("Invalid update archive: missing ZIP directory.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  let offset = centralOffset;
  let selected: { method: number; compressedSize: number; localOffset: number; name: string } | null = null;

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid update archive: corrupt ZIP directory.");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = assertSafeZipPath(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    if (!name.endsWith("/") && path.posix.basename(name) === exeName) {
      selected = { method, compressedSize, localOffset, name };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  if (!selected) throw new Error(`${exeName} was not found in update archive.`);
  if (buffer.readUInt32LE(selected.localOffset) !== 0x04034b50) throw new Error("Invalid update archive: corrupt local file header.");
  const nameLength = buffer.readUInt16LE(selected.localOffset + 26);
  const extraLength = buffer.readUInt16LE(selected.localOffset + 28);
  const dataStart = selected.localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + selected.compressedSize);
  const fileBytes = selected.method === 0
    ? compressed
    : selected.method === 8
      ? inflateRawSync(compressed)
      : null;
  if (!fileBytes) throw new Error(`Unsupported ZIP compression method for ${selected.name}: ${selected.method}`);
  const outputPath = path.join(destination, exeName);
  fs.writeFileSync(outputPath, fileBytes);
  if (process.platform !== "win32") fs.chmodSync(outputPath, 0o755);
  return outputPath;
}

function replaceExecutable(source: string, target: string) {
  const next = `${target}.new`;
  const backup = `${target}.old`;
  fs.copyFileSync(source, next);
  if (process.platform !== "win32") fs.chmodSync(next, 0o755);
  fs.rmSync(backup, { force: true });
  if (process.platform === "win32") {
    const script = [
      "Start-Sleep -Seconds 1",
      "try {",
      "Move-Item -LiteralPath $env:SKYAGENT_TARGET -Destination $env:SKYAGENT_BACKUP -Force -ErrorAction SilentlyContinue",
      "Move-Item -LiteralPath $env:SKYAGENT_NEXT -Destination $env:SKYAGENT_TARGET -Force",
      "} catch {",
      "if ((Test-Path -LiteralPath $env:SKYAGENT_BACKUP) -and -not (Test-Path -LiteralPath $env:SKYAGENT_TARGET)) { Move-Item -LiteralPath $env:SKYAGENT_BACKUP -Destination $env:SKYAGENT_TARGET -Force }",
      "throw",
      "}",
    ].join("; ");
    Bun.spawn(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", script], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: { ...process.env, SKYAGENT_TARGET: target, SKYAGENT_NEXT: next, SKYAGENT_BACKUP: backup },
    });
    return { replaced: false, pendingReplacement: true, target, stagedPath: next, backupPath: backup };
  }
  const hadTarget = fs.existsSync(target);
  try {
    if (hadTarget) fs.renameSync(target, backup);
    fs.renameSync(next, target);
  } catch (error) {
    fs.rmSync(target, { force: true });
    if (hadTarget && fs.existsSync(backup)) {
      fs.renameSync(backup, target);
    }
    throw error;
  }
  return { replaced: true, pendingReplacement: false, target, backupPath: backup };
}

function assertStandaloneInstallPath(installPath: string) {
  const resolved = path.resolve(installPath);
  const realPath = fs.existsSync(resolved) ? fs.realpathSync.native(resolved) : resolved;
  const expectedName = targetId().exe;
  const scriptExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
  if (path.basename(resolved) !== expectedName) {
    throw new Error(`Refusing to update non-standalone install path: expected ${expectedName}, got ${path.basename(resolved)}`);
  }
  if (scriptExtensions.has(path.extname(resolved)) || scriptExtensions.has(path.extname(realPath))) {
    throw new Error("Refusing to overwrite a script/source checkout. Use a standalone SkyAgent install for updates.");
  }
}

async function validateStandaloneExecutable(installPath: string) {
  const proc = Bun.spawn([installPath, "version", "--json"], { stdout: "pipe", stderr: "ignore" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error("Install target did not run as a SkyAgent standalone executable.");
  }
  try {
    const parsed = JSON.parse(stdout);
    if (typeof parsed.version === "string" && parsed.version) return parsed;
  } catch {
    // Fall through to the structured error below.
  }
  throw new Error("Install target did not report a SkyAgent version.");
}

async function restartManaged(restart: UpdateOptions["restart"]) {
  if (!restart || restart === "none") return [];
  const restarted = [];
  if (restart === "gateway" || restart === "all") restarted.push({ gateway: await gatewayCommand("restart", ["--json"]) });
  if (restart === "web" || restart === "all") restarted.push({ web: await webCommand("restart", ["--json", "--no-open"]) });
  return restarted;
}

export async function installUpdate(options: UpdateOptions = {}) {
  const plan = await updatePlan(options);
  const installPath = options.installPath ?? setupStatus().installPath;
  if (!installPath) throw new Error("Could not determine current SkyAgent install path.");
  assertStandaloneInstallPath(installPath);
  const installTarget = await (options.validateInstallPath ?? validateStandaloneExecutable)(installPath);
  if (!options.version && !plan.updateAvailable) {
    throw new Error(`SkyAgent is already up to date at ${plan.currentVersion}. Use --version to install a specific release.`);
  }
  if (options.dryRun) {
    return { ...plan, dryRun: true, installPath, installTarget };
  }

  const bytes = await (options.fetchBytes ?? defaultFetchBytes)(plan.artifactUrl);
  const sha256 = assertChecksum(bytes, plan.asset.sha256);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-update-"));
  try {
    const extractDir = path.join(tempDir, "extract");
    fs.mkdirSync(extractDir);
    const executable = extractExecutableFromZip(bytes, targetId().exe, extractDir);
    const replacement = replaceExecutable(executable, installPath);
    const restarted = await restartManaged(options.restart);
    return { ...plan, installPath, sha256, ...replacement, restarted };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function parseUpdateArgs(args: string[]) {
  const flagsWithValues = new Set(["--version", "--restart"]);
  const knownFlags = new Set(["--json", "--dry-run", "--version", "--restart"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected update argument: ${arg}`);
    if (!knownFlags.has(arg)) throw new Error(`Unknown update flag: ${arg}`);
    if (flagsWithValues.has(arg)) index += 1;
  }
  const versionIndex = args.indexOf("--version");
  const restartIndex = args.indexOf("--restart");
  const restart = restartIndex >= 0 ? args[restartIndex + 1] : "none";
  const version = versionIndex >= 0 ? args[versionIndex + 1] : null;
  if (versionIndex >= 0 && (!version || version.startsWith("--"))) {
    throw new Error("Usage: --version requires a version value.");
  }
  if (!["none", "gateway", "web", "all"].includes(restart ?? "")) {
    throw new Error("Usage: --restart must be one of gateway, web, or all.");
  }
  return {
    json: args.includes("--json"),
    dryRun: args.includes("--dry-run"),
    version,
    restart: restart as UpdateOptions["restart"],
  };
}
