import { inventoryFromMember, normalizeInventorySectionName } from "./inventory.ts";
import { normalizeItemStacks } from "./items.ts";
import { itemPrice } from "./prices.ts";
import { fetchProfileContext } from "./profile.ts";

const ASSUMPTIONS = [
  "Values are coin-denominated estimates from direct item internal IDs plus purse and bank.",
  "Resolved Bazaar, CoflNet, and complete Hypixel auction prices contribute to totals; partial auction candidates do not.",
  "Modifiers such as enchantments, attributes, stars, skins, dyes, gemstones, pet level, and recombobulation are preserved on item records but not independently valued yet.",
  "Museum and miscellaneous valuables are included only when represented by supported inventory/profile fields.",
  "User profile data is fetched live and is not cached by the networth calculator.",
  "Third-party price provider results are estimates, not authoritative game truth.",
];

function numberOrZero(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function stackCount(value: unknown) {
  if (value === null || value === undefined) {
    return { count: 1, warnings: [] };
  }
  const count = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(count) && count > 0) {
    return { count, warnings: [] };
  }
  if (Number.isFinite(count)) {
    return {
      count: 0,
      warnings: [{
        code: "non_positive_count",
        message: `Ignoring stack with non-positive count ${count}.`,
      }],
    };
  }
  return {
    count: 1,
    warnings: [{
      code: "invalid_stack_count",
      message: `Invalid stack count ${JSON.stringify(value)}; defaulting to 1.`,
    }],
  };
}

function roundCoins(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function compactProfile(context: any) {
  return {
    profileId: context.profile.profile_id,
    cuteName: context.profile.cute_name ?? null,
  };
}

function economyFromContext(context: any) {
  return {
    purse: numberOrZero(context.member?.currencies?.coin_purse ?? context.member?.coin_purse),
    bank: numberOrZero(context.profile?.banking?.balance),
  };
}

function confidenceRank(confidence: string | null | undefined) {
  return {
    high: 4,
    medium: 3,
    low: 2,
    none: 1,
  }[confidence ?? "none"] ?? 1;
}

function aggregateConfidence(items: any[], unknownPrices: any[], warnings: any[]) {
  if (unknownPrices.length > 0 || warnings.length > 0) {
    return "low";
  }
  if (items.length === 0) {
    return "none";
  }
  const lowest = Math.min(...items.map((item) => confidenceRank(item.confidence)));
  if (lowest >= confidenceRank("high")) {
    return "high";
  }
  if (lowest >= confidenceRank("medium")) {
    return "medium";
  }
  return "low";
}

function providerKey(provider: any) {
  return [
    provider?.source ?? "unknown",
    provider?.method ?? "unknown",
    provider?.url ?? "",
  ].join("|");
}

function providerFreshnessFromItems(items: any[]) {
  const providers = new Map();
  for (const item of items) {
    const provider = item.priceProvider;
    if (!provider) {
      continue;
    }
    const key = providerKey(provider);
    const existing = providers.get(key);
    providers.set(key, {
      source: provider.source ?? "unknown",
      method: provider.method ?? "unknown",
      url: provider.url ?? null,
      cacheStatus: provider.cacheStatus ?? null,
      stale: Boolean(provider.stale),
      fetchedAt: provider.fetchedAt ?? null,
      itemCount: (existing?.itemCount ?? 0) + 1,
    });
  }
  return [...providers.values()];
}

export async function calculateNetworthFromInventory(input: {
  uuid?: string | null;
  profile?: Record<string, any>;
  member?: Record<string, any>;
  sections: Array<Record<string, any>>;
  rateLimit?: Record<string, any> | null;
  metadataProvider?: (internalId: string) => Promise<any> | any;
  priceProvider?: (internalId: string, item?: Record<string, any>) => Promise<any> | any;
}) {
  const priceProvider = input.priceProvider ?? ((internalId: string) => itemPrice(internalId));
  const economy = economyFromContext(input);
  const currencyTotal = roundCoins(economy.purse + economy.bank);
  const sections = [];
  const ignoredItems = [];
  const unknownPrices = [];
  const allWarnings = [];

  for (const section of input.sections ?? []) {
    const normalized = await normalizeItemStacks(section.items ?? [], { metadataProvider: input.metadataProvider });
    const valuedItems = [];
    let sectionTotal = 0;

    for (const item of normalized.items) {
      const countResult = stackCount(item.count);
      const count = countResult.count;
      if (!item.internalId || item.internalId === "UNKNOWN") {
        ignoredItems.push({
          section: section.section,
          reason: "missing_internal_id",
          item,
        });
        continue;
      }
      if (count <= 0) {
        ignoredItems.push({
          section: section.section,
          reason: "non_positive_count",
          item,
          warnings: countResult.warnings,
        });
        allWarnings.push(...countResult.warnings.map((entry) => ({ ...entry, source: "inventory", section: section.section, internalId: item.internalId })));
        continue;
      }

      const price = await priceProvider(item.internalId, item);
      const unitPrice = typeof price?.price === "number" && Number.isFinite(price.price) && price.price > 0
        ? price.price
        : null;
      const itemWarnings = [
        ...countResult.warnings.map((entry) => ({ ...entry, source: "inventory" })),
        ...(item.warnings ?? []).map((entry) => ({ ...entry, source: "metadata" })),
        ...(price?.warnings ?? []).map((entry) => ({ ...entry, source: "price" })),
      ];
      const valued = {
        section: section.section,
        internalId: item.internalId,
        displayName: item.displayName,
        cleanName: item.cleanName,
        category: item.category,
        rarity: item.rarity,
        count,
        unitPrice,
        total: unitPrice === null ? null : roundCoins(unitPrice * count),
        candidateUnitPrice: price?.candidatePrice ?? null,
        confidence: price?.confidence ?? "none",
        priceProvider: price?.provider ?? null,
        fallbackChain: price?.fallbackChain ?? [],
        modifiers: {
          reforge: item.reforge,
          stars: item.stars,
          masterStars: item.masterStars,
          recombobulated: item.recombobulated,
          enchantments: item.enchantments,
          attributes: item.attributes,
          gemstones: item.gemstones,
          skin: item.skin,
          dye: item.dye,
          petItem: item.petItem,
          heldItem: item.heldItem,
        },
        rawNbtPointer: item.rawNbtPointer,
        warnings: itemWarnings,
      };

      valuedItems.push(valued);
      allWarnings.push(...itemWarnings.map((entry) => ({ ...entry, section: section.section, internalId: item.internalId })));
      if (unitPrice === null) {
        unknownPrices.push({
          section: section.section,
          internalId: item.internalId,
          cleanName: item.cleanName,
          count,
          candidateUnitPrice: price?.candidatePrice ?? null,
          provider: price?.provider ?? null,
          warnings: price?.warnings ?? [],
        });
      } else {
        sectionTotal += valued.total;
      }
    }

    const sectionWarnings = [
      ...(section.warnings ?? []).map((entry) => ({ ...entry, source: "inventory", section: section.section })),
      ...(normalized.warnings ?? []).map((entry) => ({ ...entry, source: "metadata", section: section.section })),
    ];
    allWarnings.push(...sectionWarnings);
    sections.push({
      section: section.section,
      label: section.label ?? section.section,
      available: section.available ?? null,
      sourcePath: section.sourcePath ?? null,
      total: roundCoins(sectionTotal),
      itemCount: normalized.itemCount,
      pricedCount: valuedItems.filter((item) => item.unitPrice !== null).length,
      unknownCount: valuedItems.filter((item) => item.unitPrice === null).length,
      ignoredCount: ignoredItems.filter((item) => item.section === section.section).length,
      items: valuedItems,
      warnings: sectionWarnings,
    });
  }

  const pricedItems = sections.flatMap((section) => section.items).filter((item) => item.unitPrice !== null);
  const itemTotal = roundCoins(sections.reduce((total, section) => total + section.total, 0));
  const total = roundCoins(currencyTotal + itemTotal);

  return {
    uuid: input.uuid ?? null,
    profile: input.profile ? compactProfile(input) : null,
    currency: {
      purse: economy.purse,
      bank: economy.bank,
      total: currencyTotal,
    },
    total,
    itemTotal,
    sections,
    ignoredItems,
    unknownPrices,
    warnings: allWarnings,
    providerFreshness: providerFreshnessFromItems(sections.flatMap((section) => section.items)),
    assumptions: ASSUMPTIONS,
    confidence: aggregateConfidence(pricedItems, unknownPrices, allWarnings),
    rateLimit: input.rateLimit ?? null,
  };
}

export async function networthForContext(context: any, options: {
  metadataProvider?: (internalId: string) => Promise<any> | any;
  priceProvider?: (internalId: string, item?: Record<string, any>) => Promise<any> | any;
} = {}) {
  const inventory = await inventoryFromMember(context.member);
  return calculateNetworthFromInventory({
    uuid: context.uuid,
    profile: context.profile,
    member: context.member,
    rateLimit: context.rateLimit,
    sections: inventory.sections,
    metadataProvider: options.metadataProvider,
    priceProvider: options.priceProvider,
  });
}

export async function networthForPlayer(player?: string, profile?: string, options: {
  metadataProvider?: (internalId: string) => Promise<any> | any;
  priceProvider?: (internalId: string, item?: Record<string, any>) => Promise<any> | any;
} = {}) {
  return networthForContext(await fetchProfileContext(player, profile), options);
}

export function itemNetworthFromResult(result: any, sectionName: string) {
  const section = normalizeInventorySectionName(sectionName);
  const sectionResult = result.sections.find((entry) => entry.section === section) ?? null;
  const ignoredItems = result.ignoredItems.filter((item) => item.section === section);
  const unknownPrices = result.unknownPrices.filter((item) => item.section === section);
  const warnings = result.warnings.filter((entry) => entry.section === section);
  const pricedItems = (sectionResult?.items ?? []).filter((item) => item.unitPrice !== null);

  return {
    uuid: result.uuid,
    profile: result.profile,
    section: sectionResult,
    ignoredItems,
    unknownPrices,
    warnings,
    assumptions: result.assumptions,
    confidence: aggregateConfidence(pricedItems, unknownPrices, warnings),
    providerFreshness: providerFreshnessFromItems(sectionResult?.items ?? []),
    rateLimit: result.rateLimit,
  };
}

export async function itemNetworthForPlayer(player: string | undefined, profile: string | undefined, sectionName: string, options: {
  metadataProvider?: (internalId: string) => Promise<any> | any;
  priceProvider?: (internalId: string, item?: Record<string, any>) => Promise<any> | any;
} = {}) {
  const result = await networthForPlayer(player, profile, options);
  return itemNetworthFromResult(result, sectionName);
}
