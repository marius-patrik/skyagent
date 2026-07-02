import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { runSetup, setupStatus } from "../src/setup.ts";
import { publicConfig, readConfig } from "../src/store.ts";

let tempHome: string | null = null;

afterEach(() => {
  if (tempHome) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  delete process.env.SKYAGENT_HOME;
  delete process.env.HYPIXEL_API_KEY;
});

function isolatedSkyAgentHome() {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-setup-test-"));
  process.env.SKYAGENT_HOME = tempHome;
}

function setupDeps(providerChecks: Array<{ apiKey?: string }> = []) {
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
          members: {
            "3206bd83fa494a5e9a1cd165a2728597": {
              currencies: { coin_purse: 12 },
            },
          },
        }],
      },
      rateLimit: { limit: null, remaining: null, reset: null },
    }),
    providerCheck: async (context?: { apiKey?: string }) => {
      providerChecks.push(context ?? {});
      return { ok: true };
    },
  };
}

test("setup status redacts secrets and reports install metadata", () => {
  isolatedSkyAgentHome();

  const status = setupStatus();

  expect(status.version).toBe("2.0.0");
  expect(status.dataDir).toBe(tempHome);
  expect(status.config).toEqual(publicConfig());
});

test("setup reports missing username without live requests", async () => {
  isolatedSkyAgentHome();

  const result = await runSetup({}, setupDeps());

  expect(result.complete).toBe(false);
  expect(result.required).toEqual(["username"]);
  expect(result.steps[0]).toMatchObject({ id: "player", status: "missing" });
  expect(readConfig()).toEqual({});
});

test("setup stores player identity and waits for API key before profile fetch", async () => {
  isolatedSkyAgentHome();

  const result = await runSetup({ username: "Pastik_" }, setupDeps());

  expect(result.complete).toBe(false);
  expect(result.required).toEqual(["apiKey"]);
  expect(readConfig()).toMatchObject({
    username: "Pastik_",
    uuid: "3206bd83fa494a5e9a1cd165a2728597",
  });
  expect(JSON.stringify(result)).not.toContain("secret-key");
});

test("setup stores selected profile and never returns API key material", async () => {
  isolatedSkyAgentHome();

  const result = await runSetup({ username: "Pastik_", apiKey: "secret-key", profile: "Apple" }, setupDeps());

  expect(result.complete).toBe(true);
  expect(result.selectedProfile).toMatchObject({ profileId: "profile-1", cuteName: "Apple" });
  expect(readConfig()).toMatchObject({
    username: "Pastik_",
    uuid: "3206bd83fa494a5e9a1cd165a2728597",
    apiKey: "secret-key",
    selectedProfileId: "profile-1",
  });
  expect(result.status.config.apiKeyConfigured).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret-key");
});

test("setup can validate with a transient API key without storing it", async () => {
  isolatedSkyAgentHome();
  const providerChecks: Array<{ apiKey?: string }> = [];

  const result = await runSetup({ username: "Pastik_", apiKey: "secret-key", profile: "Apple", write: false }, setupDeps(providerChecks));

  expect(result.complete).toBe(true);
  expect(providerChecks).toEqual([{ apiKey: "secret-key" }]);
  expect(result.status.config.apiKeyConfigured).toBe(false);
  expect(readConfig()).toEqual({});
  expect(JSON.stringify(result)).not.toContain("secret-key");
});

test("setup rejects an explicit profile selector that does not match", async () => {
  isolatedSkyAgentHome();

  const result = await runSetup({ username: "Pastik_", apiKey: "secret-key", profile: "Typo" }, setupDeps());

  expect(result.complete).toBe(false);
  expect(result.required).toEqual(["profile"]);
  expect(readConfig()).not.toHaveProperty("selectedProfileId");
});
