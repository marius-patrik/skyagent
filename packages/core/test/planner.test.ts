import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, test } from "bun:test";
import nbt from "prismarine-nbt";
import { CATACOMBS_XP_THRESHOLDS, GARDEN_XP_THRESHOLDS, HOTM_XP_THRESHOLDS, SKILL_XP_THRESHOLDS, createObjectiveItem, listObjectiveItems, nextUpgradesFromContext, planGoalFromContext } from "../src/index.ts";

let tempHome: string | null = null;

afterEach(() => {
  if (tempHome) {
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  delete process.env.SKYAGENT_HOME;
});

function isolatedSkyAgentHome() {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-planner-test-"));
  process.env.SKYAGENT_HOME = tempHome;
}

function item(slot: number, internalId: string, displayName = internalId, extra: Record<string, any> = {}) {
  const extraValue: Record<string, any> = { id: { type: "string", value: internalId } };
  for (const [key, value] of Object.entries(extra)) {
    extraValue[key] = typeof value === "number" ? { type: "int", value } : { type: "string", value: String(value) };
  }
  return {
    Slot: { type: "byte", value: slot },
    id: { type: "string", value: "minecraft:stone" },
    Count: { type: "byte", value: 1 },
    Damage: { type: "short", value: 0 },
    tag: { type: "compound", value: { display: { type: "compound", value: { Name: { type: "string", value: displayName } } }, ExtraAttributes: { type: "compound", value: extraValue } } },
  };
}

function payload(items: any[]) {
  return gzipSync(nbt.writeUncompressed({
    type: "compound",
    name: "",
    value: { i: { type: "list", value: { type: "compound", value: items } } },
  } as any)).toString("base64");
}

function context(overrides: any = {}) {
  return {
    uuid: "player-uuid",
    profile: { profile_id: "profile-id", cute_name: "Apple" },
    member: {
      player_data: {
        experience: {
          SKILL_COMBAT: SKILL_XP_THRESHOLDS[20],
          SKILL_FARMING: SKILL_XP_THRESHOLDS[18],
        },
      },
      dungeons: {
        dungeon_types: {
          catacombs: {
            experience: CATACOMBS_XP_THRESHOLDS[18],
            tier_completions: { 5: 1 },
          },
        },
        player_classes: {
          mage: { experience: CATACOMBS_XP_THRESHOLDS[16] },
        },
      },
      slayer: { slayer_bosses: { zombie: { xp: 5_000 } } },
      mining_core: { experience: HOTM_XP_THRESHOLDS[4], nodes: {} },
      garden_player_data: { garden_experience: GARDEN_XP_THRESHOLDS[4], crop_milestones: { wheat: 3 } },
      accessory_bag_storage: { highest_magical_power: 90 },
      pets_data: { pets: [{ type: "SHEEP", tier: "EPIC", active: true }] },
      inventory: {
        inv_contents: { data: payload([item(0, "ASPECT_OF_THE_END", "Aspect of the End", { modifier: "warped", hot_potato_count: 10 })]) },
        inv_armor: { data: payload([
          item(0, "WISE_DRAGON_HELMET", "Wise Dragon Helmet", { modifier: "necrotic" }),
          item(1, "WISE_DRAGON_CHESTPLATE", "Wise Dragon Chestplate", { modifier: "necrotic" }),
          item(2, "WISE_DRAGON_LEGGINGS", "Wise Dragon Leggings", { modifier: "necrotic" }),
          item(3, "WISE_DRAGON_BOOTS", "Wise Dragon Boots", { modifier: "necrotic" }),
        ]) },
        bag_contents: { talisman_bag: { data: payload([item(0, "CHEAP_TALISMAN", "Cheap Talisman")]) } },
      },
      ...overrides.member,
    },
    rateLimit: null,
    ...overrides,
  };
}

function networth() {
  return {
    total: 25_000_000,
    confidence: "medium",
    warnings: [],
    providerFreshness: [{ source: "test-price", fetchedAt: "2026-07-01T00:00:00.000Z" }],
  };
}

function accessories(upgrades: any[] = []) {
  return {
    upgrades,
    warnings: [],
    assumptions: ["test accessory assumptions"],
    providerFreshness: [{ source: "test-accessories", fetchedAt: "2026-07-01T00:00:00.000Z" }],
  };
}

const upgrade = {
  internalId: "CHEAP_TALISMAN",
  displayName: "Cheap Talisman",
  family: "CHEAP_TALISMAN",
  rarity: "RARE",
  magicalPowerGain: 8,
  price: 800_000,
  coinPerMagicalPower: 100_000,
  withinBudget: true,
  provider: { source: "test-price" },
  warnings: [],
};

const overBudgetUpgrade = {
  ...upgrade,
  internalId: "EXPENSIVE_TALISMAN",
  displayName: "Expensive Talisman",
  price: 5_000_000,
};

const unknownPriceUpgrade = {
  ...upgrade,
  internalId: "UNKNOWN_PRICE_TALISMAN",
  displayName: "Unknown Price Talisman",
  price: null,
  withinBudget: undefined,
};

describe("planner", () => {
  test("creates deterministic goal plans with blockers and upgrade recommendations", async () => {
    const first = await planGoalFromContext(context(), "f7 dungeons", {
      budget: 1_000_000,
      networthProvider: networth,
      accessoriesProvider: () => accessories([upgrade]),
      memories: [{ id: "m1", tags: ["preference"], text: "prefers dungeons with cheap upgrades first" }],
      config: { username: "Player", selectedProfileId: "profile-id" },
    });
    const second = await planGoalFromContext(context(), "f7 dungeons", {
      budget: 1_000_000,
      networthProvider: networth,
      accessoriesProvider: () => accessories([upgrade]),
      memories: [{ id: "m1", tags: ["preference"], text: "prefers dungeons with cheap upgrades first" }],
      config: { username: "Player", selectedProfileId: "profile-id" },
    });

    expect(first).toEqual(second);
    expect(first.inputs.areas).toEqual(["dungeons"]);
    expect(first.inputs.profileSections.some((section) => section.section === "dungeons")).toBe(true);
    expect(first.inputs.memoryCount).toBe(1);
    expect(first.inputs.usedMemories).toEqual([{ id: "m1", tags: ["preference"], text: "prefers dungeons with cheap upgrades first" }]);
    expect(first.recommendations[0]).toMatchObject({ id: "accessory-CHEAP_TALISMAN", category: "upgrade" });
    expect(first.recommendations.some((entry) => entry.category === "memory_context")).toBe(true);
    expect(first.recommendations.some((entry) => entry.id === "goal-route")).toBe(true);
    expect(first.recommendations.some((entry) => entry.id === "dungeons-catacombs_level")).toBe(true);
    expect(first.recommendations.some((entry) => entry.reason.includes("Readiness blocker catacombs_level"))).toBe(true);
    const readinessRecommendation = first.recommendations.find((entry) => entry.id === "dungeons-catacombs_level");
    expect(readinessRecommendation?.prerequisites[0].followUpRoute).toMatchObject({
      area: "dungeons",
      check: "catacombs_level",
      blocker: "catacombs_level",
      sourceField: "member.dungeons.dungeon_types.catacombs.experience",
      followUpTool: "skyblock_profile_section",
    });
    expect(first.inputs.readiness[0].blockers[0]).toMatchObject({
      area: "dungeons",
      check: "catacombs_level",
      followUpTool: "skyblock_profile_section",
    });
    expect(first.inputs.readiness[0].followUpTools).toContain("skyblock_profile_section");
    expect(first.inputs.readinessFollowUpRoutes[0]).toMatchObject({ area: "dungeons", check: "catacombs_level" });
    expect(first.inputs.readiness[0].readinessContext.gear.armor.itemCount).toBe(4);
    expect(first.inputs.readiness[0].readinessContext.providerFreshness).toEqual([
      { source: "test-price", fetchedAt: "2026-07-01T00:00:00.000Z", providerKind: "networth" },
      { source: "test-accessories", fetchedAt: "2026-07-01T00:00:00.000Z", providerKind: "accessories" },
    ]);
    expect(first.whatToSkip[0]).toMatchObject({ id: "skip-low-impact-detours" });
    expect(first.skipGuidance[0]).toMatchObject({ id: "skip-low-impact-detours" });
    expect(first.immediateActions[0]).toMatchObject({ kind: "task", recommendationId: "accessory-CHEAP_TALISMAN" });
    expect(first.todoCandidates.some((entry) => entry.kind === "task")).toBe(true);
    expect(first.buyListCandidates[0]).toMatchObject({ kind: "buy", itemId: "CHEAP_TALISMAN", targetPrice: 800_000 });
    expect(first.snipeTargets[0]).toMatchObject({ kind: "snipe", itemId: "CHEAP_TALISMAN" });
  });

  test("persists plan candidates as objective work items only when requested", async () => {
    isolatedSkyAgentHome();
    const preview = await planGoalFromContext(context(), "f7 dungeons", {
      budget: 1_000_000,
      networthProvider: networth,
      accessoriesProvider: () => accessories([upgrade]),
      memories: [],
      config: {},
    });

    expect(preview.persistedObjectives).toBeNull();
    expect(listObjectiveItems().items).toEqual([]);

    const persisted = await planGoalFromContext(context(), "f7 dungeons", {
      budget: 1_000_000,
      networthProvider: networth,
      accessoriesProvider: () => accessories([upgrade]),
      memories: [],
      config: {},
      persistObjectives: true,
      maxPersistedTasks: 1,
      maxPersistedBuys: 1,
      maxPersistedSnipes: 1,
    });
    const items = listObjectiveItems().items;

    expect(persisted.persistedObjectives).toMatchObject({ count: 4 });
    expect(items.map((item) => item.itemKind).sort()).toEqual(["buy", "objective", "snipe", "task"]);
    expect(items.find((item) => item.itemKind === "buy")).toMatchObject({
      itemId: "CHEAP_TALISMAN",
      targetPrice: 800_000,
      budget: 1_000_000,
      sourceProvider: "test-price",
    });
  });

  test("updates an existing objective root when requested", async () => {
    isolatedSkyAgentHome();
    const root = createObjectiveItem({ itemKind: "objective", title: "Old F7", status: "open" });

    const result = await planGoalFromContext(context(), "f7 dungeons", {
      budget: 1_000_000,
      networthProvider: networth,
      accessoriesProvider: () => accessories([upgrade]),
      memories: [],
      config: {},
      persistObjectives: true,
      objectiveId: root.id,
      objectiveTitle: "Updated F7",
      maxPersistedTasks: 0,
      maxPersistedBuys: 0,
      maxPersistedSources: 0,
      maxPersistedSnipes: 0,
    });

    expect(result.persistedObjectives.root).toMatchObject({ id: root.id, title: "Updated F7", status: "active" });
    expect(listObjectiveItems().items).toContainEqual(expect.objectContaining({ id: root.id, title: "Updated F7" }));
  });

  test("next-upgrades enforces budget validation and ranks upgrade recommendations", async () => {
    await expect(nextUpgradesFromContext(context(), -1, { accessoriesProvider: () => accessories([]) })).rejects.toThrow("budget must be");
    const result = await nextUpgradesFromContext(context(), 1_000_000, {
      accessoriesProvider: () => accessories([overBudgetUpgrade, unknownPriceUpgrade, upgrade]),
    });

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      id: "accessory-CHEAP_TALISMAN",
      costEstimate: { coins: 800_000, withinBudget: true },
    });
  });

  test("surfaces missing data fallback in plan warnings", async () => {
    const result = await planGoalFromContext(context({ member: {} }), "mining", {
      networthProvider: () => ({ total: null, confidence: "none", warnings: [{ code: "networth_missing" }], providerFreshness: [] }),
      accessoriesProvider: () => accessories([]),
      memories: [],
      config: {},
    });

    expect(result.inputs.readiness[0]).toMatchObject({ area: "mining", rating: "unknown" });
    expect(result.warnings.some((entry) => entry.code === "missing_api_data")).toBe(true);
    expect(result.warnings.some((entry) => entry.code === "networth_missing")).toBe(true);
  });

  test("carries stale context and price freshness into plan candidates", async () => {
    const result = await planGoalFromContext(context(), "accessories", {
      budget: 1_000_000,
      contextCapsule: {
        generatedAt: "2026-07-01T00:00:00.000Z",
        cache: { status: "hit", stale: true, sourceProvider: "profile-snapshot-cache" },
        objectives: { counts: { buy: 1 } },
        warnings: [{ code: "snapshot_only_context", message: "Stale context" }],
      },
      networthProvider: () => ({ total: 10, confidence: "low", providerFreshness: [], warnings: [] }),
      accessoriesProvider: () => accessories([{
        ...upgrade,
        provider: { source: "stale-price", cacheStatus: "stale", fetchedAt: "2026-07-01T00:00:00.000Z" },
        warnings: [{ code: "stale_cache", message: "Using stale price" }],
      }]),
      memories: [],
      config: {},
    });

    expect(result.inputs.contextCapsule).toMatchObject({ cache: { stale: true }, objectiveCounts: { buy: 1 } });
    expect(result.sourceFreshness.profile).toMatchObject({ status: "hit", stale: true });
    expect(result.buyListCandidates[0].freshness).toMatchObject({ source: "stale-price", warnings: [{ code: "stale_cache", message: "Using stale price", sourcePath: null }] });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "snapshot_only_context" }));
  });

  test("consumes partial bounded valuation without dropping recommendations", async () => {
    const result = await planGoalFromContext(context(), "f7", {
      budget: 1_000_000,
      networthProvider: () => ({
        status: "partial",
        valuation: { status: "partial", pricedAttemptCount: 1, maxItems: 1 },
        total: 25_000_000,
        confidence: "low",
        warnings: [{ code: "valuation_item_limit_reached" }],
        providerFreshness: [],
      }),
      accessoriesProvider: () => ({
        ...accessories([upgrade]),
        status: "partial",
        valuation: { status: "partial", priceLookupCount: 1, maxPriceLookups: 1 },
        warnings: [{ code: "accessory_price_limit_reached" }],
      }),
      memories: [],
      config: {},
    });

    expect(result.inputs.networth).toMatchObject({ status: "partial", valuation: { pricedAttemptCount: 1 } });
    expect(result.recommendations).toContainEqual(expect.objectContaining({ id: "accessory-CHEAP_TALISMAN" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "valuation_item_limit_reached" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "accessory_price_limit_reached" }));
  });
});
