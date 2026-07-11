export type SurfaceContract = {
  id: string;
  domain: string;
  cli: string[];
  cliFlags?: string[];
  mcp: string[];
  tuiScreens: string[];
  skills: string[];
  boundedOptions?: string[];
  boundedMcpOptions?: Record<string, string[]>;
};

export const SURFACE_CONTRACTS: SurfaceContract[] = [
  {
    id: "context",
    domain: "profile context",
    cli: ["context", "context refresh"],
    mcp: ["skyagent_context_get", "skyagent_context_refresh"],
    tuiScreens: ["status", "overview"],
    skills: ["hypixel-skyblock", "skyagent-context-engine"],
  },
  {
    id: "profile-overview",
    domain: "profile overview",
    cli: ["profiles", "profiles-summary", "profile-snapshot", "member", "overview"],
    mcp: ["skyblock_profiles", "skyblock_profiles_summary", "skyblock_profile_snapshot", "skyblock_profile_member", "skyblock_profile_overview"],
    tuiScreens: ["profiles", "overview"],
    skills: ["skyagent-profile-api", "skyagent-context-engine"],
  },
  {
    id: "inventory-items",
    domain: "inventory/items",
    cli: ["inventory", "inventory-section", "item-dump", "normalize-items", "item"],
    cliFlags: ["--debug-raw", "--section"],
    mcp: ["skyblock_inventory", "skyblock_inventory_section", "skyblock_item_dump", "skyblock_normalized_items", "skyblock_item_metadata"],
    tuiScreens: ["inventory", "gear", "debug"],
    skills: ["skyagent-inventory-items"],
  },
  {
    id: "networth",
    domain: "networth",
    cli: ["networth", "item-networth"],
    cliFlags: ["--max-items", "--timeout-ms", "--details", "--summary"],
    mcp: ["skyblock_networth", "skyblock_item_networth"],
    tuiScreens: ["networth"],
    skills: ["skyagent-economy"],
    boundedOptions: ["maxItems", "timeoutMs", "includeItems"],
    boundedMcpOptions: {
      skyblock_networth: ["maxItems", "timeoutMs", "includeItems"],
      skyblock_item_networth: ["maxItems", "timeoutMs", "includeItems"],
    },
  },
  {
    id: "accessories",
    domain: "accessories",
    cli: ["accessories", "missing-accessories", "accessory-upgrades"],
    cliFlags: ["--max-price-lookups", "--timeout-ms", "--budget"],
    mcp: ["skyblock_accessories", "skyblock_missing_accessories", "skyblock_accessory_upgrades"],
    tuiScreens: ["accessories"],
    skills: ["skyagent-accessories"],
    boundedOptions: ["budget", "maxPriceLookups", "timeoutMs"],
    boundedMcpOptions: {
      skyblock_accessories: ["maxPriceLookups", "timeoutMs"],
      skyblock_missing_accessories: ["maxPriceLookups", "timeoutMs"],
      skyblock_accessory_upgrades: ["budget", "maxPriceLookups", "timeoutMs"],
    },
  },
  {
    id: "progression-readiness",
    domain: "progression/readiness",
    cli: ["section", "progression", "weight", "readiness"],
    cliFlags: ["--budget", "--max-items", "--networth-timeout-ms", "--max-price-lookups", "--accessory-timeout-ms"],
    mcp: ["skyblock_profile_section", "skyblock_progression", "skyblock_weight", "skyblock_readiness"],
    tuiScreens: ["progression"],
    skills: ["skyagent-progression", "skyagent-readiness-weight"],
    boundedOptions: ["budget", "maxItems", "networthTimeoutMs", "maxPriceLookups", "accessoryTimeoutMs"],
    boundedMcpOptions: {
      skyblock_readiness: ["budget", "maxItems", "networthTimeoutMs", "maxPriceLookups", "accessoryTimeoutMs"],
    },
  },
  {
    id: "planning-objectives",
    domain: "planning/objectives",
    cli: ["plan", "museum-plan", "next-upgrades", "objective create", "objective list", "objective update", "objective complete", "objective delete"],
    cliFlags: ["--budget", "--use-context", "--persist-objectives", "--objective", "--max-items", "--networth-timeout-ms", "--max-price-lookups", "--accessory-timeout-ms", "--timeout-ms"],
    mcp: ["skyblock_plan_goal", "skyblock_museum_donation_plan", "skyblock_next_upgrades", "skyagent_objective_create", "skyagent_objective_list", "skyagent_objective_update", "skyagent_objective_complete", "skyagent_objective_delete"],
    tuiScreens: ["objectives"],
    skills: ["skyagent-planning", "skyagent-objectives"],
    boundedOptions: ["budget", "maxItems", "networthTimeoutMs", "maxPriceLookups", "accessoryTimeoutMs", "timeoutMs"],
    boundedMcpOptions: {
      skyblock_plan_goal: ["budget", "maxItems", "networthTimeoutMs", "maxPriceLookups", "accessoryTimeoutMs"],
      skyblock_museum_donation_plan: ["budget", "maxPriceLookups", "timeoutMs"],
      skyblock_next_upgrades: ["budget", "maxPriceLookups", "accessoryTimeoutMs"],
    },
  },
  {
    id: "data-sources",
    domain: "external data sources",
    cli: ["price", "lbin", "price-history", "resource"],
    mcp: ["skyblock_price", "skyblock_lowest_bin", "skyblock_price_history", "skyblock_resource"],
    tuiScreens: ["providers", "debug"],
    skills: ["skyagent-provider-maintenance", "skyagent-economy"],
  },
  {
    id: "server-status",
    domain: "server status",
    cli: ["server-status", "status"],
    mcp: ["skyagent_server_status", "hypixel_status"],
    tuiScreens: ["providers"],
    skills: ["skyagent-profile-api", "skyagent-provider-maintenance"],
  },
  {
    id: "context-events",
    domain: "context events",
    cli: ["context watch", "context emit"],
    mcp: ["skyagent_context_events", "skyagent_context_event_emit"],
    tuiScreens: ["events"],
    skills: ["skyagent-live-progress", "skyagent-context-engine"],
  },
];

export function allContractCliCommands() {
  return SURFACE_CONTRACTS.flatMap((contract) => contract.cli);
}

export function allContractMcpTools() {
  return SURFACE_CONTRACTS.flatMap((contract) => contract.mcp);
}

export function trackedTuiContractGaps() {
  return [];
}
