export const profile = {
  username: "Pastik_",
  profile: "Cucumber",
  level: 246,
  purse: "84.2M",
  bank: "1.12B",
  networth: "18.4B",
  magicalPower: 1186,
  selectedGoal: "Master Mode 5 consistency",
};

export const providerStatus = [
  { source: "Hypixel API", status: "configured", cache: "live on request", freshness: "profile data requires key", severity: "ok" },
  { source: "NotEnoughUpdates", status: "available", cache: "42 item metadata entries", freshness: "last miss 18m ago", severity: "ok" },
  { source: "CoflNet LBIN", status: "degraded", cache: "3 stale fallback entries", freshness: "using stale cache for 2 items", severity: "warn" },
  { source: "Hypixel Auctions", status: "partial", cache: "bounded scan", freshness: "3 page cap prevents exact floor", severity: "warn" },
];

export const equipment = [
  { slot: "Weapon", itemId: "HYPERION", name: "Hyperion", rarity: "mythic", value: "2.1B", detail: "Wither Impact, fumings, stars" },
  { slot: "Bow", itemId: "TERMINATOR", name: "Terminator", rarity: "legendary", value: "914M", detail: "Soul Eater V, duplex candidate" },
  { slot: "Helmet", itemId: "WITHER_GOGGLES", name: "Wither Goggles", rarity: "mythic", value: "76M", detail: "Ancient, 5 star" },
  { slot: "Chest", itemId: "STORM_CHESTPLATE", name: "Storm Chestplate", rarity: "mythic", value: "158M", detail: "Wisdom V, recombobulated" },
  { slot: "Belt", itemId: "IMPLOSION_BELT", name: "Implosion Belt", rarity: "rare", value: "19M", detail: "Dungeon utility" },
  { slot: "Pet", itemId: "GOLDEN_DRAGON", name: "Golden Dragon", rarity: "legendary", value: "1.6B", detail: "Level 200, bank scaling" },
];

export const inventorySections = [
  { name: "Armor", decoded: 4, warnings: 0, value: "381M" },
  { name: "Equipment", decoded: 4, warnings: 0, value: "72M" },
  { name: "Wardrobe", decoded: 18, warnings: 1, value: "942M" },
  { name: "Backpacks", decoded: 134, warnings: 2, value: "4.8B" },
  { name: "Accessory Bag", decoded: 712, warnings: 0, value: "2.6B" },
  { name: "Pets", decoded: 43, warnings: 0, value: "3.1B" },
];

export const networthBreakdown = [
  { name: "Purse + Bank", value: "1.20B", share: 7, confidence: "high", provider: "Hypixel profile" },
  { name: "Weapons", value: "3.01B", share: 16, confidence: "medium", provider: "CoflNet + auctions" },
  { name: "Armor", value: "1.46B", share: 8, confidence: "medium", provider: "CoflNet" },
  { name: "Accessories", value: "2.61B", share: 14, confidence: "high", provider: "Accessory universe" },
  { name: "Pets", value: "3.10B", share: 17, confidence: "medium", provider: "Hypixel auctions" },
  { name: "Backpacks + Vault", value: "7.02B", share: 38, confidence: "low", provider: "Partial item pricing" },
];

export const accessories = [
  { name: "Wither Relic", itemId: "WITHER_RELIC", rarity: "legendary", mp: 22, cost: "55M", efficiency: "2.5M / MP" },
  { name: "Pocket Espresso Machine", itemId: "POCKET_ESPRESSO_MACHINE", rarity: "epic", mp: 16, cost: "32M", efficiency: "2.0M / MP" },
  { name: "Artifact of Control", itemId: "ARTIFACT_OF_CONTROL", rarity: "rare", mp: 12, cost: "11M", efficiency: "916k / MP" },
  { name: "Odger's Bronze Tooth", itemId: "ODGERS_BRONZE_TOOTH", rarity: "uncommon", mp: 8, cost: "6M", efficiency: "750k / MP" },
];

export const progression = [
  { area: "Catacombs", level: 39, next: "M5 route", score: 82 },
  { area: "Combat", level: 60, next: "Kuudra clear speed", score: 94 },
  { area: "Mining", level: 47, next: "Powder grind", score: 61 },
  { area: "Farming", level: 50, next: "Pest milestones", score: 73 },
  { area: "Slayer", level: 9, next: "Blaze 7", score: 69 },
  { area: "Rift", level: 5, next: "Timecharm cleanup", score: 58 },
];

export const plannerSteps = [
  { id: "profile", label: "Profile Signals", detail: "Catacombs 39, 18.4B nw, 1186 MP" },
  { id: "gear", label: "Gear Readiness", detail: "Weapon solved; utility slots need cleanup" },
  { id: "accessories", label: "Accessory Efficiency", detail: "4 efficient MP buys under 120M" },
  { id: "practice", label: "Run Practice", detail: "M5 consistency before M6 routing" },
  { id: "review", label: "Provider Review", detail: "Resolve stale CoflNet entries before purchase" },
];
