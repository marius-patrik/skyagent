import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { discoverSkillFolders } from "./validate-skill.ts";

let tempRoot: string | null = null;

afterEach(() => {
  if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

test("discovers only skill directories in sorted order", () => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-skill-discovery-"));
  fs.mkdirSync(path.join(tempRoot, "skyagent-zeta"));
  fs.mkdirSync(path.join(tempRoot, "hypixel-skyblock"));
  fs.writeFileSync(path.join(tempRoot, "README.md"), "not a skill\n");
  expect(discoverSkillFolders(tempRoot)).toEqual(["hypixel-skyblock", "skyagent-zeta"]);
});
