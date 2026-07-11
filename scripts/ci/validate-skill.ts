import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const skillsRoot = path.join(process.cwd(), "skills");
const quickValidatePath = path.join(process.cwd(), "scripts", "ci", "quick_validate.py");
const forbiddenNames = [["co", "dex"], ["clau", "de"], ["ki", "mi"], ["a", "gy"], ["gem", "ini"], ["open", "ai"], ["lite", "llm"]].map((parts) => parts.join(""));
const forbidden = new RegExp(`\\b(?:${forbiddenNames.join("|")})\\b|skyagent_(?:start|context_bootstrap|context_watch)|agent\\.session_start|SKYAGENT_(?:HOME|LLM|LITELLM)|\\.${["co", "dex"].join("")}-plugin|\\.mcp\\.json`, "i");

function fail(message: string): never {
  throw new Error(`Skill validation failed: ${message}`);
}

export function discoverSkillFolders(root = skillsRoot) {
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function runQuickValidate(folder: string) {
  const skillPath = path.join(skillsRoot, folder);
  const attempts = [["python3", quickValidatePath, skillPath], ["python", quickValidatePath, skillPath]];
  const errors: string[] = [];
  for (const [command, ...args] of attempts) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (!result.error && result.status === 0) return;
    errors.push(result.error?.message ?? result.stderr ?? result.stdout);
  }
  fail(`${folder}: quick validator failed\n${errors.join("\n")}`);
}

function validateSkill(folder: string) {
  const root = path.join(skillsRoot, folder);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "agents" || entry.name === `.${["co", "dex"].join("")}` || entry.name === `.${["clau", "de"].join("")}`) {
      fail(`${folder}: provider-owned metadata is forbidden`);
    }
  }
  runQuickValidate(folder);
  const skillFile = path.join(root, "SKILL.md");
  const text = fs.readFileSync(skillFile, "utf8");
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== folder) fail(`${folder}: frontmatter name must match folder name`);
  if (!description || description.length < 40) fail(`${folder}: description is too short`);
  const match = forbidden.exec(text);
  if (match) fail(`${folder}: provider or retired runtime authority is forbidden (${match[0]})`);
}

export function validateSkills() {
  const folders = discoverSkillFolders();
  if (!folders.length) fail("no skills found");
  for (const folder of folders) validateSkill(folder);
  const broad = fs.readFileSync(path.join(skillsRoot, "hypixel-skyblock", "SKILL.md"), "utf8");
  for (const folder of folders.filter((folder) => folder !== "hypixel-skyblock")) {
    if (!broad.includes(`$${folder}`)) fail(`hypixel-skyblock must route to $${folder}`);
  }
  return { ok: true, count: folders.length };
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(validateSkills()));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
