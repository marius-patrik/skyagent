import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { runSetup, setupStatus } from "../src/setup.ts";
import { hypixelApiKeyPath, publicConfig, readConfig } from "../src/store.ts";

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-setup-test-"));
  process.env.AGENTS_HOME = tempHome;
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  delete process.env.AGENTS_HOME;
});

function writeSecret(value = "secret-key") {
  fs.mkdirSync(path.dirname(hypixelApiKeyPath()), { recursive: true, mode: 0o700 });
  fs.writeFileSync(hypixelApiKeyPath(), `${value}\n`, { mode: 0o600 });
}

function setupDeps() {
  return {
    resolveMinecraftUsername: async (username: string) => ({
      username,
      uuid: "3206bd83fa494a5e9a1cd165a2728597",
      dashedUuid: "3206bd83-fa49-4a5e-9a1c-d165a2728597",
    }),
    skyblockProfiles: async () => ({
      ok: true,
      status: 200,
      url: "https://api.hypixel.net/v2/skyblock/profiles",
      body: {
        profiles: [{
          profile_id: "profile-1",
          cute_name: "Apple",
          selected: true,
          members: { "3206bd83fa494a5e9a1cd165a2728597": { currencies: { coin_purse: 12 } } },
        }],
      },
      rateLimit: { limit: null, remaining: null, reset: null },
    }),
    providerCheck: async () => ({ ok: true }),
  };
}

test("setup status reports canonical Agent OS paths without secret material", () => {
  writeSecret();
  const status = setupStatus();
  expect(status.version).toBe("2.0.0");
  expect(status.dataDir).toBe(path.join(tempHome, "runtime", "apps", "skyagent"));
  expect(status.config).toEqual(publicConfig());
  expect(status.config.apiKeySource).toBe("agent-os-secret");
  expect(JSON.stringify(status)).not.toContain("secret-key");
});

test("setup reports missing username without live requests", async () => {
  const result = await runSetup({}, setupDeps());
  expect(result.complete).toBe(false);
  expect(result.required).toEqual(["username"]);
  expect(readConfig()).toEqual({});
});

test("setup stores player identity and points missing auth to Agent OS", async () => {
  const result = await runSetup({ username: "Pastik_" }, setupDeps());
  expect(result.complete).toBe(false);
  expect(result.required).toEqual(["apiKey"]);
  expect(result.steps.find((entry) => entry.id === "auth")?.detail).toContain("agents secrets set HYPIXEL_API_KEY");
  expect(readConfig()).toMatchObject({ username: "Pastik_", uuid: "3206bd83fa494a5e9a1cd165a2728597" });
});

test("setup selects a profile when the canonical secret exists", async () => {
  writeSecret();
  const result = await runSetup({ username: "Pastik_", profile: "Apple" }, setupDeps());
  expect(result.complete).toBe(true);
  expect(result.selectedProfile).toMatchObject({ profileId: "profile-1", cuteName: "Apple" });
  expect(readConfig()).toEqual({
    username: "Pastik_",
    uuid: "3206bd83fa494a5e9a1cd165a2728597",
    selectedProfileId: "profile-1",
  });
  expect(JSON.stringify(result)).not.toContain("secret-key");
});

test("no-write setup validates without creating application config", async () => {
  writeSecret();
  const result = await runSetup({ username: "Pastik_", profile: "Apple", write: false }, setupDeps());
  expect(result.complete).toBe(true);
  expect(readConfig()).toEqual({});
});
