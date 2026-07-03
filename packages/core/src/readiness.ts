import { fetchProfileContext } from "./profile.ts";
import { calculateAccessoriesFromMember } from "./accessories.ts";
import { inventoryFromMember } from "./inventory.ts";
import { metadataProviderResult, normalizeItemStackRecord } from "./items.ts";
import { networthForContext } from "./networth.ts";
import { catacombsLevelFromXp, gardenLevelFromXp, hotmLevelFromXp, normalizeSectionName, skillLevelFromXp, slayerLevelFromXp } from "./progression.ts";

export const READINESS_AREAS = ["dungeons", "slayer", "kuudra", "garden", "mining"] as const;

const VERIFIED_AT = "2026-07-01";

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function entries(value: any) {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
}

function sumNumbers(value: any) {
  return entries(value).reduce((total, [, amount]) => total + numberValue(amount), 0);
}

function warning(code: string, message: string, sourcePath?: string) {
  return { code, message, sourcePath };
}

function scoreCheck(name: string, passed: boolean, actual: any, target: any, sourceField: string, details: Record<string, any> = {}) {
  return { name, passed, actual, target, sourceField, ...details };
}

function ratingFromChecks(checks: Array<{ passed: boolean }>, warnings: any[]) {
  if (warnings.some((entry) => ["missing_api_data", "missing_gear_api_data", "readiness_gear_context_missing", "unsupported_readiness_target"].includes(entry.code))) {
    return "unknown";
  }
  const passed = checks.filter((check) => check.passed).length;
  const ratio = checks.length ? passed / checks.length : 0;
  const hasMissingField = warnings.some((entry) => ["missing_profile_field", "missing_gear_section"].includes(entry.code));
  if (ratio >= 0.8) {
    return hasMissingField ? "partial" : "ready";
  }
  if (ratio >= 0.5) {
    return "partial";
  }
  return hasMissingField ? "partial" : "needs_work";
}

function uniqueWarnings(warnings: any[]) {
  const seen = new Set<string>();
  return warnings.filter((entry) => {
    const key = `${entry.code}:${entry.sourcePath ?? ""}:${entry.message ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function providerFreshnessWarnings(providerFreshness: any[] = []) {
  if (!providerFreshness.length) {
    return [warning("missing_provider_freshness", "No pricing or metadata provider freshness was attached to readiness context.", "readiness.providerFreshness")];
  }
  return providerFreshness
    .filter((entry) => ["stale", "missing", "unavailable", "error"].includes(String(entry?.status ?? entry?.cacheStatus ?? "").toLowerCase()))
    .map((entry) => warning("stale_provider_freshness", `Readiness provider freshness is degraded for ${entry.source ?? entry.providerKind ?? "unknown provider"}.`, "readiness.providerFreshness"));
}

function normalizeInternalId(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function positiveNumber(...values: unknown[]) {
  return values.some((value) => Number(value) > 0);
}

function itemHasModifiers(item: any) {
  const extra = item.extraAttributes ?? item.rawExtraAttributes ?? {};
  return Boolean(
    item.reforge
    || Object.keys(item.enchantments ?? {}).length
    || Object.keys(item.attributes ?? {}).length
    || Object.keys(item.gemstones ?? {}).length
    || positiveNumber(item.hotPotatoCount, item.hot_potato_count, extra.hot_potato_count)
    || positiveNumber(item.stars, item.upgrade_level, item.dungeon_item_level, extra.upgrade_level, extra.dungeon_item_level)
    || positiveNumber(item.masterStars, item.master_star_count, extra.master_star_count)
    || item.dungeonized
    || item.recombobulated,
  );
}

function itemSummary(item: any) {
  return {
    internalId: item.internalId,
    displayName: item.cleanName ?? item.displayName ?? item.internalId,
    section: item.section ?? null,
    sourcePath: item.sourcePath ?? item.rawNbtPointer?.sourcePath ?? null,
    reforge: item.reforge ?? null,
    enchantmentCount: Object.keys(item.enchantments ?? {}).length,
    attributeCount: Object.keys(item.attributes ?? {}).length,
    gemstoneCount: Object.keys(item.gemstones ?? {}).length,
    stars: item.stars ?? 0,
    masterStars: item.masterStars ?? 0,
    dungeonized: Boolean(item.dungeonized),
    recombobulated: Boolean(item.recombobulated),
  };
}

function petSummary(pet: any) {
  const type = normalizeInternalId(pet?.type ?? pet?.uuid ?? pet?.skin ?? "UNKNOWN_PET");
  const tier = pet?.tier ? String(pet.tier) : null;
  return {
    internalId: type,
    displayName: tier ? `${tier} ${type.replace(/_/g, " ")}` : type.replace(/_/g, " "),
    section: "pets",
    sourcePath: "pets_data.pets",
    tier,
    level: pet?.exp ? null : pet?.level ?? null,
    heldItem: pet?.heldItem ?? pet?.held_item ?? null,
    candyUsed: pet?.candyUsed ?? pet?.candy_used ?? null,
    active: Boolean(pet?.active),
  };
}

function petsFromMember(member: any) {
  const pets = Array.isArray(member?.pets_data?.pets) ? member.pets_data.pets.map(petSummary) : [];
  return {
    pets,
    activePet: pets.find((pet) => pet.active) ?? null,
    sourceAvailable: Array.isArray(member?.pets_data?.pets),
  };
}

function likelyWeapon(item: any) {
  const id = normalizeInternalId(item.internalId);
  const name = String(item.cleanName ?? item.displayName ?? "").toLowerCase();
  return Boolean(
    /SWORD|BOW|DAGGER|KATANA|STAFF|WAND|SCYTHE|BLADE|HYPERION|TERMINATOR|JUJU|AXE/.test(id)
    || /\b(sword|bow|dagger|katana|staff|wand|scythe|blade|hyperion|terminator|juju)\b/.test(name)
    || Number(item.enchantments?.sharpness ?? item.enchantments?.power ?? item.enchantments?.smite ?? 0) > 0
  );
}

function magicalPowerFromMember(member: any) {
  const candidates = [
    member?.accessory_bag_storage?.highest_magical_power,
    member?.accessory_bag_storage?.magical_power,
    member?.player_stats?.highest_magical_power,
    member?.profile?.accessory_bag_storage?.highest_magical_power,
  ];
  for (const value of candidates) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function readinessGearContextFromMember(member: any) {
  const inventory = await inventoryFromMember(member);
  const normalizedItems = [];
  for (const section of inventory.sections ?? []) {
    for (const stack of section.items ?? []) {
      const internalId = normalizeInternalId(stack.internalId);
      if (!internalId) continue;
      normalizedItems.push({
        ...normalizeItemStackRecord(stack, metadataProviderResult(internalId, null, "profile-nbt")),
        section: section.section,
        sourcePath: stack.sourcePath ?? section.sourcePath ?? null,
        active: stack.active ?? false,
      });
    }
  }

  const bySection = (section: string) => normalizedItems.filter((item) => item.section === section);
  const sectionByName = new Map((inventory.sections ?? []).map((section: any) => [section.section, section]));
  const sectionAvailable = (section: string) => Boolean((sectionByName.get(section) as any)?.available);
  const armor = bySection("armor");
  const equipment = bySection("equipment");
  const wardrobe = bySection("wardrobe");
  const accessories = bySection("accessory_bag");
  const weapons = normalizedItems.filter(likelyWeapon);
  const modified = normalizedItems.filter(itemHasModifiers);
  const { pets, activePet, sourceAvailable: petSourceAvailable } = petsFromMember(member);
  const magicalPower = magicalPowerFromMember(member);

  return {
    status: "estimate",
    source: "profile-inventory-nbt",
    freshness: { status: "live", source: "profile-inventory-nbt", verifiedAt: VERIFIED_AT },
    sections: {
      armor: { available: sectionAvailable("armor"), itemCount: armor.length, items: armor.map(itemSummary).slice(0, 8) },
      equipment: { available: sectionAvailable("equipment"), itemCount: equipment.length, items: equipment.map(itemSummary).slice(0, 8) },
      wardrobe: { available: sectionAvailable("wardrobe"), itemCount: wardrobe.length, items: wardrobe.map(itemSummary).slice(0, 12) },
      weapons: { available: ["inventory", "ender_chest", "backpacks", "personal_vault", "wardrobe"].some(sectionAvailable), itemCount: weapons.length, items: weapons.map(itemSummary).slice(0, 8) },
      pets: { available: petSourceAvailable, itemCount: pets.length, active: activePet },
      accessories: { available: sectionAvailable("accessory_bag") || magicalPower !== null, itemCount: accessories.length, magicalPower },
      modifiers: { available: modified.length > 0, itemCount: modified.length, items: modified.map(itemSummary).slice(0, 12) },
    },
    warnings: inventory.warnings ?? [],
  };
}

function emptyGearContext(member: any) {
  const magicalPower = magicalPowerFromMember(member);
  return {
    status: "missing",
    source: "not_loaded",
    freshness: { status: "missing", source: "not_loaded", verifiedAt: VERIFIED_AT },
    sections: {
      armor: { available: false, itemCount: 0, items: [] },
      equipment: { available: false, itemCount: 0, items: [] },
      wardrobe: { available: false, itemCount: 0, items: [] },
      weapons: { available: false, itemCount: 0, items: [] },
      pets: { available: false, itemCount: 0, active: null },
      accessories: { available: magicalPower !== null, itemCount: 0, magicalPower },
      modifiers: { available: false, itemCount: 0, items: [] },
    },
    warnings: [warning("readiness_gear_context_missing", "Gear-aware readiness was requested without decoded inventory context; use readinessForPlayer or pass readinessGearContext.", "readiness.gearContext")],
  };
}

function targetProfile(area: string, target: any = null) {
  if (target?.unsupported) {
    return { label: target.label ?? "Unsupported readiness target", unsupported: true };
  }
  const tier = Number(target?.tier ?? Number.NaN);
  const key = String(target?.key ?? "").toLowerCase();
  if (area === "dungeons") {
    const floor = Number.isFinite(tier) ? tier : key === "m7" ? 7 : key === "f7" ? 7 : 7;
    return {
      label: target?.label ?? (key.startsWith("m") ? `Master Mode ${floor}` : `Floor ${floor}`),
      catacombsLevel: key.startsWith("m") ? 36 : floor >= 7 ? 24 : 16,
      classLevel: key.startsWith("m") ? 30 : floor >= 7 ? 20 : 15,
      magicalPower: key.startsWith("m") ? 600 : floor >= 7 ? 300 : 150,
      armorPieces: 4,
      weaponCount: 1,
      modifierCount: floor >= 7 ? 3 : 1,
    };
  }
  if (area === "slayer") {
    const bossAliases: Record<string, string> = {
      rev: "zombie",
      revenant: "zombie",
      tara: "spider",
      tarantula: "spider",
      sven: "wolf",
      eman: "enderman",
    };
    const boss = bossAliases[target?.boss] ?? target?.boss ?? (key || "any");
    const targetTier = Number.isFinite(tier) ? tier : 4;
    return {
      label: `${boss} tier ${targetTier}`,
      boss,
      tier: targetTier,
      slayerLevel: targetTier >= 4 ? 6 : 4,
      magicalPower: targetTier >= 4 ? 350 : 150,
      armorPieces: 4,
      weaponCount: 1,
      petRequired: targetTier >= 4,
      modifierCount: targetTier >= 4 ? 3 : 1,
    };
  }
  if (area === "kuudra") {
    const targetTier = Number.isFinite(tier) ? tier : 1;
    return {
      label: target?.label ?? `Kuudra tier ${targetTier}`,
      tier: targetTier,
      combatLevel: targetTier >= 3 ? 30 : 24,
      magicalPower: targetTier >= 3 ? 500 : 300,
      armorPieces: 4,
      equipmentPieces: 2,
      weaponCount: 1,
      modifierCount: targetTier >= 3 ? 4 : 2,
    };
  }
  return { label: area };
}

export function readinessTargetFromGoal(goal: unknown, area: string) {
  const text = String(goal ?? "").toLowerCase().replace(/[:/_-]+/g, " ");
  if (area === "dungeons") {
    const master = text.match(/\bm[\s:_-]*([1-7])\b|master[\s:_-]*(?:mode)?[\s:_-]*([1-7])\b/);
    if (master) return { key: `m${master[1] ?? master[2]}`, tier: Number(master[1] ?? master[2]), label: `Master Mode ${master[1] ?? master[2]}` };
    const floor = text.match(/\bf[\s:_-]*([1-7])\b|floor[\s:_-]*([1-7])\b/);
    if (floor) return { key: `f${floor[1] ?? floor[2]}`, tier: Number(floor[1] ?? floor[2]), label: `Floor ${floor[1] ?? floor[2]}` };
  }
  if (area === "slayer") {
    const boss = text.match(/\b(rev(?:enant)?|zombie|tara(?:ntula)?|spider|sven|wolf|eman|enderman|blaze|vampire)\b/)?.[1] ?? null;
    const tier = text.match(/\b(?:t|tier)[\s:_-]*([1-5])\b/)?.[1] ?? null;
    if (boss || tier) return { boss: boss ?? "any", tier: tier ? Number(tier) : 4, label: `${boss ?? "slayer"} tier ${tier ?? 4}` };
  }
  if (area === "kuudra") {
    const named: Record<string, number> = { basic: 1, hot: 2, burning: 3, fiery: 4, infernal: 5 };
    const name = Object.keys(named).find((entry) => text.includes(entry));
    const tier = text.match(/\b(?:t|tier)[\s:_-]*([1-5])\b/)?.[1] ?? null;
    if (name || tier) return { key: name ?? `t${tier}`, tier: name ? named[name] : Number(tier), label: name ? `${name} Kuudra` : `Kuudra tier ${tier}` };
  }
  return null;
}

function parseAreaTarget(value: string) {
  const raw = String(value ?? "");
  const [areaPart, ...targetParts] = raw.split(":").map((part) => part.trim()).filter(Boolean);
  const area = normalizeReadinessArea(areaPart);
  if (targetParts.length > 0) {
    const tierToken = targetParts.find((part) => /^t?[1-7]$/i.test(part));
    const tier = tierToken ? Number(tierToken.toLowerCase().replace(/^t/, "")) : null;
    if (area === "dungeons") {
      const dungeonToken = targetParts.find((part) => /^[fm]?[1-7]$/i.test(part));
      if (dungeonToken) {
        const normalized = dungeonToken.toLowerCase();
        const mode = normalized.startsWith("m") ? "m" : "f";
        const dungeonTier = Number(normalized.replace(/^[fm]/, ""));
        return { area, target: { key: `${mode}${dungeonTier}`, tier: dungeonTier, label: mode === "m" ? `Master Mode ${dungeonTier}` : `Floor ${dungeonTier}` } };
      }
    }
    if (area === "slayer") {
      const bossAliases = /^(rev(?:enant)?|zombie|tara(?:ntula)?|spider|sven|wolf|eman|enderman|blaze|vampire)$/i;
      const boss = targetParts.find((part) => bossAliases.test(part)) ?? (bossAliases.test(areaPart) ? areaPart : null);
      if (boss || tier !== null) return { area, target: { boss: boss ?? "any", tier: tier ?? 4, label: `${boss ?? "slayer"} tier ${tier ?? 4}` } };
    }
    if (area === "kuudra") {
      const named: Record<string, number> = { basic: 1, hot: 2, burning: 3, fiery: 4, infernal: 5 };
      const name = targetParts.find((part) => Object.prototype.hasOwnProperty.call(named, part.toLowerCase()));
      if (name || tier !== null) return { area, target: { key: name ?? `t${tier}`, tier: name ? named[name.toLowerCase()] : tier, label: name ? `${name.toLowerCase()} Kuudra` : `Kuudra tier ${tier}` } };
    }
    return { area, target: { unsupported: true, label: `${area} target ${targetParts.join(":")}` } };
  }
  return {
    area,
    target: readinessTargetFromGoal(raw, area),
  };
}

function gearChecks(area: string, gearContext: any, target: any, member: any) {
  const profile = targetProfile(area, target);
  const sections = gearContext.sections;
  const checks = [
    scoreCheck("gear_armor_present", sections.armor.itemCount >= (profile.armorPieces ?? 4), sections.armor.itemCount, profile.armorPieces ?? 4, "inventory.inv_armor", { blocker: "armor" }),
    scoreCheck("gear_weapon_present", sections.weapons.itemCount >= (profile.weaponCount ?? 1), sections.weapons.itemCount, profile.weaponCount ?? 1, "inventory.inv_contents", { blocker: "weapon" }),
    scoreCheck("magical_power", (sections.accessories.magicalPower ?? -1) >= (profile.magicalPower ?? 0), sections.accessories.magicalPower, profile.magicalPower ?? 0, "member.accessory_bag_storage.highest_magical_power", { blocker: "accessories" }),
    scoreCheck("item_modifiers_present", sections.modifiers.itemCount >= (profile.modifierCount ?? 1), sections.modifiers.itemCount, profile.modifierCount ?? 1, "normalized_items.modifiers", { blocker: "modifiers" }),
  ];
  if (profile.petRequired) {
    checks.push(scoreCheck("active_pet_present", Boolean(sections.pets.active), sections.pets.active?.displayName ?? null, "active pet", "pets_data.pets", { blocker: "pet" }));
  }
  if (area === "kuudra") {
    checks.push(scoreCheck("equipment_present", sections.equipment.itemCount >= (profile.equipmentPieces ?? 2), sections.equipment.itemCount, profile.equipmentPieces ?? 2, "inventory.equipment_contents", { blocker: "equipment" }));
  }
  const warnings = [
    ...(gearContext.warnings ?? []).map((entry: any) => ({ ...entry, sourcePath: entry.sourcePath ?? "inventory" })),
    ...(!sections.armor.available ? [warning("missing_gear_section", "Armor inventory data is missing or empty; readiness may understate equipped gear.", "inventory.inv_armor")] : []),
    ...(!sections.weapons.available ? [warning("missing_gear_section", "No likely combat weapon was found in decoded inventory items.", "inventory.inv_contents")] : []),
    ...(!sections.pets.active ? [warning("missing_profile_field", "No active pet was found in pet data.", "pets_data.pets")] : []),
    ...(sections.accessories.magicalPower === null ? [warning("missing_profile_field", "Magical Power is absent from profile data; accessory readiness is unknown.", "member.accessory_bag_storage.highest_magical_power")] : []),
    ...(!member?.inventory ? [warning("missing_gear_api_data", "Inventory API data is absent or disabled; gear-aware readiness may be incomplete.", "member.inventory")] : []),
  ];
  return { checks, warnings, profile };
}

function readinessResult(context: any, area: string, checks: any[], sourceFields: string[], warnings: any[], assumptions: string[], options: Record<string, any> = {}) {
  const gearContext = options.gearContext ?? null;
  const providerFreshness = options.providerFreshness ?? [];
  const freshnessWarnings = providerFreshnessWarnings(providerFreshness);
  return {
    uuid: context.uuid,
    profile: {
      profileId: context.profile.profile_id,
      cuteName: context.profile.cute_name ?? null,
    },
    area,
    status: "estimate",
    rating: ratingFromChecks(checks, warnings),
    checks,
    target: options.targetProfile ?? null,
    readinessContext: gearContext ? {
      gear: gearContext.sections,
      freshness: gearContext.freshness,
      budget: options.budget ?? null,
      providerFreshness,
    } : null,
    sourceFields,
    formulas: ["skyagent-readiness-estimate-v2", "skyagent-readiness-estimate-v1"],
    assumptions: [
      "Readiness is a conservative heuristic, not a replacement for current party-finder, guild, or meta requirements.",
      "Gear, pet, Magical Power, item modifiers, budget, and provider freshness are checked as heuristics, not simulated DPS.",
      "Exact damage-per-second math and volatile meta thresholds are unsupported unless a maintained provider reports them.",
      ...assumptions,
    ],
    freshness: {
      verifiedAt: VERIFIED_AT,
      status: "estimate",
    },
    warnings: uniqueWarnings([...warnings, ...freshnessWarnings]),
    rateLimit: context.rateLimit,
  };
}

function dungeonsReadiness(context: any, options: Record<string, any>) {
  const member = context.member;
  const gearContext = options.gearContext ?? emptyGearContext(member);
  const target = targetProfile("dungeons", options.target);
  if (target.unsupported) {
    const warnings = [warning("unsupported_readiness_target", `Unsupported Dungeon readiness target: ${target.label}.`, "readiness.target")];
    return readinessResult(context, "dungeons", [], ["member.dungeons", "readiness.target"], warnings, [`Dungeon readiness target is unsupported: ${target.label}.`], { ...options, gearContext, targetProfile: target });
  }
  const dungeonData = member?.dungeons;
  const catacombs = catacombsLevelFromXp(dungeonData?.dungeon_types?.catacombs?.experience ?? 0);
  const classes = entries(dungeonData?.player_classes).map(([name, value]: [string, any]) => ({
    name,
    ...catacombsLevelFromXp(value?.experience ?? 0),
  }));
  const bestClass = classes.sort((a, b) => b.level - a.level)[0] ?? null;
  const gear = gearChecks("dungeons", gearContext, options.target, member);
  const warnings = [
    ...(options.target?.unsupported ? [warning("unsupported_readiness_target", `Unsupported Dungeon readiness target: ${options.target.label}.`, "readiness.target")] : []),
    ...(dungeonData ? [] : [warning("missing_api_data", "Dungeons data is absent from the selected profile payload.", "member.dungeons")]),
    ...gear.warnings,
  ];
  const checks = [
    scoreCheck("catacombs_level", catacombs.level >= target.catacombsLevel, catacombs.level, target.catacombsLevel, "member.dungeons.dungeon_types.catacombs.experience"),
    scoreCheck("class_level", (bestClass?.level ?? 0) >= target.classLevel, bestClass?.level ?? 0, target.classLevel, "member.dungeons.player_classes"),
    scoreCheck("has_floor_progress", entries(dungeonData?.dungeon_types?.catacombs?.tier_completions).length > 0, dungeonData?.dungeon_types?.catacombs?.tier_completions ?? {}, "any", "member.dungeons.dungeon_types.catacombs.tier_completions"),
    ...gear.checks,
  ];
  return readinessResult(context, "dungeons", checks, ["member.dungeons", "inventory.inv_armor", "inventory.inv_contents", "pets_data.pets", "member.accessory_bag_storage"], warnings, [`Dungeon readiness target: ${target.label}.`], { ...options, gearContext, targetProfile: target });
}

function slayerReadiness(context: any, options: Record<string, any>) {
  const member = context.member;
  const gearContext = options.gearContext ?? emptyGearContext(member);
  const target = targetProfile("slayer", options.target);
  if (target.unsupported) {
    const warnings = [warning("unsupported_readiness_target", `Unsupported Slayer readiness target: ${target.label}.`, "readiness.target")];
    return readinessResult(context, "slayer", [], ["member.slayer.slayer_bosses", "readiness.target"], warnings, [`Slayer readiness target is unsupported: ${target.label}.`], { ...options, gearContext, targetProfile: target });
  }
  const bosses = context.member?.slayer?.slayer_bosses ?? null;
  const parsed = Object.fromEntries(entries(bosses).map(([name, value]: [string, any]) => [name, slayerLevelFromXp(value?.xp ?? 0)]));
  const levels = Object.values(parsed).map((entry: any) => entry.level);
  const bossLevel = target.boss && target.boss !== "any" ? (parsed[target.boss]?.level ?? 0) : Math.max(0, ...levels);
  const gear = gearChecks("slayer", gearContext, target, member);
  const warnings = [...(bosses ? [] : [warning("missing_api_data", "Slayer boss data is absent from the selected profile payload.", "member.slayer.slayer_bosses")]), ...gear.warnings];
  const checks = [
    scoreCheck("target_slayer_level", bossLevel >= target.slayerLevel, bossLevel, target.slayerLevel, "member.slayer.slayer_bosses.*.xp"),
    scoreCheck("three_slayer_5", levels.filter((level) => level >= 5).length >= 3, levels.filter((level) => level >= 5).length, 3, "member.slayer.slayer_bosses.*.xp"),
    scoreCheck("total_slayer_xp_100k", entries(bosses).reduce((total, [, value]: [string, any]) => total + numberValue(value?.xp), 0) >= 100_000, entries(bosses).reduce((total, [, value]: [string, any]) => total + numberValue(value?.xp), 0), 100_000, "member.slayer.slayer_bosses.*.xp"),
    ...gear.checks,
  ];
  return readinessResult(context, "slayer", checks, ["member.slayer.slayer_bosses", "inventory.inv_armor", "inventory.inv_contents", "pets_data.pets", "member.accessory_bag_storage"], warnings, [`Slayer readiness target: ${target.label}.`], { ...options, gearContext, targetProfile: target });
}

function kuudraReadiness(context: any, options: Record<string, any>) {
  const member = context.member;
  const gearContext = options.gearContext ?? emptyGearContext(member);
  const target = targetProfile("kuudra", options.target);
  if (target.unsupported) {
    const warnings = [warning("unsupported_readiness_target", `Unsupported Kuudra readiness target: ${target.label}.`, "readiness.target")];
    return readinessResult(context, "kuudra", [], ["member.nether_island_player_data", "readiness.target"], warnings, [`Kuudra readiness target is unsupported: ${target.label}.`], { ...options, gearContext, targetProfile: target });
  }
  const nether = context.member?.nether_island_player_data ?? null;
  const completions = nether?.kuudra_completed_tiers ?? {};
  const combat = skillLevelFromXp(context.member?.player_data?.experience?.SKILL_COMBAT ?? 0);
  const gear = gearChecks("kuudra", gearContext, options.target, member);
  const warnings = [
    ...(nether ? [] : [warning("missing_api_data", "Crimson Isle data is absent from the selected profile payload.", "member.nether_island_player_data")]),
    ...(context.member?.player_data?.experience ? [] : [warning("missing_api_data", "Skill experience is absent from the selected profile payload.", "member.player_data.experience")]),
    ...gear.warnings,
  ];
  const checks = [
    scoreCheck("combat_level", combat.level >= target.combatLevel, combat.level, target.combatLevel, "member.player_data.experience.SKILL_COMBAT"),
    scoreCheck("has_kuudra_completions", sumNumbers(completions) > 0, completions, "any", "member.nether_island_player_data.kuudra_completed_tiers"),
    scoreCheck("has_dojo_or_abiphone_progress", Boolean(nether?.dojo || nether?.abiphone), { dojo: nether?.dojo ?? null, abiphone: nether?.abiphone ?? null }, "any", "member.nether_island_player_data"),
    ...gear.checks,
  ];
  return readinessResult(context, "kuudra", checks, ["member.nether_island_player_data", "member.player_data.experience.SKILL_COMBAT", "inventory.inv_armor", "inventory.equipment_contents", "inventory.inv_contents"], warnings, [`Kuudra readiness target: ${target.label}.`], { ...options, gearContext, targetProfile: target });
}

function gardenReadiness(context: any, options: Record<string, any>) {
  const garden = context.member?.garden_player_data ?? context.member?.garden ?? null;
  const gardenLevel = gardenLevelFromXp(garden?.garden_experience ?? 0);
  const farming = skillLevelFromXp(context.member?.player_data?.experience?.SKILL_FARMING ?? 0);
  const cropMilestones = garden?.crop_milestones ?? {};
  const warnings = [
    ...(garden ? [] : [warning("missing_api_data", "Garden data is absent from the selected profile payload.", "member.garden_player_data")]),
    ...(context.member?.player_data?.experience ? [] : [warning("missing_api_data", "Skill experience is absent from the selected profile payload.", "member.player_data.experience")]),
  ];
  const checks = [
    scoreCheck("garden_10", gardenLevel.level >= 10, gardenLevel.level, 10, "member.garden_player_data.garden_experience"),
    scoreCheck("farming_25", farming.level >= 25, farming.level, 25, "member.player_data.experience.SKILL_FARMING"),
    scoreCheck("five_crop_milestones", entries(cropMilestones).length >= 5, entries(cropMilestones).length, 5, "member.garden_player_data.crop_milestones"),
  ];
  return readinessResult(context, "garden", checks, ["member.garden_player_data", "member.player_data.experience.SKILL_FARMING"], warnings, ["Garden readiness targets stable early farming progression, not contest-specific medal optimization."], options);
}

function miningReadiness(context: any, options: Record<string, any>) {
  const mining = context.member?.mining_core ?? null;
  const hotm = hotmLevelFromXp(mining?.experience ?? 0);
  const powderTotal = numberValue(mining?.powder_mithril) + numberValue(mining?.powder_spent_mithril) + numberValue(mining?.powder_gemstone) + numberValue(mining?.powder_spent_gemstone) + numberValue(mining?.powder_glacite) + numberValue(mining?.powder_spent_glacite);
  const warnings = mining ? [] : [warning("missing_api_data", "Mining core data is absent from the selected profile payload.", "member.mining_core")];
  const checks = [
    scoreCheck("hotm_7", hotm.level >= 7, hotm.level, 7, "member.mining_core.experience"),
    scoreCheck("powder_4m", powderTotal >= 4_000_000, powderTotal, 4_000_000, "member.mining_core.powder_*"),
    scoreCheck("has_major_unlocks", Boolean(mining?.nodes?.efficient_miner || mining?.nodes?.mole || mining?.nodes?.great_explorer), mining?.nodes ?? {}, "efficient_miner, mole, or great_explorer", "member.mining_core.nodes"),
  ];
  return readinessResult(context, "mining", checks, ["member.mining_core"], warnings, ["Mining readiness targets Heart of the Mountain progression and powder foundation, not exact gemstone route profitability."], options);
}

export function normalizeReadinessArea(value: unknown) {
  const normalized = normalizeSectionName(value);
  if (/^(f|floor)_?[1-7]$/.test(normalized) || /^(m|master)_?[1-7]$/.test(normalized)) {
    return "dungeons";
  }
  if (/^(rev|revenant|zombie|tara|tarantula|spider|sven|wolf|eman|enderman|blaze|vampire)(?:_?t?[1-5])?$/.test(normalized)) {
    return "slayer";
  }
  if (/^(basic|hot|burning|fiery|infernal)(?:_?kuudra)?$/.test(normalized) || /^kuudra_?t?[1-5]$/.test(normalized)) {
    return "kuudra";
  }
  if (normalized === "crimson_isle" || normalized === "crimson" || normalized === "nether") {
    return "kuudra";
  }
  if (!READINESS_AREAS.includes(normalized as any)) {
    throw new Error(`Unsupported readiness area: ${value}. Supported areas: ${READINESS_AREAS.join(", ")}`);
  }
  return normalized;
}

export function readinessFromContext(context: any, area: string, options: { target?: any; gearContext?: any; budget?: number | null; providerFreshness?: any[] } = {}) {
  const parsed = parseAreaTarget(area);
  const normalized = parsed.area;
  const target = options.target ?? parsed.target;
  const nextOptions = { ...options, target };
  if (normalized === "dungeons") {
    return dungeonsReadiness(context, nextOptions);
  }
  if (normalized === "slayer") {
    return slayerReadiness(context, nextOptions);
  }
  if (normalized === "kuudra") {
    return kuudraReadiness(context, nextOptions);
  }
  if (normalized === "garden") {
    return gardenReadiness(context, nextOptions);
  }
  return miningReadiness(context, nextOptions);
}

export async function readinessProviderFreshnessForContext(context: any, budget: number | null = null, options: {
  networthProvider?: (context: any) => Promise<any> | any;
  accessoriesProvider?: (member: any, budget: number | null) => Promise<any> | any;
  maxItems?: number;
  networthTimeoutMs?: number;
  maxPriceLookups?: number;
  accessoryTimeoutMs?: number;
} = {}) {
  const [networth, accessories] = await Promise.all([
    (options.networthProvider ?? ((input: any) => networthForContext(input, {
      maxItems: options.maxItems ?? 150,
      timeoutMs: options.networthTimeoutMs ?? 8_000,
      includeItems: false,
    })))(context),
    (options.accessoriesProvider ?? ((member: any, accessoryBudget: number | null) => calculateAccessoriesFromMember(member, {
      budget: accessoryBudget,
      maxPriceLookups: options.maxPriceLookups ?? 75,
      timeoutMs: options.accessoryTimeoutMs ?? 8_000,
    })))(context.member, budget),
  ]);
  return [
    ...(networth?.providerFreshness ?? []).map((entry: any) => ({ ...entry, providerKind: "networth" })),
    ...(accessories?.providerFreshness ?? []).map((entry: any) => ({ ...entry, providerKind: "accessories" })),
  ];
}

export async function readinessForPlayer(area: string, player?: string, profile?: string, options: {
  budget?: number | null;
  providerFreshness?: any[];
  networthProvider?: (context: any) => Promise<any> | any;
  accessoriesProvider?: (member: any, budget: number | null) => Promise<any> | any;
  maxItems?: number;
  networthTimeoutMs?: number;
  maxPriceLookups?: number;
  accessoryTimeoutMs?: number;
} = {}) {
  const context = await fetchProfileContext(player, profile);
  const budget = options.budget ?? null;
  const providerFreshness = options.providerFreshness ?? await readinessProviderFreshnessForContext(context, budget, options);
  return readinessFromContext(context, area, {
    gearContext: await readinessGearContextFromMember(context.member),
    budget,
    providerFreshness,
  });
}
