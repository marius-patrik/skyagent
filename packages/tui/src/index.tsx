import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { publicConfig, setConfigValue } from "@skyagent/core/store";
import { skyblockProfiles, uuidFromNameOrUuid } from "@skyagent/core/hypixel";
import { compactProfileOverview, fetchProfileContext, profileSummaries } from "@skyagent/core/profile";
import { inventoryForPlayer } from "@skyagent/core/inventory";
import { normalizedItemsForPlayer } from "@skyagent/core/items";
import { accessoriesForPlayer, missingAccessoriesForPlayer } from "@skyagent/core/accessories";
import { networthForPlayer } from "@skyagent/core/networth";
import { progressionForPlayer } from "@skyagent/core/sections";
import { weightForPlayer } from "@skyagent/core/weight";
import { readinessForPlayer } from "@skyagent/core/readiness";
import { providerStatus } from "@skyagent/core/providers";
import { readContextEvents, serverStatusForPlayer } from "@skyagent/core/context-events";
import { completeObjectiveItem, listObjectiveItems } from "@skyagent/core/objectives";
import { SURFACE_CONTRACTS, trackedTuiContractGaps } from "@skyagent/core/surface-contracts";

export type MenuId =
  | "status"
  | "profiles"
  | "overview"
  | "inventory"
  | "gear"
  | "accessories"
  | "networth"
  | "progression"
  | "providers"
  | "events"
  | "objectives"
  | "debug";

type TuiState = {
  menuIndex: number;
  loading: boolean;
  error: string | null;
  errorScreen: MenuId | null;
  config: ReturnType<typeof publicConfig>;
  profiles: any[];
  profileCursor: number;
  debugCursor: number;
  overview: any | null;
  screenData: Record<string, any>;
  debugResult: any | null;
};

const MENU: Array<{ id: MenuId; label: string }> = [
  { id: "status", label: "Status / setup" },
  { id: "profiles", label: "Profiles" },
  { id: "overview", label: "Profile overview" },
  { id: "inventory", label: "Inventory / sections" },
  { id: "gear", label: "Pets / wardrobe / current gear" },
  { id: "accessories", label: "Accessories / Magical Power" },
  { id: "networth", label: "Networth" },
  { id: "progression", label: "Progression / readiness" },
  { id: "providers", label: "Data sources / server" },
  { id: "events", label: "Context events" },
  { id: "objectives", label: "Objectives" },
  { id: "debug", label: "Raw API / debug" },
];

export const TUI_MENU_IDS = MENU.map((entry) => entry.id);
export const TUI_SURFACE_SCREEN_IDS: MenuId[] = ["inventory", "gear", "accessories", "networth", "progression", "providers", "events", "objectives"];

const PROFILE_BOUND = new Set<MenuId>(["inventory", "gear", "accessories", "networth", "progression"]);
const DEBUG_ACTIONS = ["profile overview", "data-source status", "context events"];

function activeScreen(state: Pick<TuiState, "menuIndex">) {
  return MENU[state.menuIndex]?.id ?? "status";
}

export function tuiScreenIndex(screen: MenuId) {
  return Math.max(0, TUI_MENU_IDS.indexOf(screen));
}

export function tuiMenuNavigationAction(input: string, key: { upArrow?: boolean; downArrow?: boolean }, index: number) {
  const delta = key.downArrow || input === "j" ? 1 : key.upArrow || input === "k" ? -1 : 0;
  return delta === 0 ? index : (index + delta + MENU.length) % MENU.length;
}

export function tuiListCursorAction(active: MenuId, input: string, key: { leftArrow?: boolean; rightArrow?: boolean }, cursor: number, count: number) {
  if (!new Set<MenuId>(["profiles", "debug", "objectives"]).has(active) || count <= 0) return cursor;
  const delta = key.rightArrow || input === "l" ? 1 : key.leftArrow || input === "h" ? -1 : 0;
  return delta === 0 ? Math.min(cursor, count - 1) : (cursor + delta + count) % count;
}

export function clearProfileBoundScreenData(screenData: Record<string, any>) {
  const next = { ...screenData };
  for (const screen of PROFILE_BOUND) delete next[screen];
  return next;
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    /key|token|secret|authorization|password/i.test(key) ? "[redacted]" : redact(nested),
  ]));
}

export function compactJson(value: unknown, limit = 2800) {
  const text = JSON.stringify(redact(value), null, 2);
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… truncated`;
}

export function tuiInventorySummary(data: any) {
  const inventory = data?.inventory?.inventory ?? data?.inventory ?? {};
  const sections = inventory?.sections ?? inventory ?? {};
  const normalized = data?.normalized?.items ?? data?.normalized ?? [];
  return { sections, names: Object.keys(sections), normalized };
}

export function tuiGearSummary(data: any) {
  const inventory = data?.inventory?.inventory ?? data?.inventory ?? {};
  const items = data?.normalized?.items ?? data?.normalized ?? [];
  const pets = inventory?.pets ?? items.filter((item: any) => item?.kind === "pet");
  const wardrobe = inventory?.wardrobe ?? inventory?.sections?.wardrobe?.items ?? [];
  const armor = inventory?.armor ?? inventory?.sections?.armor?.items ?? items.filter((item: any) => item?.section === "armor");
  const equipment = inventory?.equipment ?? inventory?.sections?.equipment?.items ?? items.filter((item: any) => item?.section === "equipment");
  return { pets, wardrobe, current: [...armor, ...equipment] };
}

export function tuiAccessoriesSummary(data: any) {
  const accessories = data?.accessories?.accessories ?? data?.accessories ?? {};
  const missing = data?.missing?.missingAccessories ?? data?.missing ?? {};
  return {
    magicalPower: accessories?.magicalPower ?? accessories?.mp ?? "unknown",
    owned: accessories?.accessories ?? accessories?.items ?? [],
    missing: missing?.missingAccessories ?? missing?.missing ?? [],
    warnings: [...(accessories?.warnings ?? []), ...(missing?.warnings ?? [])],
  };
}

export function tuiNetworthSummary(data: any) {
  const networth = data?.networth?.networth ?? data?.networth ?? {};
  return {
    total: networth?.total ?? networth?.totalValue ?? null,
    purse: networth?.currency?.purse ?? networth?.purse ?? null,
    bank: networth?.currency?.bank ?? networth?.bank ?? null,
    sections: networth?.sections ?? {},
    warnings: networth?.warnings ?? [],
  };
}

export function tuiProgressionSummary(data: any) {
  const progression = data?.progression?.progression ?? data?.progression ?? {};
  const readiness = data?.readiness?.readiness ?? data?.readiness ?? {};
  const weight = data?.weight?.weight ?? data?.weight ?? {};
  return {
    progression,
    readiness,
    weight,
    sections: progression?.sections ?? progression,
    warnings: [...(readiness?.warnings ?? []), ...(progression?.warnings ?? [])],
  };
}

export function tuiProvidersSummary(data: any) {
  const raw = data?.providerStatus?.providers ?? data?.providerStatus ?? {};
  const status = Array.isArray(raw) ? { providers: raw } : raw;
  return {
    providers: status?.providers ?? [],
    resources: status?.resources ?? [],
    server: data?.serverStatus?.serverStatus ?? data?.serverStatus ?? {},
    warnings: [
      ...(status?.warnings ?? []),
      ...(status?.providers ?? []).flatMap((entry: any) => entry?.warnings ?? []),
      ...(status?.resources ?? []).flatMap((entry: any) => entry?.warnings ?? []),
    ],
  };
}

export function tuiProviderFreshnessLabel(entry: any) {
  if (!entry) return "unknown";
  if (["offline", "unavailable"].includes(entry.status)) return "offline";
  if (["missing_api_key", "degraded"].includes(entry.status)) return "degraded";
  if (entry.freshness?.status) return entry.freshness.status;
  if (entry.cacheStatus) return entry.cacheStatus;
  if (entry.cache?.staleCount > 0) return "stale";
  if (entry.cache?.unavailableCount > 0) return "degraded";
  if (entry.cache?.entryCount > 0 || entry.status === "available") return "fresh";
  return "unknown";
}

export function tuiDataStateLabel(summary: ReturnType<typeof tuiProvidersSummary>) {
  if (summary.providers.some((entry: any) => ["missing_api_key", "degraded", "offline", "unavailable"].includes(entry?.status))) return "degraded";
  const freshness = [...summary.providers, ...summary.resources].map(tuiProviderFreshnessLabel);
  if (freshness.includes("stale")) return "stale";
  if (summary.warnings.length) return "degraded";
  return "ready";
}

export function tuiEventsSummary(data: any) {
  const batch = data?.events ?? data ?? {};
  return { latestSequence: batch?.latestSequence ?? 0, events: batch?.events ?? [] };
}

export function tuiObjectivesSummary(data: any) {
  const items = Array.isArray(data) ? data : data?.objectives ?? data?.active ?? [];
  return { objectives: items };
}

export function tuiSetupCommand(input: string) {
  const [field, ...parts] = input.trim().split(/\s+/);
  const value = parts.join(" ").trim();
  const map = { username: "username", uuid: "uuid", profile: "selectedProfileId" } as const;
  if (!(field in map) || !value) return { ok: false, error: "Use username <name>, uuid <uuid>, or profile <id>." };
  const configKey = map[field as keyof typeof map];
  return { ok: true, field, config: { [configKey]: value } };
}

export function setupGuidance(config: any, needsProfile = false) {
  const missing: string[] = [];
  if (!config?.username && !config?.uuid) missing.push("username or UUID");
  if (!config?.apiKeyConfigured) missing.push("Agent OS HYPIXEL_API_KEY secret");
  if (needsProfile && !config?.selectedProfileId) missing.push("selected profile");
  return missing.length ? `Setup incomplete: ${missing.join(", ")}.` : null;
}

export function createTuiClient() {
  return {
    config: () => publicConfig(),
    profiles: async (player?: string) => {
      const uuid = await uuidFromNameOrUuid(player);
      const response = await skyblockProfiles(uuid);
      return profileSummaries(response.body?.profiles ?? [], uuid);
    },
    overview: async (player?: string, profile?: string) => compactProfileOverview(await fetchProfileContext(player, profile)),
    inventory: inventoryForPlayer,
    normalizedItems: normalizedItemsForPlayer,
    accessories: accessoriesForPlayer,
    missingAccessories: missingAccessoriesForPlayer,
    networth: networthForPlayer,
    progression: progressionForPlayer,
    weight: weightForPlayer,
    readiness: readinessForPlayer,
    providerStatus: async () => providerStatus(),
    serverStatus: serverStatusForPlayer,
    contextEvents: async (options: any) => readContextEvents(options),
    objectives: async () => listObjectiveItems(),
  };
}

export async function loadTuiSurfaceScreen(client: ReturnType<typeof createTuiClient> | any, config: any, screen: MenuId) {
  const needsProfile = PROFILE_BOUND.has(screen);
  const guidance = setupGuidance(config, needsProfile);
  if (needsProfile && guidance) return { data: null, error: guidance };
  const player = config.uuid ?? config.username;
  const profile = config.selectedProfileId;
  try {
    let data: any;
    if (screen === "inventory" || screen === "gear") {
      const [inventory, normalized] = await Promise.all([
        client.inventory(player, profile, { allowStale: true }),
        client.normalizedItems(player, profile, { allowStale: true }),
      ]);
      data = { inventory, normalized };
    } else if (screen === "accessories") {
      const [accessories, missing] = await Promise.all([
        client.accessories(player, profile, { maxPriceLookups: 40, timeoutMs: 3_000 }),
        client.missingAccessories(player, profile, { maxPriceLookups: 40, timeoutMs: 3_000 }),
      ]);
      data = { accessories, missing };
    } else if (screen === "networth") {
      data = await client.networth(player, profile, { maxItems: 60, timeoutMs: 4_000, includeItems: false });
    } else if (screen === "progression") {
      const [progression, weight, readiness] = await Promise.all([
        client.progression(player, profile),
        client.weight(player, profile),
        client.readiness("general", player, profile, { maxItems: 60 }),
      ]);
      data = { progression, weight, readiness };
    } else if (screen === "providers") {
      const [providerStatus, serverStatus] = await Promise.all([client.providerStatus(), client.serverStatus(player)]);
      data = { providerStatus, serverStatus };
    } else if (screen === "events") {
      data = await client.contextEvents({ limit: 20 });
    } else if (screen === "objectives") {
      data = await client.objectives();
    } else {
      return { data: null, error: `Unsupported TUI data screen: ${screen}` };
    }
    return { data, error: null };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

export function shouldAutoLoadTuiSurfaceScreen(screen: MenuId, state: Pick<TuiState, "loading" | "error" | "errorScreen" | "screenData">) {
  return TUI_SURFACE_SCREEN_IDS.includes(screen)
    && !state.loading
    && !(state.error && state.errorScreen === screen)
    && !state.screenData[screen];
}

export function tuiStatus() {
  return { surface: "tui", renderer: "ink", ready: true, config: publicConfig(), stateOwner: "agent-os" };
}

export function tuiSnapshot() {
  return {
    ...tuiStatus(),
    screens: TUI_MENU_IDS,
    shortcuts: ["up/down or j/k", "left/right or h/l", "enter", "r", "q"],
    secrets: ["HYPIXEL_API_KEY is read only from Agent OS", "never printed"],
    representativeContentStates: {
      inventory: ["section_summary", "normalized_items"],
      gear: ["current_gear", "wardrobe", "pets"],
      accessories: ["magical_power", "owned", "missing"],
      networth: ["compact_totals", "section_breakdown", "warnings"],
      progression: ["section_summary", "weight_estimate", "readiness_summary"],
      providers: ["data_freshness", "server_status"],
      events: ["recent_events", "sequence_cursor"],
      objectives: ["open_items", "completion"],
    },
    contractCoverage: SURFACE_CONTRACTS.map((contract) => ({ id: contract.id, status: "covered", screens: contract.tuiScreens })),
    trackedContractGaps: trackedTuiContractGaps(),
  };
}

function initialState(): TuiState {
  return {
    menuIndex: 0,
    loading: false,
    error: null,
    errorScreen: null,
    config: publicConfig(),
    profiles: [],
    profileCursor: 0,
    debugCursor: 0,
    overview: null,
    screenData: {},
    debugResult: null,
  };
}

function Header({ title }: { title: string }) {
  return <Box borderStyle="round" borderColor="cyan" paddingX={1}><Text bold color="cyan">SkyAgent · {title}</Text></Box>;
}

function Content({ state }: { state: TuiState }) {
  const screen = activeScreen(state);
  const data = state.screenData[screen];
  if (screen === "status") {
    return <Box flexDirection="column"><Text>State: {state.config.dataDir}</Text><Text>Player: {state.config.username ?? state.config.uuid ?? "not configured"}</Text><Text>Profile: {state.config.selectedProfileId ?? "not selected"}</Text><Text>Hypixel secret: {state.config.apiKeyConfigured ? "configured" : "missing (agents secrets set HYPIXEL_API_KEY)"}</Text></Box>;
  }
  if (screen === "profiles") {
    return <Box flexDirection="column">{state.profiles.length ? state.profiles.map((profile, index) => <Text key={profile.profileId} color={index === state.profileCursor ? "cyan" : undefined}>{index === state.profileCursor ? "› " : "  "}{profile.cuteName ?? profile.profileId}{profile.selected ? " · selected" : ""}</Text>) : <Text>No profiles loaded. Press enter.</Text>}</Box>;
  }
  if (screen === "overview") return <Text>{state.overview ? compactJson(state.overview) : "No overview loaded. Press enter."}</Text>;
  if (screen === "debug") return <Text>{state.debugResult ? compactJson(state.debugResult) : `Debug action: ${DEBUG_ACTIONS[state.debugCursor]}`}</Text>;
  if (state.loading) return <Text color="yellow">Loading {screen}…</Text>;
  if (state.error && state.errorScreen === screen) return <Text color="red">{state.error}</Text>;
  if (!data) return <Text>No {screen} data loaded. Press enter or r.</Text>;
  if (screen === "inventory") {
    const summary = tuiInventorySummary(data);
    return <Text>Sections: {summary.names.join(", ") || "none"}{"\n"}Normalized items: {summary.normalized.length}</Text>;
  }
  if (screen === "gear") {
    const summary = tuiGearSummary(data);
    return <Text>Current gear: {summary.current.length}{"\n"}Wardrobe: {summary.wardrobe.length}{"\n"}Pets: {summary.pets.length}</Text>;
  }
  if (screen === "accessories") {
    const summary = tuiAccessoriesSummary(data);
    return <Text>Magical Power: {String(summary.magicalPower)}{"\n"}Owned: {summary.owned.length}{"\n"}Missing: {summary.missing.length}</Text>;
  }
  if (screen === "networth") {
    const summary = tuiNetworthSummary(data);
    return <Text>Total: {String(summary.total ?? "unknown")}{"\n"}Purse: {String(summary.purse ?? "unknown")} · Bank: {String(summary.bank ?? "unknown")}</Text>;
  }
  if (screen === "providers") {
    const summary = tuiProvidersSummary(data);
    return <Text>Data state: {tuiDataStateLabel(summary)}{"\n"}{summary.providers.map((entry: any) => `${entry.id ?? entry.source}: ${entry.status ?? "unknown"} [${tuiProviderFreshnessLabel(entry)}]`).join("\n")}</Text>;
  }
  if (screen === "events") {
    const summary = tuiEventsSummary(data);
    return <Text>Latest sequence: {summary.latestSequence}{"\n"}{summary.events.slice(-12).map((entry: any) => `${entry.sequence ?? "-"} ${entry.type ?? "event"}`).join("\n")}</Text>;
  }
  if (screen === "objectives") {
    const summary = tuiObjectivesSummary(data);
    return <Text>{summary.objectives.length ? summary.objectives.map((entry: any) => `${entry.status ?? "open"} · ${entry.title}`).join("\n") : "No objectives."}</Text>;
  }
  return <Text>{compactJson(data)}</Text>;
}

export function SkyAgentTuiApp() {
  const { exit } = useApp();
  const client = useMemo(() => createTuiClient(), []);
  const [state, setState] = useState<TuiState>(initialState);
  const screen = activeScreen(state);

  const patch = useCallback((value: Partial<TuiState> | ((state: TuiState) => Partial<TuiState>)) => {
    setState((current) => ({ ...current, ...(typeof value === "function" ? value(current) : value) }));
  }, []);

  const loadSurface = useCallback(async (target: MenuId) => {
    patch({ loading: true, error: null, errorScreen: null });
    const result = await loadTuiSurfaceScreen(client, state.config, target);
    patch((current) => ({ loading: false, error: result.error, errorScreen: result.error ? target : null, screenData: result.data ? { ...current.screenData, [target]: result.data } : current.screenData }));
  }, [client, patch, state.config]);

  const activate = useCallback(async () => {
    if (screen === "profiles") {
      if (!state.profiles.length) {
        patch({ loading: true, error: null });
        try {
          const profiles = await client.profiles(state.config.uuid ?? state.config.username ?? undefined);
          patch({ profiles, loading: false });
        } catch (error) {
          patch({ loading: false, error: error instanceof Error ? error.message : String(error), errorScreen: "profiles" });
        }
      } else {
        const selected = state.profiles[state.profileCursor];
        if (selected?.profileId) setConfigValue("selectedProfileId", selected.profileId);
        patch((current) => ({ config: publicConfig(), overview: null, screenData: clearProfileBoundScreenData(current.screenData) }));
      }
      return;
    }
    if (screen === "overview") {
      patch({ loading: true, error: null });
      try {
        const overview = await client.overview(state.config.uuid ?? state.config.username ?? undefined, state.config.selectedProfileId ?? undefined);
        patch({ overview, loading: false });
      } catch (error) {
        patch({ loading: false, error: error instanceof Error ? error.message : String(error), errorScreen: "overview" });
      }
      return;
    }
    if (TUI_SURFACE_SCREEN_IDS.includes(screen)) await loadSurface(screen);
    if (screen === "debug") {
      const action = DEBUG_ACTIONS[state.debugCursor];
      const result = action === "data-source status" ? providerStatus() : action === "context events" ? readContextEvents({ limit: 10 }) : state.overview ?? { instruction: "Load profile overview first." };
      patch({ debugResult: result });
    }
  }, [client, loadSurface, patch, screen, state.config, state.debugCursor, state.overview, state.profileCursor, state.profiles]);

  useEffect(() => {
    if (shouldAutoLoadTuiSurfaceScreen(screen, state)) void loadSurface(screen);
  }, [loadSurface, screen, state]);

  useInput((input, key) => {
    if (input === "q" || (key.ctrl && input === "c")) return exit();
    if (key.return || input === "r") return void activate();
    const menuIndex = tuiMenuNavigationAction(input, key, state.menuIndex);
    if (menuIndex !== state.menuIndex) return patch({ menuIndex, error: null, errorScreen: null });
    if (screen === "profiles") return patch({ profileCursor: tuiListCursorAction(screen, input, key, state.profileCursor, state.profiles.length) });
    if (screen === "debug") return patch({ debugCursor: tuiListCursorAction(screen, input, key, state.debugCursor, DEBUG_ACTIONS.length), debugResult: null });
  });

  return <Box flexDirection="column" padding={1} gap={1}>
    <Header title={MENU[state.menuIndex]?.label ?? "Status"} />
    <Box><Text dimColor>{MENU.map((entry, index) => `${index === state.menuIndex ? "[" : " "}${entry.label}${index === state.menuIndex ? "]" : " "}`).join("  ")}</Text></Box>
    <Content state={state} />
    <Text dimColor>j/k navigate · h/l select · enter/r load · q quit</Text>
  </Box>;
}

export function TuiScreenPreview({ screen, state = {} }: { screen: MenuId; state?: Partial<TuiState> }) {
  const preview = { ...initialState(), ...state, menuIndex: tuiScreenIndex(screen) } as TuiState;
  return <Content state={preview} />;
}

export async function runTui(args: string[] = []) {
  if (args.includes("--smoke")) return tuiSnapshot();
  const instance = render(<SkyAgentTuiApp />);
  await instance.waitUntilExit();
  return tuiStatus();
}

export { completeObjectiveItem };
