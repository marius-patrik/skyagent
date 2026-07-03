import { calculateAccessoriesFromMember } from "./accessories.ts";
import { agentContextForPlayer } from "./agent-context.ts";
import { networthForContext } from "./networth.ts";
import { createObjectiveItem, objectiveContextSummary, updateObjectiveItem } from "./objectives.ts";
import { fetchProfileContext } from "./profile.ts";
import { readinessFromContext, readinessGearContextFromMember, readinessTargetFromGoal, READINESS_AREAS } from "./readiness.ts";
import { progressionFromContext } from "./sections/index.ts";
import { publicConfig, readMemories } from "./store.ts";

const VERIFIED_AT = "2026-07-01";

function normalizeGoal(goal: unknown) {
  return String(goal ?? "").trim().toLowerCase();
}

function roundCoins(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function goalAreas(goal: string) {
  const normalized = normalizeGoal(goal);
  const areas = new Set<string>();
  if (/dungeon|cata|catacomb|f7|floor|master/.test(normalized)) {
    areas.add("dungeons");
  }
  if (/slayer|zombie|rev|spider|tara|wolf|sven|eman|enderman|blaze|vampire/.test(normalized)) {
    areas.add("slayer");
  }
  if (/kuudra|crimson|nether/.test(normalized)) {
    areas.add("kuudra");
  }
  if (/garden|farm|crop|jacob|visitor/.test(normalized)) {
    areas.add("garden");
  }
  if (/mining|hotm|powder|gemstone|mithril/.test(normalized)) {
    areas.add("mining");
  }
  if (areas.size === 0) {
    areas.add("dungeons");
    areas.add("slayer");
    areas.add("mining");
    areas.add("garden");
  }
  return [...areas];
}

function recommendation(input: {
  id: string;
  title: string;
  category: string;
  priority: number;
  reason: string;
  expectedImpact: string;
  costEstimate?: any;
  timeEstimate?: any;
  prerequisites?: any[];
  sourceFreshness?: any;
  uncertainty?: string;
  warnings?: any[];
}) {
  return {
    id: input.id,
    title: input.title,
    category: input.category,
    priority: input.priority,
    reason: input.reason,
    expectedImpact: input.expectedImpact,
    costEstimate: input.costEstimate ?? { coins: null, status: "not_estimated" },
    timeEstimate: input.timeEstimate ?? { value: null, status: "not_estimated" },
    prerequisites: input.prerequisites ?? [],
    sourceFreshness: input.sourceFreshness ?? { verifiedAt: VERIFIED_AT, status: "estimate" },
    uncertainty: input.uncertainty ?? "estimate",
    warnings: input.warnings ?? [],
  };
}

function toolForReadinessBlocker(area: string, check: any) {
  const blocker = String(check.blocker ?? check.name ?? "").toLowerCase();
  if (blocker.includes("accessor") || check.name === "magical_power") {
    return "skyblock_accessory_upgrades";
  }
  if (blocker.includes("armor") || blocker.includes("weapon") || blocker.includes("equipment") || blocker.includes("pet")) {
    return "skyblock_inventory_section";
  }
  if (blocker.includes("modifier") || check.name === "item_modifiers_present") {
    return "skyblock_normalized_items";
  }
  if (area === "dungeons" || area === "slayer" || area === "kuudra" || area === "garden" || area === "mining") {
    return "skyblock_profile_section";
  }
  return "skyblock_progression";
}

function readinessBlockerRoutes(result: any) {
  return (result.checks ?? [])
    .filter((check: any) => !check.passed)
    .map((check: any) => ({
      area: result.area,
      target: result.target,
      check: check.name,
      blocker: check.blocker ?? check.name,
      sourceField: check.sourceField,
      actual: check.actual,
      targetValue: check.target,
      followUpTool: toolForReadinessBlocker(result.area, check),
      toolArguments: {
        area: result.area,
        section: check.sourceField ?? result.area,
      },
    }));
}

function readinessRecommendations(readiness: any[]) {
  const output = [];
  for (const result of readiness) {
    for (const check of result.checks ?? []) {
      if (check.passed) {
        continue;
      }
      const followUpRoute = readinessBlockerRoutes({ ...result, checks: [check] })[0];
      output.push(recommendation({
        id: `${result.area}-${check.name}`,
        title: `Improve ${result.area.replace("_", " ")}: ${check.name.replace(/_/g, " ")}`,
        category: "readiness",
        priority: result.rating === "unknown" ? 40 : 70,
        reason: `Readiness blocker ${check.name}: current value ${JSON.stringify(check.actual)} is below target ${JSON.stringify(check.target)} for ${result.target?.label ?? result.area}.`,
        expectedImpact: `Moves the ${result.area} readiness estimate toward ready status.`,
        prerequisites: [{ sourceField: check.sourceField, target: check.target, actual: check.actual, blocker: check.blocker ?? check.name, followUpRoute }],
        sourceFreshness: result.freshness,
        uncertainty: "heuristic",
        warnings: result.warnings,
      }));
    }
  }
  return output;
}

function accessoryRecommendations(accessories: any, budget: number | null, options: { includeUnpricedSource?: boolean } = {}) {
  return (accessories?.upgrades ?? [])
    .filter((upgrade: any) => {
      if (budget === null) {
        return true;
      }
      const price = typeof upgrade.price === "number" ? upgrade.price : Number.NaN;
      if (upgrade.price === null || upgrade.price === undefined) {
        return Boolean(options.includeUnpricedSource);
      }
      return Number.isFinite(price) && price >= 0 && price <= budget;
    })
    .slice(0, 10)
    .map((upgrade: any, index: number) => recommendation({
      id: `accessory-${upgrade.internalId}`,
      title: `Buy ${upgrade.displayName ?? upgrade.internalId}`,
      category: "upgrade",
      priority: 90 - index,
      reason: `Adds ${upgrade.magicalPowerGain} Magical Power at ${upgrade.coinPerMagicalPower} coins per MP.`,
      expectedImpact: `Estimated +${upgrade.magicalPowerGain} Magical Power.`,
      costEstimate: {
        coins: roundCoins(upgrade.price),
        budget,
        withinBudget: upgrade.withinBudget,
        status: upgrade.price === null ? "unknown" : "estimated",
      },
      prerequisites: [{ family: upgrade.family, rarity: upgrade.rarity }],
      sourceFreshness: {
        provider: upgrade.provider ?? null,
        status: upgrade.price === null ? "unpriced" : "priced",
      },
      uncertainty: upgrade.price === null ? "high" : "medium",
      warnings: upgrade.warnings ?? [],
    }));
}

function memorySnippet(memory: any) {
  return String(memory?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function relevantMemories(goal: string, memories: any[]) {
  const normalized = normalizeGoal(goal);
  const terms = new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length >= 3));
  return memories
    .map((memory) => ({
      id: memory.id ?? null,
      tags: Array.isArray(memory.tags) ? memory.tags : [],
      text: memorySnippet(memory),
    }))
    .filter((memory) => {
      const haystack = `${memory.text} ${memory.tags.join(" ")}`.toLowerCase();
      return terms.size === 0 || [...terms].some((term) => haystack.includes(term)) || memory.tags.includes("goal") || memory.tags.includes("preference");
    })
    .slice(0, 5);
}

function sectionByName(progression: any, name: string) {
  return (progression?.sections ?? []).find((section: any) => section.section === name) ?? null;
}

function sectionWarning(section: any, fallbackPath: string, label: string) {
  const warnings = section?.warnings ?? [];
  if (warnings.length > 0) {
    return warnings.map((entry: any) => ({
      code: entry.code ?? "missing_api_data",
      message: entry.message ?? `${label} data is missing or incomplete.`,
      sourcePath: entry.sourcePath ?? fallbackPath,
    }));
  }
  if (!section) {
    return [{
      code: "missing_api_data",
      message: `${label} data is absent from the selected profile payload.`,
      sourcePath: fallbackPath,
    }];
  }
  return [];
}

function routeSourceFreshness(providerFreshness: any[]) {
  return {
    verifiedAt: VERIFIED_AT,
    status: providerFreshness.length ? "provider_context" : "estimate",
    providers: providerFreshness.map((entry) => ({
      source: entry.source ?? entry.providerKind ?? "unknown",
      fetchedAt: entry.fetchedAt ?? null,
      status: entry.status ?? entry.cacheStatus ?? null,
      providerKind: entry.providerKind ?? null,
    })),
  };
}

function failedChecksForArea(readiness: any[], area: string) {
  const result = readiness.find((entry) => entry.area === area);
  return (result?.checks ?? [])
    .filter((check: any) => !check.passed)
    .map((check: any) => ({
      check: check.name,
      blocker: check.blocker ?? check.name,
      actual: check.actual,
      target: check.target,
      sourceField: check.sourceField,
      followUpRoute: readinessBlockerRoutes({ ...result, checks: [check] })[0],
    }));
}

function bestDungeonClass(dungeons: any) {
  return Object.entries(dungeons?.computed?.classes ?? {})
    .map(([name, value]: [string, any]) => ({ name, level: Number(value?.level ?? 0) }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name))[0] ?? null;
}

function cropMilestoneAlternatives(garden: any) {
  return Object.entries(garden?.computed?.cropMilestones ?? {})
    .map(([crop, milestone]) => ({ crop, milestone: Number(milestone ?? 0) }))
    .sort((a, b) => a.milestone - b.milestone || a.crop.localeCompare(b.crop))
    .slice(0, 5);
}

function routeCandidate(input: {
  id: string;
  title: string;
  priority: number;
  reason: string;
  expectedImpact: string;
  routeKind: string;
  expectedOutputClass: string;
  requirements: any[];
  missingUnlocks?: any[];
  costEstimate?: any;
  timeEstimate?: any;
  sourceFreshness?: any;
  uncertainty?: string;
  warnings?: any[];
}) {
  return recommendation({
    id: input.id,
    title: input.title,
    category: "route",
    priority: input.priority,
    reason: input.reason,
    expectedImpact: input.expectedImpact,
    costEstimate: input.costEstimate,
    timeEstimate: input.timeEstimate,
    prerequisites: [{
      routeKind: input.routeKind,
      expectedOutputClass: input.expectedOutputClass,
      requirements: input.requirements,
      missingUnlocks: input.missingUnlocks ?? [],
    }],
    sourceFreshness: input.sourceFreshness,
    uncertainty: input.uncertainty ?? "medium",
    warnings: input.warnings ?? [],
  });
}

function hasBudgetUpgradeSourceIntent(goal: string) {
  return /(upgrade|buy|source|shopping|budget.*upgrade|accessor|magical power|\bmp\b)/i.test(goal);
}

function objectiveStateForRoutes(goal: string, objectives: any) {
  const normalized = normalizeGoal(goal);
  const terms = new Set(normalized.split(/[^a-z0-9]+/).filter((term) => term.length >= 3));
  const active = (objectives?.active ?? []).slice(0, 10).map((item: any) => ({
    id: item.id ?? null,
    itemKind: item.itemKind ?? item.kind ?? null,
    title: item.title ?? null,
    status: item.status ?? null,
    itemId: item.itemId ?? null,
    priority: item.priority ?? null,
  }));
  const relevantActive = active.filter((item: any) => {
    const haystack = `${item.title ?? ""} ${item.itemId ?? ""} ${item.itemKind ?? ""}`.toLowerCase();
    return terms.size === 0 || [...terms].some((term) => haystack.includes(term));
  });
  return {
    counts: objectives?.counts ?? null,
    activeCount: objectives?.active?.length ?? 0,
    relevantActive,
  };
}

function attachObjectiveStateToRoutes(routes: any[], objectiveState: any) {
  return routes.map((entry) => {
    if (entry.category !== "route") {
      return entry;
    }
    const prerequisites = entry.prerequisites?.length ? entry.prerequisites : [{}];
    const [first, ...rest] = prerequisites;
    return {
      ...entry,
      prerequisites: [{
        ...first,
        objectiveState,
        requirements: [
          ...(first.requirements ?? []),
          { name: "objective_state", actual: objectiveState, target: "account for active goals and in-progress work where available" },
        ],
      }, ...rest],
    };
  });
}

function memoryRecommendations(goal: string, memories: any[]) {
  return relevantMemories(goal, memories).map((memory, index) => recommendation({
    id: `memory-${memory.id ?? index}`,
    title: "Apply saved SkyAgent note",
    category: "memory_context",
    priority: 65 - index,
    reason: memory.text ? `Saved note relevant to this plan: ${memory.text}` : "A saved note matched this goal.",
    expectedImpact: "Keeps recommendations aligned with durable user goals, constraints, or preferences.",
    prerequisites: [{ memoryId: memory.id, tags: memory.tags }],
    sourceFreshness: { source: "skyagent-memory", status: "local", verifiedAt: VERIFIED_AT },
    uncertainty: "low",
  }));
}

function moneyRouteRecommendations(goal: string, context: any, progression: any, readiness: any[], networth: any, providerFreshness: any[], budget: number | null) {
  if (!/(money|coin|profit|income|farm.*coin|make.*coin)/i.test(goal)) {
    return [];
  }
  const garden = sectionByName(progression, "garden");
  const dungeons = sectionByName(progression, "dungeons");
  const crimson = sectionByName(progression, "crimson_isle");
  const farmingLevel = sectionByName(progression, "skills")?.computed?.skills?.find((skill: any) => skill.name === "farming")?.level ?? null;
  const purse = sectionByName(progression, "currencies")?.computed?.purse ?? context.member?.coin_purse ?? null;
  const priceWarnings = providerFreshness.length ? [] : [{
    code: "missing_provider_freshness",
    message: "Money routes have no current price provider freshness, so output class is directional only.",
    sourcePath: "planner.providerFreshness",
  }];

  return [
    routeCandidate({
      id: "money-route-bazaar-flips",
      title: "Compare low-risk Bazaar flip preparation",
      priority: 82,
      routeKind: "money",
      expectedOutputClass: "coins_from_market_spreads",
      reason: "The goal asks for coins; Bazaar-style routes are only useful when current prices are fresh and the bankroll is bounded.",
      expectedImpact: "Creates a price-checked candidate route without automating buys or claiming exact profit.",
      requirements: [
        { name: "price_provider_freshness", actual: providerFreshness.length, target: "fresh Bazaar/AH provider data" },
        { name: "available_budget", actual: budget ?? purse ?? networth?.total ?? null, target: "coins you are willing to risk" },
      ],
      missingUnlocks: providerFreshness.length ? [] : ["fresh_price_provider"],
      costEstimate: { coins: budget, status: budget === null ? "needs_user_budget" : "bounded_by_budget" },
      timeEstimate: { value: "15-30 minutes for manual checks", status: "estimated" },
      sourceFreshness: routeSourceFreshness(providerFreshness),
      uncertainty: providerFreshness.length ? "high" : "very_high",
      warnings: priceWarnings,
    }),
    routeCandidate({
      id: "money-route-garden-crops",
      title: "Compare Garden crop money route",
      priority: 78,
      routeKind: "money",
      expectedOutputClass: "coins_and_crop_progress",
      reason: "Garden routes can produce coins while advancing farming milestones, but depend on Garden data and crop unlocks.",
      expectedImpact: "Ranks Garden as a money route only with explicit farming and crop milestone assumptions.",
      requirements: [
        { name: "garden_level", actual: garden?.computed?.gardenLevel?.level ?? null, target: 5 },
        { name: "farming_level", actual: farmingLevel, target: 25 },
        { name: "known_crop_milestones", actual: cropMilestoneAlternatives(garden), target: "at least 5 tracked crop milestones" },
      ],
      missingUnlocks: [
        ...((garden?.computed?.gardenLevel?.level ?? 0) < 5 ? ["garden_level_5"] : []),
        ...(cropMilestoneAlternatives(garden).length < 5 ? ["five_tracked_crop_milestones"] : []),
      ],
      costEstimate: { coins: budget, status: budget === null ? "not_estimated" : "bounded_by_budget" },
      timeEstimate: { value: "1-3 farming sessions", status: "estimated" },
      sourceFreshness: { verifiedAt: VERIFIED_AT, status: garden ? "profile_data" : "missing_profile_data" },
      uncertainty: garden ? "medium" : "high",
      warnings: sectionWarning(garden, "member.garden_player_data", "Garden"),
    }),
    routeCandidate({
      id: "money-route-dungeon-drops",
      title: "Compare Dungeon drop route",
      priority: 72,
      routeKind: "money",
      expectedOutputClass: "combat_drop_chance",
      reason: "Dungeon money routes need target-ready Catacombs, class, gear, and enough floor progress before they should beat setup routes.",
      expectedImpact: "Separates combat drop chasing from earlier readiness blockers.",
      requirements: [
        { name: "catacombs_level", actual: dungeons?.computed?.catacombs?.level ?? null, target: 24 },
        { name: "best_class", actual: bestDungeonClass(dungeons), target: "class level for target floor" },
        { name: "readiness_blockers", actual: failedChecksForArea(readiness, "dungeons"), target: "no major target blockers" },
      ],
      missingUnlocks: failedChecksForArea(readiness, "dungeons").map((entry) => entry.blocker),
      timeEstimate: { value: "session route after readiness blockers", status: "estimated" },
      sourceFreshness: routeSourceFreshness(providerFreshness),
      uncertainty: "high",
      warnings: sectionWarning(dungeons, "member.dungeons", "Dungeons"),
    }),
    routeCandidate({
      id: "money-route-kuudra-drops",
      title: "Compare Kuudra drop route",
      priority: 70,
      routeKind: "money",
      expectedOutputClass: "kuudra_chest_and_drop_chance",
      reason: "Kuudra money routes depend on Crimson Isle progress, keys, combat readiness, gear, and volatile chest/drop value.",
      expectedImpact: "Keeps Kuudra as a gated route instead of a generic coin recommendation.",
      requirements: [
        { name: "kuudra_completions", actual: crimson?.computed?.kuudra?.completions ?? null, target: "progress toward target tier" },
        { name: "kuudra_keys", actual: crimson?.computed?.kuudra?.keys ?? null, target: "keys for intended runs" },
        { name: "readiness_blockers", actual: failedChecksForArea(readiness, "kuudra"), target: "no major target blockers" },
      ],
      missingUnlocks: failedChecksForArea(readiness, "kuudra").map((entry) => entry.blocker),
      timeEstimate: { value: "after Crimson Isle and gear blockers", status: "estimated" },
      sourceFreshness: routeSourceFreshness(providerFreshness),
      uncertainty: "high",
      warnings: sectionWarning(crimson, "member.nether_island_player_data", "Crimson Isle"),
    }),
  ];
}

function farmingRouteRecommendations(goal: string, progression: any, readiness: any[], budget: number | null) {
  if (!/(garden|farm|crop|jacob|visitor|farming)/i.test(goal)) {
    return [];
  }
  const garden = sectionByName(progression, "garden");
  const farmingLevel = sectionByName(progression, "skills")?.computed?.skills?.find((skill: any) => skill.name === "farming")?.level ?? null;
  const crops = cropMilestoneAlternatives(garden);
  const readinessBlockers = failedChecksForArea(readiness, "garden");
  return [
    routeCandidate({
      id: "farming-route-crop-milestones",
      title: "Compare crop milestone route",
      priority: 80,
      routeKind: "farming",
      expectedOutputClass: "crop_milestones_and_farming_xp",
      reason: "Crop milestone routes should start from the lowest tracked crop progress before optimizing contests.",
      expectedImpact: "Turns Garden data into explicit crop progression candidates.",
      requirements: [
        { name: "garden_level", actual: garden?.computed?.gardenLevel?.level ?? null, target: 10 },
        { name: "lowest_tracked_crop_milestones", actual: crops, target: "start with the lowest crop milestones before optimizing contests" },
        { name: "readiness_blockers", actual: readinessBlockers, target: "clear Garden readiness blockers" },
      ],
      missingUnlocks: readinessBlockers.map((entry) => entry.blocker),
      costEstimate: { coins: budget, status: budget === null ? "not_estimated" : "bounded_by_budget" },
      timeEstimate: { value: "1-3 Garden sessions", status: "estimated" },
      sourceFreshness: { verifiedAt: VERIFIED_AT, status: garden ? "profile_data" : "missing_profile_data" },
      uncertainty: garden ? "medium" : "high",
      warnings: sectionWarning(garden, "member.garden_player_data", "Garden"),
    }),
    routeCandidate({
      id: "farming-route-jacob-contests",
      title: "Compare Jacob contest readiness route",
      priority: 74,
      routeKind: "farming",
      expectedOutputClass: "medals_and_crop_collection",
      reason: "Contest routes require farming level, crop setup, and crop-specific data; exact medal thresholds are meta-sensitive.",
      expectedImpact: "Identifies whether contests are a reasonable next route or should wait behind setup work.",
      requirements: [
        { name: "farming_level", actual: farmingLevel, target: 25 },
        { name: "known_crop_milestones", actual: crops, target: "crop-specific setup data" },
        { name: "visitor_stats", actual: garden?.computed?.visitorStats ?? null, target: "Garden visitor progress if relevant" },
      ],
      missingUnlocks: [
        ...((farmingLevel ?? 0) < 25 ? ["farming_25"] : []),
        ...(crops.length === 0 ? ["crop_milestone_data"] : []),
      ],
      costEstimate: { coins: budget, status: budget === null ? "not_estimated" : "bounded_by_budget" },
      timeEstimate: { value: "contest windows after setup", status: "estimated" },
      sourceFreshness: { verifiedAt: VERIFIED_AT, status: garden ? "profile_data" : "missing_profile_data" },
      uncertainty: "high",
      warnings: [
        ...sectionWarning(garden, "member.garden_player_data", "Garden"),
        { code: "unsupported_exact_formula", message: "Exact Jacob medal thresholds are not maintained by this planner.", sourcePath: "planner.farming.jacob" },
      ],
    }),
  ];
}

function budgetUpgradeSourceRouteRecommendations(goal: string, accessories: any, budget: number | null, providerFreshness: any[]) {
  const upgrades = accessories?.upgrades ?? [];
  if (!hasBudgetUpgradeSourceIntent(goal)) {
    return [];
  }
  const priced = upgrades
    .filter((upgrade: any) => typeof upgrade.price === "number" && Number.isFinite(upgrade.price))
    .sort((a: any, b: any) => (a.price - b.price) || String(a.internalId).localeCompare(String(b.internalId)))
    .slice(0, 5)
    .map((upgrade: any) => ({
      itemId: upgrade.internalId,
      displayName: upgrade.displayName ?? upgrade.internalId,
      price: roundCoins(upgrade.price),
      withinBudget: budget === null ? upgrade.withinBudget ?? null : upgrade.price <= budget,
      magicalPowerGain: upgrade.magicalPowerGain ?? null,
      coinPerMagicalPower: upgrade.coinPerMagicalPower ?? null,
      provider: upgrade.provider?.source ?? upgrade.provider ?? null,
      warnings: upgrade.warnings ?? [],
    }));
  const sourceOnly = upgrades
    .filter((upgrade: any) => upgrade.price === null || upgrade.price === undefined || !Number.isFinite(Number(upgrade.price)))
    .slice(0, 5)
    .map((upgrade: any) => ({
      itemId: upgrade.internalId,
      displayName: upgrade.displayName ?? upgrade.internalId,
      magicalPowerGain: upgrade.magicalPowerGain ?? null,
      provider: upgrade.provider?.source ?? upgrade.provider ?? null,
      warnings: upgrade.warnings ?? [],
    }));
  const routeWarnings = [
    ...(accessories?.warnings ?? []),
    ...(sourceOnly.length ? [{
      code: "unpriced_source_candidates",
      message: "Some upgrade candidates have no trusted price and should be sourced manually before buy-list persistence.",
      sourcePath: "accessories.upgrades",
    }] : []),
  ];
  return [routeCandidate({
    id: "budget-route-upgrade-source",
    title: "Compare budgeted upgrade and source route",
    priority: 79,
    routeKind: "budget_upgrade_source",
    expectedOutputClass: "magical_power_and_item_acquisition",
    reason: "Budget-constrained plans should compare priced buys against unpriced source candidates before writing buy, source, or snipe objectives.",
    expectedImpact: "Keeps upgrade, source, and snipe candidates tied to explicit budget and provider freshness.",
    requirements: [
      { name: "budget", actual: budget, target: "user coin budget for planned buys" },
      { name: "priced_upgrade_candidates", actual: priced, target: "buy candidates with price evidence" },
      { name: "source_only_candidates", actual: sourceOnly, target: "unpriced candidates to source or inspect before buying" },
      { name: "provider_freshness", actual: providerFreshness, target: "fresh accessory and price providers" },
    ],
    missingUnlocks: sourceOnly.map((entry: any) => `price:${entry.itemId}`),
    costEstimate: {
      coins: priced.length ? priced.reduce((total: number, entry: any) => total + Number(entry.price ?? 0), 0) : null,
      budget,
      status: priced.length ? "estimated_from_candidates" : "needs_price_evidence",
    },
    timeEstimate: { value: priced.length || sourceOnly.length ? "next planning pass" : "after upgrade candidates are available", status: "estimated" },
    sourceFreshness: routeSourceFreshness(providerFreshness),
    uncertainty: sourceOnly.length ? "high" : "medium",
    warnings: routeWarnings,
  })];
}

function dungeonRouteRecommendations(goal: string, progression: any, readiness: any[]) {
  if (!/(dungeon|cata|catacomb|f[1-7]|floor|m[1-7]|master)/i.test(goal)) {
    return [];
  }
  const dungeons = sectionByName(progression, "dungeons");
  const readinessEntry = readiness.find((entry) => entry.area === "dungeons");
  const blockers = failedChecksForArea(readiness, "dungeons");
  return [routeCandidate({
    id: "dungeon-route-target-floor",
    title: `Route Dungeon target ${readinessEntry?.target?.label ?? "floor"}`,
    priority: 84,
    routeKind: "dungeon",
    expectedOutputClass: "floor_completion_and_combat_drops",
    reason: "Dungeon goals need target-aware Catacombs, class, floor progress, gear, Magical Power, and modifier checks before route advice is useful.",
    expectedImpact: "Orders the Dungeon plan by explicit target prerequisites instead of a generic floor note.",
    requirements: [
      { name: "target", actual: readinessEntry?.target ?? null, target: readinessEntry?.target?.label ?? "Dungeon target" },
      { name: "catacombs_level", actual: dungeons?.computed?.catacombs?.level ?? null, target: readinessEntry?.target?.catacombsLevel ?? null },
      { name: "best_class", actual: bestDungeonClass(dungeons), target: readinessEntry?.target?.classLevel ?? null },
      { name: "floor_completions", actual: dungeons?.computed?.dungeonTypes?.catacombs?.tierCompletions ?? null, target: "target floor prerequisites" },
      { name: "readiness_blockers", actual: blockers, target: "no failed target checks" },
    ],
    missingUnlocks: blockers.map((entry) => entry.blocker),
    timeEstimate: { value: blockers.length ? "blocker-first route" : "next Dungeon sessions", status: "estimated" },
    sourceFreshness: { verifiedAt: VERIFIED_AT, status: dungeons ? "profile_data" : "missing_profile_data" },
    uncertainty: "medium",
    warnings: sectionWarning(dungeons, "member.dungeons", "Dungeons"),
  })];
}

function kuudraRouteRecommendations(goal: string, progression: any, readiness: any[]) {
  if (!/(kuudra|crimson|nether|infernal|fiery|burning|basic)/i.test(goal)) {
    return [];
  }
  const crimson = sectionByName(progression, "crimson_isle");
  const readinessEntry = readiness.find((entry) => entry.area === "kuudra");
  const blockers = failedChecksForArea(readiness, "kuudra");
  return [routeCandidate({
    id: "kuudra-route-target-tier",
    title: `Route Kuudra target ${readinessEntry?.target?.label ?? "tier"}`,
    priority: 83,
    routeKind: "kuudra",
    expectedOutputClass: "kuudra_tier_progress_and_chest_value",
    reason: "Kuudra goals need target tier, Crimson Isle unlocks, keys, combat readiness, equipment, and gear checks before run routing.",
    expectedImpact: "Orders Kuudra work by tier prerequisites and setup blockers.",
    requirements: [
      { name: "target", actual: readinessEntry?.target ?? null, target: readinessEntry?.target?.label ?? "Kuudra target" },
      { name: "completed_tiers", actual: crimson?.computed?.kuudra?.completions ?? null, target: "previous tier completions where needed" },
      { name: "keys", actual: crimson?.computed?.kuudra?.keys ?? null, target: "keys for planned runs" },
      { name: "dojo_or_abiphone", actual: { dojo: crimson?.computed?.dojo ?? null, abiphone: crimson?.computed?.abiphone ?? null }, target: "Crimson Isle progression signals" },
      { name: "readiness_blockers", actual: blockers, target: "no failed target checks" },
    ],
    missingUnlocks: blockers.map((entry) => entry.blocker),
    timeEstimate: { value: blockers.length ? "setup before target runs" : "next Kuudra sessions", status: "estimated" },
    sourceFreshness: { verifiedAt: VERIFIED_AT, status: crimson ? "profile_data" : "missing_profile_data" },
    uncertainty: "high",
    warnings: sectionWarning(crimson, "member.nether_island_player_data", "Crimson Isle"),
  })];
}

function routeRecommendations(goal: string, areas: string[], readiness: any[], context: any, progression: any, networth: any, accessories: any, providerFreshness: any[], budget: number | null, objectives: any) {
  const normalized = normalizeGoal(goal);
  const objectiveState = objectiveStateForRoutes(goal, objectives);
  const output = [
    ...moneyRouteRecommendations(goal, context, progression, readiness, networth, providerFreshness, budget),
    ...farmingRouteRecommendations(goal, progression, readiness, budget),
    ...dungeonRouteRecommendations(goal, progression, readiness),
    ...kuudraRouteRecommendations(goal, progression, readiness),
    ...budgetUpgradeSourceRouteRecommendations(goal, accessories, budget, providerFreshness),
    recommendation({
      id: "goal-route",
      title: "Follow the goal route",
      category: "route",
      priority: 68,
      reason: `The goal maps to ${areas.join(", ")} progression surfaces and should be advanced in blocker order.`,
      expectedImpact: "Turns profile-state checks into a concrete sequence instead of only reporting stats.",
      timeEstimate: { value: "next 1-3 sessions", status: "estimated" },
      prerequisites: readiness.map((entry) => ({
        area: entry.area,
        rating: entry.rating,
        failedChecks: (entry.checks ?? []).filter((check: any) => !check.passed).map((check: any) => check.name),
      })),
      uncertainty: "medium",
      warnings: readiness.flatMap((entry) => entry.warnings ?? []),
    }),
  ];
  if (/daily|route|routine|weekly/.test(normalized)) {
    output.push(recommendation({
      id: "daily-route",
      title: "Run a focused daily route",
      category: "route",
      priority: 60,
      reason: `The goal asks for route planning across ${areas.join(", ")}.`,
      expectedImpact: "Keeps time-gated progression moving without relying on one grind.",
      timeEstimate: { value: "30-90 minutes", status: "estimated" },
      prerequisites: readiness.map((entry) => ({ area: entry.area, rating: entry.rating })),
      uncertainty: "medium",
    }));
  }
  output.push(recommendation({
    id: "skip-low-impact-detours",
    title: "Skip low-impact detours until blockers are cleared",
    category: "what_to_skip",
    priority: 10,
    reason: "Planner found explicit readiness or upgrade blockers; unrelated grinds should wait unless they are fun or time-gated.",
    expectedImpact: "Preserves coins and play time for the current goal.",
    uncertainty: "low",
  }));
  const seen = new Set<string>();
  return attachObjectiveStateToRoutes(output.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  }), objectiveState);
}

function sortRecommendations(items: any[]) {
  return [...items].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function warningSummary(warnings: any[] = [], limit = 25) {
  return warnings.slice(0, limit).map((warning) => ({
    code: warning.code ?? "warning",
    message: warning.message ?? String(warning.code ?? warning),
    sourcePath: warning.sourcePath ?? warning.source ?? null,
  }));
}

function objectiveFreshnessFromRecommendation(entry: any) {
  const source = entry.sourceFreshness?.provider?.source ?? entry.sourceFreshness?.source ?? entry.sourceFreshness?.status ?? "planner";
  const fetchedAt = entry.sourceFreshness?.provider?.fetchedAt ?? entry.sourceFreshness?.fetchedAt ?? null;
  return {
    status: entry.sourceFreshness?.status ?? "planned",
    source,
    fetchedAt,
    warnings: warningSummary(entry.warnings ?? [], 10),
  };
}

function planCandidate(kind: string, entry: any, extra: Record<string, any> = {}) {
  return {
    kind,
    recommendationId: entry.id,
    title: entry.title,
    priority: entry.priority,
    reason: entry.reason,
    itemId: extra.itemId ?? null,
    targetPrice: extra.targetPrice ?? null,
    budget: extra.budget ?? null,
    sourceProvider: extra.sourceProvider ?? null,
    freshness: objectiveFreshnessFromRecommendation(entry),
    payload: {
      category: entry.category,
      expectedImpact: entry.expectedImpact,
      costEstimate: entry.costEstimate,
      timeEstimate: entry.timeEstimate,
      prerequisites: entry.prerequisites,
      uncertainty: entry.uncertainty,
      ...extra.payload,
    },
  };
}

function planWorkItems(recommendations: any[], budget: number | null) {
  const immediateActions = recommendations
    .filter((entry) => entry.category !== "what_to_skip")
    .slice(0, 5)
    .map((entry) => planCandidate("task", entry));
  const todoCandidates = recommendations
    .filter((entry) => entry.category === "readiness" || entry.category === "route" || entry.category === "memory_context")
    .map((entry) => planCandidate("task", entry));
  const buyListCandidates = recommendations
    .filter((entry) => entry.category === "upgrade" && entry.costEstimate?.coins !== null)
    .map((entry) => planCandidate("buy", entry, {
      itemId: entry.id.replace(/^accessory-/, ""),
      targetPrice: entry.costEstimate?.coins ?? null,
      budget,
      sourceProvider: entry.sourceFreshness?.provider?.source ?? null,
    }));
  const sourceItemCandidates = recommendations
    .filter((entry) => entry.category === "upgrade" && entry.costEstimate?.coins === null)
    .map((entry) => planCandidate("source", entry, {
      itemId: entry.id.replace(/^accessory-/, ""),
      budget,
      sourceProvider: entry.sourceFreshness?.provider?.source ?? null,
    }));
  const snipeCandidates = buyListCandidates
    .filter((entry) => entry.targetPrice !== null)
    .map((entry) => ({ ...entry, kind: "snipe", title: `Watch ${entry.title.replace(/^Buy\s+/i, "")}` }));

  return {
    immediateActions,
    todoCandidates,
    buyListCandidates,
    sourceItemCandidates,
    snipeCandidates,
  };
}

function persistPlanObjectives(goal: string, workItems: any, options: Record<string, any>) {
  const now = options.now;
  const root = options.objectiveId
    ? updateObjectiveItem(options.objectiveId, {
      title: options.objectiveTitle ?? `Goal: ${goal}`,
      status: options.objectiveStatus ?? "active",
      notes: options.objectiveNotes,
      now,
    })
    : createObjectiveItem({
      itemKind: "objective",
      title: options.objectiveTitle ?? `Goal: ${goal}`,
      status: options.objectiveStatus ?? "active",
      priority: 100,
      tags: ["planner", "goal"],
      freshness: { status: "planned", source: "skyagent-planner" },
      payload: { goal },
      now,
    });
  const selected = [
    ...workItems.todoCandidates.slice(0, options.maxPersistedTasks ?? 5),
    ...workItems.buyListCandidates.slice(0, options.maxPersistedBuys ?? 5),
    ...workItems.sourceItemCandidates.slice(0, options.maxPersistedSources ?? 5),
    ...workItems.snipeCandidates.slice(0, options.maxPersistedSnipes ?? 3),
  ];
  const items = selected.map((candidate: any) => createObjectiveItem({
    itemKind: candidate.kind,
    title: candidate.title,
    status: "open",
    objectiveId: root.id,
    notes: candidate.reason,
    priority: candidate.priority,
    itemId: candidate.itemId,
    targetPrice: candidate.targetPrice,
    budget: candidate.budget,
    sourceProvider: candidate.sourceProvider,
    freshness: candidate.freshness,
    payload: candidate.payload,
    tags: ["planner", goal],
    now,
  }));

  return {
    root,
    items,
    count: items.length + 1,
  };
}

export async function planGoalFromContext(context: any, goal: string, options: {
  budget?: number | null;
  memories?: any[];
  config?: any;
  networthProvider?: (context: any) => Promise<any> | any;
  accessoriesProvider?: (member: any, budget: number | null) => Promise<any> | any;
  progressionProvider?: (context: any) => Promise<any> | any;
  contextCapsule?: any;
  contextWarnings?: any[];
  objectives?: any;
  persistObjectives?: boolean;
  objectiveId?: string;
  objectiveTitle?: string;
  objectiveStatus?: string;
  objectiveNotes?: string;
  maxPersistedTasks?: number;
  maxPersistedBuys?: number;
  maxPersistedSources?: number;
  maxPersistedSnipes?: number;
  now?: number;
  maxItems?: number;
  networthTimeoutMs?: number;
  maxPriceLookups?: number;
  accessoryTimeoutMs?: number;
} = {}) {
  const areas = goalAreas(goal);
  const budget = options.budget ?? null;
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
    throw new Error("budget must be a non-negative finite number when provided.");
  }
  const readinessGearContext = await readinessGearContextFromMember(context.member);
  const progression = await (options.progressionProvider ?? progressionFromContext)(context);
  const networth = await (options.networthProvider ?? ((input: any) => networthForContext(input, {
    maxItems: options.maxItems ?? 150,
    timeoutMs: options.networthTimeoutMs ?? 8_000,
    includeItems: false,
  })))(context);
  const accessories = await (options.accessoriesProvider ?? ((member: any, accessoryBudget: number | null) => calculateAccessoriesFromMember(member, {
    budget: accessoryBudget,
    maxPriceLookups: options.maxPriceLookups ?? 75,
    timeoutMs: options.accessoryTimeoutMs ?? 8_000,
  })))(context.member, budget);
  const providerFreshness = [
    ...(networth?.providerFreshness ?? []).map((entry: any) => ({ ...entry, providerKind: "networth" })),
    ...(accessories?.providerFreshness ?? []).map((entry: any) => ({ ...entry, providerKind: "accessories" })),
  ];
  const readiness = areas.map((area) => readinessFromContext(context, area, {
    target: readinessTargetFromGoal(goal, area),
    gearContext: readinessGearContext,
    budget,
    providerFreshness,
  }));
  const memories = options.memories ?? readMemories();
  const config = options.config ?? publicConfig();
  const contextCapsule = options.contextCapsule ?? null;
  const objectives = options.objectives ?? objectiveContextSummary();
  const includeUnpricedSource = hasBudgetUpgradeSourceIntent(goal);
  const recommendations = sortRecommendations([
    ...accessoryRecommendations(accessories, budget, { includeUnpricedSource }),
    ...readinessRecommendations(readiness),
    ...memoryRecommendations(goal, memories),
    ...routeRecommendations(goal, areas, readiness, context, progression, networth, accessories, providerFreshness, budget, objectives),
  ]);
  const workItems = planWorkItems(recommendations, budget);
  const persistedObjectives = options.persistObjectives ? persistPlanObjectives(goal, workItems, options) : null;
  const readinessRoutes = readiness.flatMap((entry) => readinessBlockerRoutes(entry));

  return {
    uuid: context.uuid,
    profile: {
      profileId: context.profile.profile_id,
      cuteName: context.profile.cute_name ?? null,
    },
    goal,
    status: "estimate",
    inputs: {
      areas,
      budget,
      networth: {
        total: networth?.total ?? null,
        status: networth?.status ?? null,
        valuation: networth?.valuation ?? null,
        confidence: networth?.confidence ?? null,
        warnings: networth?.warnings ?? [],
      },
      profileSections: (progression?.sections ?? [])
        .filter((section: any) => areas.includes(section.section) || ["skills", "currencies", "unlocks"].includes(section.section))
        .map((section: any) => ({
          section: section.section,
          sourceFields: section.sourceFields ?? [],
          warningCount: (section.warnings ?? []).length,
          formulas: section.provenance?.formulas ?? [],
        })),
      readiness: readiness.map((entry) => ({
        area: entry.area,
        target: entry.target,
        rating: entry.rating,
        failedChecks: (entry.checks ?? []).filter((check: any) => !check.passed).map((check: any) => check.name),
        blockers: readinessBlockerRoutes(entry),
        followUpTools: [...new Set(readinessBlockerRoutes(entry).map((route: any) => route.followUpTool))],
        readinessContext: entry.readinessContext,
      })),
      readinessFollowUpRoutes: readinessRoutes,
      accessoryUpgradeCount: accessories?.upgrades?.length ?? 0,
      memoryCount: memories.length,
      usedMemories: relevantMemories(goal, memories),
      contextCapsule: contextCapsule ? {
        cache: contextCapsule.cache ?? null,
        generatedAt: contextCapsule.generatedAt ?? null,
        warningCount: (contextCapsule.warnings ?? []).length,
        objectiveCounts: contextCapsule.objectives?.counts ?? null,
      } : null,
      objectives: {
        counts: objectives.counts ?? null,
        activeCount: objectives.active?.length ?? 0,
        active: (objectives.active ?? []).slice(0, 10),
      },
      config: {
        username: config.username ?? null,
        uuidConfigured: Boolean(config.uuid),
        selectedProfileId: config.selectedProfileId ?? null,
      },
    },
    recommendations,
    immediateActions: workItems.immediateActions,
    todoCandidates: workItems.todoCandidates,
    buyListCandidates: workItems.buyListCandidates,
    sourceItemCandidates: workItems.sourceItemCandidates,
    snipeCandidates: workItems.snipeCandidates,
    snipeTargets: workItems.snipeCandidates,
    whatToSkip: recommendations.filter((entry) => entry.category === "what_to_skip"),
    skipGuidance: recommendations.filter((entry) => entry.category === "what_to_skip"),
    persistedObjectives,
    sourceFreshness: {
      verifiedAt: VERIFIED_AT,
      profile: contextCapsule?.cache ?? { status: "live", sourceProvider: "hypixel" },
      networthProviders: networth?.providerFreshness ?? [],
      accessoryProviders: accessories?.providerFreshness ?? [],
      readinessProviders: providerFreshness,
      profileSectionFormulas: [...new Set((progression?.sections ?? []).flatMap((section: any) => section.provenance?.formulas ?? []))],
    },
    assumptions: [
      "Planner output is deterministic for identical structured inputs.",
      "Recommendations are ranked by explicit local heuristics, not hidden model state.",
      "Missing prices, profile sections, and unsupported exact formulas are warnings, not silently filled values.",
      "Objective records are created or updated only when persistence is explicitly requested.",
    ],
    warnings: [
      ...(options.contextWarnings ?? []),
      ...(contextCapsule?.warnings ?? []).slice(0, 25),
      ...(networth?.warnings ?? []).slice(0, 25),
      ...(accessories?.warnings ?? []),
      ...readiness.flatMap((entry) => entry.warnings ?? []),
    ],
    rateLimit: context.rateLimit,
  };
}

export async function planGoalForPlayer(goal: string, player?: string, profile?: string, options: Parameters<typeof planGoalFromContext>[2] & {
  useContext?: boolean;
  contextCacheOnly?: boolean;
  contextAllowStale?: boolean;
  contextTtlMs?: number;
} = {}) {
  let contextCapsule = options.contextCapsule ?? null;
  const contextWarnings = [...(options.contextWarnings ?? [])];
  if (options.useContext) {
    try {
      contextCapsule = await agentContextForPlayer(player, profile, {
        cacheOnly: options.contextCacheOnly ?? true,
        allowStale: options.contextAllowStale ?? true,
        ttlMs: options.contextTtlMs,
      });
    } catch (error) {
      contextWarnings.push({
        code: "context_capsule_unavailable",
        message: `Planner could not read context capsule: ${(error as Error).message}`,
        sourcePath: "skyagent_context_bootstrap",
      });
    }
  }
  return planGoalFromContext(await fetchProfileContext(player, profile), goal, {
    ...options,
    contextCapsule,
    contextWarnings,
  });
}

export async function nextUpgradesFromContext(context: any, budget: number, options: {
  accessoriesProvider?: (member: any, budget: number | null) => Promise<any> | any;
  maxPriceLookups?: number;
  accessoryTimeoutMs?: number;
} = {}) {
  if (!Number.isFinite(budget) || budget < 0) {
    throw new Error("budget must be a non-negative finite number.");
  }
  const accessories = await (options.accessoriesProvider ?? ((member: any, accessoryBudget: number | null) => calculateAccessoriesFromMember(member, {
    budget: accessoryBudget,
    maxPriceLookups: options.maxPriceLookups ?? 75,
    timeoutMs: options.accessoryTimeoutMs ?? 8_000,
  })))(context.member, budget);
  const recommendations = sortRecommendations(accessoryRecommendations(accessories, budget));
  return {
    uuid: context.uuid,
    profile: {
      profileId: context.profile.profile_id,
      cuteName: context.profile.cute_name ?? null,
    },
    budget,
    status: "estimate",
    valuation: accessories?.valuation ?? null,
    recommendations,
    sourceFreshness: {
      verifiedAt: VERIFIED_AT,
      accessoryProviders: accessories?.providerFreshness ?? [],
    },
    assumptions: accessories?.assumptions ?? [],
    warnings: accessories?.warnings ?? [],
    rateLimit: context.rateLimit,
  };
}

export async function nextUpgradesForPlayer(player: string | undefined, profile: string | undefined, budget: number, options: Parameters<typeof nextUpgradesFromContext>[2] = {}) {
  return nextUpgradesFromContext(await fetchProfileContext(player, profile), budget, options);
}

export function supportedPlannerAreas() {
  return [...READINESS_AREAS];
}
