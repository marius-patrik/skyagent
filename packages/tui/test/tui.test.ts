import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { renderToString } from "ink";
import { SURFACE_CONTRACTS } from "@skyagent/core/surface-contracts";
import {
  clearProfileBoundScreenData,
  compactJson,
  createTuiClient,
  loadTuiSurfaceScreen,
  SkyAgentTuiApp,
  setupGuidance,
  TUI_MENU_IDS,
  TUI_SURFACE_SCREEN_IDS,
  tuiAccessoriesSummary,
  tuiDataStateLabel,
  tuiEventsSummary,
  tuiGearSummary,
  tuiInventorySummary,
  tuiListCursorAction,
  tuiMenuNavigationAction,
  tuiNetworthSummary,
  tuiObjectivesSummary,
  tuiProgressionSummary,
  tuiProvidersSummary,
  TuiScreenPreview,
  tuiScreenIndex,
  tuiSetupCommand,
  tuiSnapshot,
  tuiStatus,
} from "../src/index.tsx";

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-tui-test-"));
  process.env.AGENTS_HOME = tempHome;
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  delete process.env.AGENTS_HOME;
});

test("tui status and snapshot expose the provider-neutral application surfaces", () => {
  const status = tuiStatus();
  const snapshot = tuiSnapshot();

  expect(status).toMatchObject({ surface: "tui", renderer: "ink", ready: true, stateOwner: "agent-os" });
  expect(status.config.dataDir).toBe(path.join(tempHome, "runtime", "apps", "skyagent"));
  expect(snapshot.screens).not.toContain("agent");
  expect(snapshot.screens).toContain("profiles");
  expect(snapshot.screens).toContain("inventory");
  expect(snapshot.screens).toContain("objectives");
  expect(snapshot.secrets).toContain("HYPIXEL_API_KEY is read only from Agent OS");
  expect(snapshot.contractCoverage.map((entry) => entry.id)).toEqual(SURFACE_CONTRACTS.map((entry) => entry.id));
  expect(snapshot.trackedContractGaps).toEqual([]);
  for (const contract of snapshot.contractCoverage) {
    for (const screen of contract.screens) expect(snapshot.screens).toContain(screen as typeof snapshot.screens[number]);
  }
});

test("tui redacts secret-shaped fields before rendering debug output", () => {
  const rendered = compactJson({ apiKey: "real-key", token: "real-token", nested: { safe: "visible", password: "secret" } });
  expect(rendered).toContain("[redacted]");
  expect(rendered).toContain("visible");
  expect(rendered).not.toContain("real-key");
  expect(rendered).not.toContain("real-token");
});

test("tui setup accepts only non-secret application config", () => {
  expect(tuiSetupCommand("username Pastik_")).toEqual({ ok: true, field: "username", config: { username: "Pastik_" } });
  expect(tuiSetupCommand("profile profile-id")).toEqual({ ok: true, field: "profile", config: { selectedProfileId: "profile-id" } });
  expect(tuiSetupCommand("api-key secret").ok).toBe(false);
  expect(setupGuidance({ username: null, uuid: null, apiKeyConfigured: false, selectedProfileId: null }, true)).toContain("Agent OS HYPIXEL_API_KEY secret");
});

test("navigation reaches every TUI surface and list cursors wrap", () => {
  let index = tuiScreenIndex("status");
  const visited = [TUI_MENU_IDS[index]];
  for (let step = 1; step < TUI_MENU_IDS.length; step += 1) {
    index = tuiMenuNavigationAction("j", {}, index);
    visited.push(TUI_MENU_IDS[index]);
  }
  expect(visited).toEqual(TUI_MENU_IDS);
  for (const screen of TUI_SURFACE_SCREEN_IDS) expect(visited).toContain(screen);
  expect(tuiMenuNavigationAction("k", {}, 0)).toBe(TUI_MENU_IDS.length - 1);
  expect(tuiListCursorAction("profiles", "h", {}, 0, 3)).toBe(2);
  expect(tuiListCursorAction("inventory", "l", {}, 0, 3)).toBe(0);
});

test("profile-bound data is cleared without dropping global application data", () => {
  const cleared = clearProfileBoundScreenData({
    inventory: { old: true },
    gear: { old: true },
    accessories: { old: true },
    networth: { old: true },
    progression: { old: true },
    providers: { keep: true },
    events: { keep: true },
    objectives: { keep: true },
  });
  expect(cleared.inventory).toBeUndefined();
  expect(cleared.progression).toBeUndefined();
  expect(cleared.providers).toEqual({ keep: true });
  expect(cleared.objectives).toEqual({ keep: true });
});

test("surface loader calls direct domain clients for every major screen", async () => {
  const calls: string[] = [];
  const client = {
    inventory: async () => (calls.push("inventory"), { sections: { armor: {} } }),
    normalizedItems: async () => (calls.push("normalizedItems"), { items: [] }),
    accessories: async () => (calls.push("accessories"), { magicalPower: 800 }),
    missingAccessories: async () => (calls.push("missingAccessories"), { missing: [] }),
    networth: async () => (calls.push("networth"), { total: 1 }),
    progression: async () => (calls.push("progression"), { sections: [] }),
    weight: async () => (calls.push("weight"), { estimate: 1 }),
    readiness: async () => (calls.push("readiness"), { status: "ready" }),
    providerStatus: async () => (calls.push("providerStatus"), { providers: [{ id: "hypixel-api", status: "available" }], resources: [] }),
    serverStatus: async () => (calls.push("serverStatus"), { online: true }),
    contextEvents: async () => (calls.push("contextEvents"), { latestSequence: 1, events: [] }),
    objectives: async () => (calls.push("objectives"), []),
  };
  const config = { username: "patrik", uuid: "uuid", apiKeyConfigured: true, selectedProfileId: "profile-1" };

  for (const screen of TUI_SURFACE_SCREEN_IDS) {
    const result = await loadTuiSurfaceScreen(client, config, screen);
    expect(result.error).toBeNull();
    expect(result.data).not.toBeNull();
  }

  expect(new Set(calls)).toEqual(new Set(["inventory", "normalizedItems", "accessories", "missingAccessories", "networth", "progression", "weight", "readiness", "providerStatus", "serverStatus", "contextEvents", "objectives"]));
});

test("profile-bound loader fails closed before domain calls when setup is incomplete", async () => {
  const calls: string[] = [];
  const result = await loadTuiSurfaceScreen({ inventory: async () => calls.push("inventory") }, { username: null, uuid: null, apiKeyConfigured: false, selectedProfileId: null }, "inventory");
  expect(result.data).toBeNull();
  expect(result.error).toContain("username or UUID");
  expect(calls).toEqual([]);
});

test("summary helpers unwrap direct domain payloads", () => {
  expect(tuiInventorySummary({ inventory: { sections: { armor: {} } }, normalized: { items: [{ id: "A" }] } })).toMatchObject({ names: ["armor"] });
  expect(tuiGearSummary({ inventory: { armor: [{ id: "A" }], equipment: [{ id: "B" }], wardrobe: [], pets: [] }, normalized: { items: [] } }).current).toHaveLength(2);
  expect(tuiAccessoriesSummary({ accessories: { magicalPower: 800, accessories: [{ id: "A" }] }, missing: { missing: [{ id: "B" }] } })).toMatchObject({ magicalPower: 800 });
  expect(tuiNetworthSummary({ total: 123, currency: { purse: 1, bank: 2 } })).toMatchObject({ total: 123, purse: 1, bank: 2 });
  expect(tuiProgressionSummary({ progression: { sections: { skills: {} } }, readiness: { status: "ready" }, weight: { estimate: 1 } }).readiness.status).toBe("ready");
  const providers = tuiProvidersSummary({ providerStatus: { providers: [{ id: "pricing", status: "available", cache: { staleCount: 1 } }], resources: [] } });
  expect(tuiDataStateLabel(providers)).toBe("stale");
  expect(tuiEventsSummary({ latestSequence: 7, events: [{ type: "profile.refresh" }] }).latestSequence).toBe(7);
  expect(tuiObjectivesSummary([{ id: "obj-1" }]).objectives).toHaveLength(1);
});

test("TUI renders empty and loaded Ink states", () => {
  expect(renderToString(React.createElement(TuiScreenPreview, { screen: "inventory" }))).toContain("No inventory data loaded");
  const loaded = renderToString(React.createElement(TuiScreenPreview, {
    screen: "inventory",
    state: { screenData: { inventory: { inventory: { sections: { armor: {} } }, normalized: { items: [{ id: "A" }] } } } },
  }));
  expect(loaded).toContain("Sections: armor");
  expect(loaded).toContain("Normalized items: 1");
  expect(SkyAgentTuiApp).toBeTypeOf("function");
  expect(createTuiClient().providerStatus).toBeTypeOf("function");
});

test("canonical CLI entry delegates TUI smoke mode", async () => {
  const proc = Bun.spawn(["bun", "./packages/cli/src/bin.ts", "tui", "--smoke"], {
    cwd: path.resolve(import.meta.dir, "../../.."),
    env: { ...process.env, AGENTS_HOME: tempHome },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).json();
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(stderr).toBe("");
  expect(stdout.screens).toContain("profiles");
  expect(stdout.screens).not.toContain("agent");
});
