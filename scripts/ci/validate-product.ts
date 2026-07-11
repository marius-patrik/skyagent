import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function fail(message: string): never {
  throw new Error(`Product validation failed: ${message}`);
}

function files() {
  const result = Bun.spawnSync(["git", "ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) fail(result.stderr.toString().trim() || "cannot enumerate repository files");
  return result.stdout.toString().split(/\r?\n/).filter(Boolean).sort();
}

function readJson(relative: string) {
  return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
}

function assertManifest() {
  const manifest = readJson("agent.package.json");
  const expected = {
    schemaVersion: 1,
    id: "skyagent",
    name: "SkyAgent",
    kind: "app",
    description: "Hypixel SkyBlock profile analysis, progression planning, terminal UI, web UI, and MCP service for Agent OS.",
    entry: "bun packages/cli/src/bin.ts",
    requires: {
      clis: ["bun"],
      state: ["runtime/apps/skyagent", "secrets/HYPIXEL_API_KEY.secret"],
    },
    provides: ["cli:skyagent", "service:mcp:skyagent", "ui:tui:skyagent", "ui:web:skyagent", "skills:skyagent"],
  };
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) fail("agent.package.json does not match the canonical app contract");
}

function assertPackages(repositoryFiles: string[]) {
  const rootPackage = readJson("package.json");
  if (rootPackage.packageManager !== "bun@1.3.14" || rootPackage.engines?.bun !== "1.3.14") fail("Bun must be pinned to 1.3.14");
  if (rootPackage.bin) fail("root package must not publish an alternate executable");
  for (const file of repositoryFiles.filter((file) => /(^|\/)package\.json$/.test(file))) {
    const pkg = readJson(file);
    if (file.startsWith("packages/") && pkg.version !== rootPackage.version) fail(`${file} version must match the root application version`);
    if (pkg.bin) fail(`${file} must not publish an alternate executable`);
    for (const section of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (typeof version === "string" && /^[~^]/.test(version)) fail(`${file} ${section}.${name} must be exact`);
      }
    }
  }
}

function assertPaths(repositoryFiles: string[]) {
  const retiredPaths = [
    ".mcp.json",
    ".codex-plugin/",
    ".agents/AGENTS.md",
    "packages/gateway/",
    "packages/web/dist/",
    "install/",
    "scripts/skyagent.ts",
    "scripts/mcp-server.ts",
    "scripts/prepare-plugin-runtime.ts",
    "scripts/build-release.ts",
    ".github/workflows/release.yml",
  ];
  for (const file of repositoryFiles) {
    if (retiredPaths.some((retired) => retired.endsWith("/") ? file.startsWith(retired) : file === retired)) fail(`retired product path is present: ${file}`);
    if (/^skills\/[^/]+\/agents\//.test(file)) fail(`provider-owned skill metadata is present: ${file}`);
    const info = fs.lstatSync(path.join(root, file));
    if (info.isSymbolicLink()) fail(`repository file must not be a symlink: ${file}`);
  }
}

function assertText(repositoryFiles: string[]) {
  const textFiles = repositoryFiles.filter((file) => !file.endsWith("bun.lock") && file !== "scripts/ci/validate-product.ts");
  const retiredTerms = new RegExp([
    "\\b" + ["co", "dex"].join("") + "\\b",
    "\\b" + ["clau", "de"].join("") + "\\b",
    "\\b" + ["ki", "mi"].join("") + "\\b",
    "\\b" + ["a", "gy"].join("") + "\\b",
    "\\b" + ["gem", "ini"].join("") + "\\b",
    "\\b" + ["open", "ai"].join("") + "\\b",
    ["lite", "llm"].join(""),
    "skyagent_(?:start|context_bootstrap|context_watch)",
    "agent\\.session_start",
    "SKYAGENT_(?:HOME|LLM|LITELLM)",
    "@skyagent/gateway",
    "\\bgateway\\b",
    "\\b(?:compatibility|legacy|shim)\\b",
    "\\.skyagent",
  ].join("|"), "i");
  for (const file of textFiles) {
    const absolute = path.join(root, file);
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue;
    const match = retiredTerms.exec(buffer.toString("utf8"));
    if (match) fail(`${file} contains retired authority text: ${match[0]}`);
  }
}

async function assertMcpTools() {
  const { tools } = await import("../../packages/mcp/src/tools.ts");
  const names = tools.map((tool) => tool.name);
  if (new Set(names).size !== names.length) fail("MCP tool names must be unique");
  for (const name of names) {
    if (["skyagent_start", "skyagent_context_bootstrap", "skyagent_context_watch"].includes(name) || name.includes("llm") || name.includes("memory")) {
      fail(`retired MCP behavior is present: ${name}`);
    }
  }
}

async function validateProduct() {
  const repositoryFiles = files();
  assertManifest();
  assertPackages(repositoryFiles);
  assertPaths(repositoryFiles);
  assertText(repositoryFiles);
  await assertMcpTools();
  return { ok: true, files: repositoryFiles.length };
}

try {
  console.log(JSON.stringify(await validateProduct()));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
