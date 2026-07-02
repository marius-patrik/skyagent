import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preparePluginRuntime } from "../prepare-plugin-runtime";

const repoRoot = process.cwd();

function fail(message: string): never {
  console.error(`Generated payload validation failed: ${message}`);
  process.exit(1);
}

function listFiles(root: string) {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };
  visit(root);
  return files.sort();
}

function runWithOutput(command: string[], env: NodeJS.ProcessEnv = process.env) {
  const proc = Bun.spawnSync(command, {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  if (proc.exitCode !== 0) {
    fail(`${command.join(" ")} failed\n${proc.stdout.toString()}\n${proc.stderr.toString()}`);
  }
  return proc.stdout.toString();
}

function run(command: string[], env: NodeJS.ProcessEnv = process.env) {
  runWithOutput(command, env);
}

function assertSameGeneratedTree(actualRoot: string, expectedRoot: string, label: string) {
  const actualFiles = listFiles(actualRoot);
  const expectedFiles = listFiles(expectedRoot);
  const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
  const extra = actualFiles.filter((file) => !expectedFiles.includes(file));
  if (missing.length > 0 || extra.length > 0) {
    fail(`${label} file tree is stale; missing=${missing.slice(0, 8).join(",") || "none"} extra=${extra.slice(0, 8).join(",") || "none"}`);
  }
  for (const relativePath of expectedFiles) {
    const actual = fs.readFileSync(path.join(actualRoot, ...relativePath.split("/")));
    const expected = fs.readFileSync(path.join(expectedRoot, ...relativePath.split("/")));
    const textAsset = /\.(html|css|js|json|txt|map|svg|LICENSE)$/i.test(relativePath);
    const same = textAsset
      ? actual.toString("utf8").replace(/\r\n/g, "\n") === expected.toString("utf8").replace(/\r\n/g, "\n")
      : actual.equals(expected);
    if (!same) {
      fail(`${label} differs from freshly generated payload at ${relativePath}`);
    }
  }
}

function assertWebDist(webDist: string, label: string) {
  const indexPath = path.join(webDist, "index.html");
  if (!fs.existsSync(indexPath)) {
    fail(`${label}/index.html is missing; run bun run build:web`);
  }
  const index = fs.readFileSync(indexPath, "utf8");
  for (const expected of ['meta name="skyagent-web"', 'id="root"', "/static/js/", "/static/css/"]) {
    if (!index.includes(expected)) {
      fail(`${label}/index.html is missing ${expected}`);
    }
  }
  const files = listFiles(webDist);
  if (!files.some((file) => /^static\/js\/index\..+\.js$/.test(file))) {
    fail(`${label} is missing hashed application JavaScript`);
  }
  if (!files.some((file) => /^static\/css\/index\..+\.css$/.test(file))) {
    fail(`${label} is missing hashed application CSS`);
  }
  if (!files.some((file) => file.includes("press-start-2p") && file.endsWith(".woff2"))) {
    fail(`${label} is missing the Minecraft-style generated font asset`);
  }
}

function assertWebPayload() {
  const webDist = path.join(repoRoot, "packages", "web", "dist");
  const webRoot = path.join(repoRoot, "packages", "web");
  const tempRoot = fs.mkdtempSync(path.join(webRoot, ".skyagent-web-dist-"));
  try {
    const generatedWebDist = path.join(tempRoot, "dist");
    const generatedWebDistFromWebRoot = path.relative(webRoot, generatedWebDist);
    run(["bun", "run", "--cwd", "packages/web", "build"], {
      ...process.env,
      SKYAGENT_WEB_DIST_DIR: generatedWebDistFromWebRoot,
    });
    assertWebDist(webDist, "packages/web/dist");
    assertWebDist(generatedWebDist, "fresh packages/web/dist");
    assertSameGeneratedTree(webDist, generatedWebDist, "packages/web/dist");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function assertPluginManifest(packageJson: any) {
  const manifestPath = path.join(repoRoot, ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const prefix = `${packageJson.version}+codex.`;
  if (typeof manifest.version !== "string" || !manifest.version.startsWith(prefix)) {
    fail(`.codex-plugin/plugin.json version ${manifest.version ?? "missing"} must start with ${prefix}`);
  }
  const cachebuster = manifest.version.slice(prefix.length);
  if (!/^20\d{12}$/.test(cachebuster)) {
    fail(`.codex-plugin/plugin.json cachebuster ${cachebuster || "missing"} must be a 14-digit timestamp`);
  }
  if (manifest.skills !== "./skills/" || manifest.mcpServers !== "./.mcp.json") {
    fail(".codex-plugin/plugin.json must point to ./skills/ and ./.mcp.json");
  }
}

function assertRuntimePayload() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assertPluginManifest(packageJson);
  const modulesDir = path.join(repoRoot, ".codex-plugin", "runtime", "modules");
  const rootNodeModulesDir = path.join(repoRoot, ".codex-plugin", "runtime", "root-node_modules");
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-generated-payload-"));
  try {
    const generatedModulesDir = path.join(tempRoot, "modules");
    const generatedRootNodeModulesDir = path.join(tempRoot, "root-node_modules");
    preparePluginRuntime(generatedModulesDir, {
      runtimeRootNodeModulesDir: generatedRootNodeModulesDir,
      writeRootShims: true,
    });
    assertSameGeneratedTree(modulesDir, generatedModulesDir, ".codex-plugin/runtime/modules");
    assertSameGeneratedTree(rootNodeModulesDir, generatedRootNodeModulesDir, ".codex-plugin/runtime/root-node_modules");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  for (const relativePath of [
    ".codex-plugin/runtime/modules/package.json",
    ".codex-plugin/runtime/modules/node_modules/package.json",
    ".codex-plugin/runtime/modules/node_modules/@skyagent/core/package.json",
    ".codex-plugin/runtime/modules/node_modules/@skyagent/mcp/package.json",
    ".codex-plugin/runtime/root-node_modules/@skyagent/core/package.json",
    ".codex-plugin/runtime/root-node_modules/@skyagent/mcp/package.json",
  ]) {
    const payload = JSON.parse(fs.readFileSync(path.join(repoRoot, ...relativePath.split("/")), "utf8"));
    if (payload.version !== packageJson.version) {
      fail(`${relativePath} version ${payload.version} does not match root package version ${packageJson.version}`);
    }
  }
  assertRuntimeContextSurface();
}

function assertRuntimeContextSurface() {
  const probe = `
    const mod = await import("./.codex-plugin/runtime/modules/node_modules/@skyagent/core/src/agent-context.ts");
    const snapshot = {
      kind: "skyagent.profileSnapshot",
      schemaVersion: 1,
      cacheStatus: "hit",
      stale: true,
      fetchedAt: "1970-01-01T00:00:01.000Z",
      ttlMs: 1,
      player: { username: "GeneratedProbe", uuid: "uuid" },
      profile: { profileId: "profile", cuteName: "Apple", selected: true, gameMode: "normal" },
      profiles: [],
      overview: {
        economy: {},
        inventoryApiSignals: {
          hasInventory: false,
          hasEnderChest: false,
          hasBackpacks: false,
          hasPersonalVault: false,
          hasSacks: true,
          hasEquipment: false,
          hasMuseum: false,
        },
        inventoryApiDetails: {
          inventory: { status: "api_disabled_or_missing", available: false, sourcePath: null, warnings: [{ code: "api_disabled_or_missing", message: "missing" }] },
          enderChest: { status: "api_disabled_or_missing", available: false, sourcePath: null, warnings: [] },
          backpacks: { status: "api_disabled_or_missing", available: false, sourcePath: null, warnings: [] },
          personalVault: { status: "api_disabled_or_missing", available: false, sourcePath: null, warnings: [] },
          sacks: { status: "present_empty", available: true, sourcePath: "member.inventory.bag_contents.sacks_bag", warnings: [] },
        },
        profileCompleteness: {
          selectedMember: { uuid: "uuid", memberPresent: true },
          coop: { memberCount: 1 },
          profileAvailability: { museumAvailable: false },
        },
        museum: { status: "missing", available: false, itemCount: 0, specialItemCount: 0, coopMemberMuseumCount: null },
      },
      warnings: [],
    };
    const capsule = mod.buildAgentContextFromSnapshot(snapshot, {
      now: 2_000,
      providers: { generatedAt: "1970-01-01T00:00:02.000Z", providers: [], warnings: [] },
      objectives: { counts: {}, active: [] },
    });
    if (!capsule.profileCompleteness?.selectedMember?.memberPresent) throw new Error("missing profileCompleteness");
    if (!capsule.storage?.inventory || capsule.storage.inventory.status !== "stale") throw new Error("missing stale storage");
    if (Object.prototype.hasOwnProperty.call(capsule.storage.inventory, "items")) throw new Error("storage item arrays must be omitted");
    if (!capsule.storage.sacks || capsule.storage.sacks.availabilityStatus !== "present_empty") throw new Error("missing present-empty sacks");
    if (!capsule.museum || capsule.museum.available !== false) throw new Error("missing museum signal");
    console.log(JSON.stringify({ ok: true, storage: capsule.storage.inventory.status, museum: capsule.museum.status }));
  `;
  const output = runWithOutput(["bun", "-e", probe]);
  if (!output.includes('"ok":true')) {
    fail("prepared runtime context probe did not report ok");
  }
}

assertWebPayload();
assertRuntimePayload();
console.log("Generated payload validation passed");
