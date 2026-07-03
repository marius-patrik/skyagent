import { gzipSync } from "node:zlib";
import { describe, expect, test } from "bun:test";
import nbt from "prismarine-nbt";
import { CATACOMBS_XP_THRESHOLDS, GARDEN_XP_THRESHOLDS, HOTM_XP_THRESHOLDS, SKILL_XP_THRESHOLDS, readinessFromContext, readinessGearContextFromMember, readinessProviderFreshnessForContext, weightFromContext } from "../src/index.ts";

function item(slot: number, internalId: string, displayName = internalId, extra: Record<string, any> = {}) {
  const extraValue: Record<string, any> = {
    id: { type: "string", value: internalId },
  };
  for (const [key, value] of Object.entries(extra)) {
    extraValue[key] = typeof value === "number"
      ? { type: "int", value }
      : typeof value === "boolean"
        ? { type: "byte", value: value ? 1 : 0 }
        : { type: "string", value: String(value) };
  }
  return {
    Slot: { type: "byte", value: slot },
    id: { type: "string", value: "minecraft:stone" },
    Count: { type: "byte", value: 1 },
    Damage: { type: "short", value: 0 },
    tag: {
      type: "compound",
      value: {
        display: { type: "compound", value: { Name: { type: "string", value: displayName } } },
        ExtraAttributes: { type: "compound", value: extraValue },
      },
    },
  };
}

function payload(items: any[]) {
  return gzipSync(nbt.writeUncompressed({
    type: "compound",
    name: "",
    value: { i: { type: "list", value: { type: "compound", value: items } } },
  } as any)).toString("base64");
}

function fixtureContext() {
  return {
    uuid: "player-uuid",
    profile: {
      profile_id: "profile-id",
      cute_name: "Apple",
    },
    member: {
      player_data: {
        experience: {
          SKILL_FARMING: SKILL_XP_THRESHOLDS[30],
          SKILL_MINING: SKILL_XP_THRESHOLDS[35],
          SKILL_COMBAT: SKILL_XP_THRESHOLDS[25],
        },
      },
      dungeons: {
        dungeon_types: {
          catacombs: {
            experience: CATACOMBS_XP_THRESHOLDS[24],
            tier_completions: { 7: 1 },
          },
        },
        player_classes: {
          mage: { experience: CATACOMBS_XP_THRESHOLDS[20] },
        },
      },
      slayer: {
        slayer_bosses: {
          zombie: { xp: 100_000 },
          spider: { xp: 20_000 },
          wolf: { xp: 5_000 },
        },
      },
      mining_core: {
        experience: HOTM_XP_THRESHOLDS[6],
        powder_mithril: 1_000_000,
        powder_spent_mithril: 1_000_000,
        powder_gemstone: 1_000_000,
        powder_spent_gemstone: 1_000_000,
        nodes: { efficient_miner: 40 },
      },
      garden_player_data: {
        garden_experience: GARDEN_XP_THRESHOLDS[9],
        crop_milestones: {
          wheat: 10,
          carrot: 8,
          potato: 7,
          pumpkin: 6,
          melon: 5,
        },
      },
      nether_island_player_data: {
        kuudra_completed_tiers: { basic: 1 },
        dojo: { belt: "GREEN" },
      },
      accessory_bag_storage: {
        highest_magical_power: 420,
      },
      pets_data: {
        pets: [{ type: "GOLDEN_DRAGON", tier: "LEGENDARY", active: true, heldItem: "PET_ITEM_TIER_BOOST" }],
      },
      inventory: {
        inv_contents: { data: payload([item(0, "HYPERION", "Hyperion", { modifier: "heroic", upgrade_level: 5, hot_potato_count: 15 })]) },
        inv_armor: { data: payload([
          item(0, "NECRON_HELMET", "Necron Helmet", { modifier: "ancient", upgrade_level: 5 }),
          item(1, "NECRON_CHESTPLATE", "Necron Chestplate", { modifier: "ancient", upgrade_level: 5 }),
          item(2, "NECRON_LEGGINGS", "Necron Leggings", { modifier: "ancient", upgrade_level: 5 }),
          item(3, "NECRON_BOOTS", "Necron Boots", { modifier: "ancient", upgrade_level: 5 }),
        ]) },
        equipment_contents: { data: payload([
          item(0, "MOLTEN_NECKLACE", "Molten Necklace", { attributes: "dominance" }),
          item(1, "MOLTEN_BELT", "Molten Belt", { attributes: "dominance" }),
        ]) },
        bag_contents: { talisman_bag: { data: payload([item(0, "WITHER_RELIC", "Wither Relic")]) } },
      },
    },
    rateLimit: { remaining: 10 },
  };
}

describe("weight", () => {
  test("returns explicit unsupported exact formula status plus a labeled estimate", () => {
    const result = weightFromContext(fixtureContext());

    expect(result.status).toBe("estimate");
    expect(result.styles.senither).toMatchObject({ status: "unsupported" });
    expect(result.styles.lily).toMatchObject({ status: "unsupported" });
    expect(result.styles.skyagentEstimate.score).toBeGreaterThan(0);
    expect(result.styles.skyagentEstimate.components.map((component) => component.name)).toEqual(["skills", "dungeons", "slayer", "mining", "garden"]);
    expect(result.warnings.some((entry) => entry.code === "unsupported_formula")).toBe(true);
    expect(result.formulas).toContain("skyagent-weight-estimate-v1");
  });

  test("surfaces missing data instead of inventing exact weight", () => {
    const result = weightFromContext({
      uuid: "player-uuid",
      profile: { profile_id: "profile-id" },
      member: {},
      rateLimit: null,
    });

    expect(result.styles.senither.status).toBe("unsupported");
    expect(result.warnings.filter((entry) => entry.code === "missing_api_data").length).toBeGreaterThan(0);
  });
});

describe("readiness", () => {
  test("scores implemented readiness areas from deterministic fixture data", async () => {
    const context = fixtureContext();
    const gearContext = await readinessGearContextFromMember(context.member);

    expect(gearContext.sections.pets).toMatchObject({
      available: true,
      itemCount: 1,
      active: { internalId: "GOLDEN_DRAGON", tier: "LEGENDARY", sourcePath: "pets_data.pets" },
    });
    expect(readinessFromContext(context, "dungeons:f7", { gearContext })).toMatchObject({ area: "dungeons", rating: "ready", status: "estimate", target: { label: "Floor 7" } });
    expect(readinessFromContext(context, "slayer:zombie:t4", { gearContext })).toMatchObject({ area: "slayer", rating: "ready", status: "estimate", target: { boss: "zombie", tier: 4 } });
    expect(readinessFromContext(context, "eman:t4", { gearContext }).target).toMatchObject({ boss: "enderman", tier: 4 });
    expect(readinessFromContext(context, "kuudra:basic", { gearContext })).toMatchObject({ area: "kuudra", rating: "ready", status: "estimate" });
    expect(readinessFromContext(context, "slayer:zombie:t5", { gearContext }).target).toMatchObject({ boss: "zombie", tier: 5 });
    expect(readinessFromContext(context, "kuudra:t5", { gearContext }).target).toMatchObject({ tier: 5, label: "Kuudra tier 5" });
    expect(readinessFromContext(context, "kuudra:burning", { gearContext }).target).toMatchObject({ tier: 3, label: "burning Kuudra" });
    expect(readinessFromContext(context, "garden")).toMatchObject({ area: "garden", rating: "ready", status: "estimate" });
    expect(readinessFromContext(context, "mining")).toMatchObject({ area: "mining", rating: "ready", status: "estimate" });
    expect(readinessFromContext(context, "f7", { gearContext }).target).toMatchObject({ label: "Floor 7", catacombsLevel: 24 });
    expect(readinessFromContext(context, "m7", { gearContext }).target).toMatchObject({ label: "Master Mode 7", catacombsLevel: 36, classLevel: 30 });
  });

  test("warns when readiness provider freshness is missing or stale", async () => {
    const context = fixtureContext();
    const gearContext = await readinessGearContextFromMember(context.member);

    expect(readinessFromContext(context, "slayer:zombie:t4", { gearContext }).warnings).toContainEqual(expect.objectContaining({
      code: "missing_provider_freshness",
      sourcePath: "readiness.providerFreshness",
    }));
    expect(readinessFromContext(context, "slayer:zombie:t4", {
      gearContext,
      providerFreshness: [{ source: "test-price", status: "stale" }],
    }).warnings).toContainEqual(expect.objectContaining({
      code: "stale_provider_freshness",
      sourcePath: "readiness.providerFreshness",
    }));
  });

  test("builds bounded provider freshness for direct readiness calls", async () => {
    const providerFreshness = await readinessProviderFreshnessForContext(fixtureContext(), 5_000_000, {
      networthProvider: () => ({ providerFreshness: [{ source: "test-networth", status: "fresh" }] }),
      accessoriesProvider: (_member, budget) => ({ providerFreshness: [{ source: "test-accessories", status: "fresh", budget }] }),
    });

    expect(providerFreshness).toEqual([
      { source: "test-networth", status: "fresh", providerKind: "networth" },
      { source: "test-accessories", status: "fresh", budget: 5_000_000, providerKind: "accessories" },
    ]);
  });

  test("does not turn unsupported dungeon suffixes into F7 blockers", async () => {
    const context = fixtureContext();
    const gearContext = await readinessGearContextFromMember(context.member);
    const result = readinessFromContext(context, "dungeons:not-a-floor", { gearContext });

    expect(result.rating).toBe("unknown");
    expect(result.checks).toEqual([]);
    expect(result.target).toMatchObject({ unsupported: true });
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "unsupported_readiness_target", sourcePath: "readiness.target" }));
  });

  test("does not turn unsupported slayer or kuudra suffixes into default blockers", async () => {
    const context = fixtureContext();
    const gearContext = await readinessGearContextFromMember(context.member);
    const slayer = readinessFromContext(context, "slayer:not-a-boss", { gearContext });
    const kuudra = readinessFromContext(context, "kuudra:not-a-tier", { gearContext });

    expect(slayer).toMatchObject({ area: "slayer", rating: "unknown", checks: [], target: { unsupported: true } });
    expect(kuudra).toMatchObject({ area: "kuudra", rating: "unknown", checks: [], target: { unsupported: true } });
    expect(slayer.warnings).toContainEqual(expect.objectContaining({ code: "unsupported_readiness_target", sourcePath: "readiness.target" }));
    expect(kuudra.warnings).toContainEqual(expect.objectContaining({ code: "unsupported_readiness_target", sourcePath: "readiness.target" }));
  });

  test("uses canonical slayer aliases for direct boss target level checks", async () => {
    const context = fixtureContext();
    (context.member.slayer.slayer_bosses as Record<string, any>).enderman = { xp: 100_000 };
    const gearContext = await readinessGearContextFromMember(context.member);
    const result = readinessFromContext(context, "eman:t4", { gearContext, providerFreshness: [{ source: "test", status: "fresh" }] });
    const targetLevel = result.checks.find((check) => check.name === "target_slayer_level");

    expect(result.target).toMatchObject({ boss: "enderman", tier: 4 });
    expect(targetLevel).toMatchObject({ passed: true, target: 6 });
    expect(targetLevel.actual).toBeGreaterThan(0);
  });

  test("does not require active pets for dungeon targets without pet assumptions", async () => {
    const context = fixtureContext();
    context.member.pets_data = { pets: [] };
    const gearContext = await readinessGearContextFromMember(context.member);
    const result = readinessFromContext(context, "dungeons:f1", { gearContext });

    expect(result.checks.some((check) => check.name === "active_pet_present")).toBe(false);
  });

  test("supports Crimson Isle aliases for Kuudra readiness", () => {
    expect(readinessFromContext(fixtureContext(), "crimson_isle").area).toBe("kuudra");
  });

  test("counts weapon-like items from decoded storage sections", async () => {
    const context = fixtureContext();
    context.member.inventory.inv_contents = { data: payload([]) };
    (context.member.inventory as any).personal_vault_contents = { data: payload([item(0, "HYPERION", "Hyperion", { modifier: "heroic", upgrade_level: 5 })]) };
    const gearContext = await readinessGearContextFromMember(context.member);
    const result = readinessFromContext(context, "slayer:zombie:t4", { gearContext });

    expect(gearContext.sections.weapons.items[0]).toMatchObject({ internalId: "HYPERION", sourcePath: "inventory.personal_vault_contents" });
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "gear_weapon_present", passed: true, blocker: "weapon" }));
  });

  test("counts hot potato books and stars as item modifier evidence", async () => {
    const context = fixtureContext();
    context.member.inventory.inv_contents = { data: payload([item(0, "HYPERION", "Hyperion", { hot_potato_count: 10, upgrade_level: 5 })]) };
    context.member.inventory.inv_armor = { data: payload([item(0, "NECRON_HELMET", "Necron Helmet", { upgrade_level: 5 })]) };
    const gearContext = await readinessGearContextFromMember(context.member);

    expect(gearContext.sections.modifiers.itemCount).toBeGreaterThanOrEqual(2);
    expect(gearContext.sections.modifiers.items[0]).toMatchObject({ stars: 5 });
  });

  test("includes gear, pet, accessories, modifiers, and missing field warnings", async () => {
    const context = fixtureContext();
    context.member.inventory.inv_armor = { data: payload([item(0, "UNSTABLE_DRAGON_HELMET", "Unstable Helmet")]) };
    context.member.inventory.inv_contents = { data: payload([]) };
    context.member.pets_data = { pets: [] };
    delete context.member.accessory_bag_storage;
    const gearContext = await readinessGearContextFromMember(context.member);

    const result = readinessFromContext(context, "slayer:eman:t4", { gearContext });

    expect(result.rating).toBe("partial");
    expect(result.readinessContext.gear.armor.itemCount).toBe(1);
    expect(result.readinessContext.gear.weapons).toMatchObject({ available: true, itemCount: 0 });
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "gear_weapon_present", passed: false, blocker: "weapon" }));
    expect(result.checks).toContainEqual(expect.objectContaining({ name: "magical_power", passed: false, blocker: "accessories" }));
    expect(result.warnings).not.toContainEqual(expect.objectContaining({ code: "missing_gear_section", sourcePath: "inventory.inv_contents" }));
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "missing_profile_field", sourcePath: "member.accessory_bag_storage.highest_magical_power" }));
    expect(result.assumptions).toContain("Exact damage-per-second math and volatile meta thresholds are unsupported unless a maintained provider reports them.");
  });

  test("returns unknown readiness when required API data is missing", () => {
    const result = readinessFromContext({
      uuid: "player-uuid",
      profile: { profile_id: "profile-id" },
      member: {},
      rateLimit: null,
    }, "mining");

    expect(result.rating).toBe("unknown");
    expect(result.warnings[0]).toMatchObject({ code: "missing_api_data" });
  });

  test("marks disabled inventory API as unknown instead of low progression", () => {
    const context = fixtureContext();
    delete (context.member as any).inventory;
    const result = readinessFromContext(context, "slayer:zombie:t4");

    expect(result.rating).toBe("unknown");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "missing_gear_api_data", sourcePath: "member.inventory" }));
  });

  test("marks missing decoded gear context as unknown for direct core callers", () => {
    const result = readinessFromContext(fixtureContext(), "slayer:zombie:t4");

    expect(result.rating).toBe("unknown");
    expect(result.warnings).toContainEqual(expect.objectContaining({ code: "readiness_gear_context_missing", sourcePath: "readiness.gearContext" }));
  });
});
