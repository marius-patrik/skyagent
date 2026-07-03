import React, { useCallback, useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import { publicConfig } from "@skyagent/core";
import { SURFACE_CONTRACTS, trackedTuiContractGaps } from "@skyagent/core/surface-contracts";
import { gatewayClient } from "@skyagent/gateway/manager";

type MenuId = "agent" | "status" | "profiles" | "overview" | "debug" | "advanced";

type TuiState = {
  menuIndex: number;
  profileCursor: number;
  debugCursor: number;
  loading: boolean;
  error: string | null;
  gateway: Awaited<ReturnType<typeof gatewayClient>> | null;
  config: any | null;
  agent: any | null;
  transcript: Array<{ role: string; content: string; pending?: boolean }>;
  input: string;
  objectiveCursor: number;
  activity: string | null;
  profiles: any[];
  overview: any | null;
  debugResult: unknown;
};

type TranscriptEntry = { role: string; content: string; pending?: boolean };

const MENU: Array<{ id: MenuId; label: string }> = [
  { id: "agent", label: "Agent chat" },
  { id: "status", label: "Config / status" },
  { id: "profiles", label: "Profile selector" },
  { id: "overview", label: "Profile overview" },
  { id: "debug", label: "Raw API / debug launcher" },
  { id: "advanced", label: "Advanced sections" },
];

const PENDING_SECTIONS = [
  ["Inventory", "available through CLI/MCP; richer TUI screen pending"],
  ["Networth", "available through CLI/MCP; richer TUI screen pending"],
  ["Accessories", "available through CLI/MCP; richer TUI screen pending"],
  ["Progression", "available through CLI/MCP; richer TUI screen pending"],
  ["Readiness", "available through CLI/MCP; richer TUI screen pending"],
  ["Planner", "available through CLI/MCP; richer TUI screen pending"],
];

const DEBUG_ACTIONS = [
  { label: "Gateway version", endpoint: "version" },
  { label: "Gateway config", endpoint: "config" },
  { label: "SkyBlock profiles", endpoint: "profiles" },
  { label: "Selected profile overview", endpoint: "overview" },
];

function boolLabel(value: unknown) {
  return value ? "yes" : "no";
}

function formatCoins(value: unknown) {
  return typeof value === "number" ? Math.round(value).toLocaleString("en-US") : "unknown";
}

function profileLabel(profile: any) {
  const name = profile.cuteName ?? "unnamed";
  const selected = profile.selected ? " selected" : "";
  return `${name} (${profile.profileId})${selected}`;
}

function createState(): TuiState {
  return {
    menuIndex: 0,
    profileCursor: 0,
    debugCursor: 0,
    loading: false,
    error: null,
    gateway: null,
    config: null,
    agent: null,
    transcript: [],
    input: "",
    objectiveCursor: 0,
    activity: null,
    profiles: [],
    overview: null,
    debugResult: null,
  };
}

function setupGuidance(config: any, needsProfile = false) {
  const missing = [];
  if (!config?.username && !config?.uuid) {
    missing.push("username or UUID");
  }
  if (!config?.apiKeyConfigured) {
    missing.push("Hypixel API key");
  }
  if (needsProfile && !config?.selectedProfileId) {
    missing.push("selected profile");
  }
  return missing.length ? `Setup incomplete: configure ${missing.join(", ")} from the status screen or CLI, then refresh.` : null;
}

export function tuiStatus() {
  const config = publicConfig();
  return {
    surface: "tui",
    renderer: "ink",
    ready: true,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    configured: {
      username: Boolean(config.username),
      uuid: Boolean(config.uuid),
      profile: Boolean(config.selectedProfileId),
      apiKey: Boolean(config.apiKeyConfigured),
    },
    config: {
      username: config.username,
      uuid: config.uuid,
      selectedProfileId: config.selectedProfileId,
      apiKeyConfigured: config.apiKeyConfigured,
      apiKeySource: config.apiKeySource,
      dataDir: config.dataDir,
    },
    providers: {
      hypixelApi: config.apiKeyConfigured ? "configured" : "missing_api_key",
      itemMetadata: "on_demand_neu_provider",
      priceCache: "shared_core_provider_cache",
    },
    gateway: {
      managed: false,
      mode: "not_started_for_status_snapshot",
    },
  };
}

export function tuiSnapshot() {
  const status = tuiStatus();
  return {
    ...status,
    screens: MENU.map((item) => item.id),
    contractCoverage: SURFACE_CONTRACTS.map((contract) => ({
      id: contract.id,
      status: contract.tui.status,
      screens: contract.tui.screens,
      issue: contract.tui.issue ?? null,
    })),
    trackedContractGaps: trackedTuiContractGaps(),
    shortcuts: ["up/down or j/k", "left/right or h/l", "enter", "r", "q", "agent text input", "tab add objective", "[/] select objective", "x complete objective"],
    secrets: "api keys are never printed",
  };
}

export function tuiDegradedMessages(config: any, agent: any = null, needsProfile = false) {
  const messages = [];
  const setup = setupGuidance(config, needsProfile);
  if (setup) messages.push(setup);
  for (const warning of agent?.warnings ?? []) {
    messages.push(warning.message ?? String(warning.code ?? warning));
  }
  for (const warning of agent?.providerStatus?.llm?.warnings ?? []) {
    messages.push(warning.message ?? String(warning.code ?? warning));
  }
  return messages;
}

export function startAgentTranscript(transcript: TranscriptEntry[], message: string) {
  return [...transcript, { role: "user", content: message }, { role: "assistant", content: "", pending: true }];
}

export function applyAgentTranscriptDelta(transcript: TranscriptEntry[], assistantText: string) {
  if (transcript.length === 0) {
    return [{ role: "assistant", content: assistantText, pending: true }];
  }
  const next = [...transcript];
  const lastIndex = next.length - 1;
  next[lastIndex] = { role: "assistant", content: assistantText, pending: true };
  return next;
}

export function finishAgentTranscript(transcript: TranscriptEntry[], assistantText: string) {
  if (transcript.length === 0) {
    return [{ role: "assistant", content: assistantText || "(no text returned)" }];
  }
  const next = [...transcript];
  const lastIndex = next.length - 1;
  next[lastIndex] = { role: "assistant", content: assistantText || "(no text returned)" };
  return next;
}

export function agentConsumesPrintableInput(input: string, currentInput: string) {
  if (input === "\r" || input === "\n") return false;
  if (input === "\t") return false;
  if (!currentInput && ["j", "k", "h", "l"].includes(input)) return false;
  return true;
}

type AgentInputKeyState = Partial<Record<"ctrl" | "meta" | "upArrow" | "downArrow" | "leftArrow" | "rightArrow" | "return" | "backspace" | "delete" | "tab", boolean>>;

export function agentShouldAppendPrintableInput(input: string, currentInput: string, key: AgentInputKeyState = {}) {
  return Boolean(
    input
      && agentConsumesPrintableInput(input, currentInput)
      && !key.ctrl
      && !key.meta
      && !key.upArrow
      && !key.downArrow
      && !key.leftArrow
      && !key.rightArrow
      && !key.return
      && !key.backspace
      && !key.delete
      && !key.tab
  );
}

export function agentInputAction(input: string, currentInput: string) {
  if (input === "q" && !currentInput) return { action: "quit" as const, input: currentInput };
  return { action: "append" as const, input: `${currentInput}${input}` };
}

export function agentRefreshShortcut(input: string, key: Pick<AgentInputKeyState, "ctrl"> = {}) {
  return Boolean(key.ctrl && (input === "r" || input === "\x12"));
}

export function activeObjectiveItems(agent: any) {
  return (agent?.objectives?.active ?? []).filter((item: any) => item && item.status !== "done" && item.status !== "deleted");
}

export function objectiveCursorAction(input: string, currentCursor: number, count: number) {
  if (count <= 0) return 0;
  if (input === "[") return (currentCursor - 1 + count) % count;
  if (input === "]") return (currentCursor + 1) % count;
  return Math.min(currentCursor, count - 1);
}

export function objectiveActionLabel(input: string) {
  if (input === "tab" || input === "\t") return "create";
  if (input === "x") return "complete";
  return null;
}

function Header({ title }: { title: string }) {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="cyan">SkyAgent</Text>
      <Text bold>{title}</Text>
      <Text dimColor>up/down or j/k screens, left/right or h/l lists, enter send/select, ctrl+r refresh, q quit</Text>
    </Box>
  );
}

function freshnessLabel(agent: any) {
  const cache = agent?.freshness;
  if (!cache) return "context unavailable";
  const status = cache.stale ? "stale" : cache.status ?? "unknown";
  return `${status}${cache.fetchedAt ? ` at ${cache.fetchedAt}` : ""}`;
}

function AgentScreen({ state }: { state: TuiState }) {
  const agent = state.agent;
  const provider = agent?.providerStatus?.llm;
  const objectives = activeObjectiveItems(agent);
  const degradedMessages = tuiDegradedMessages(state.config, agent, Boolean(state.gateway));
  const selectedObjectiveIndex = objectives.length ? Math.min(state.objectiveCursor, objectives.length - 1) : -1;
  const transcript = state.transcript.length
    ? state.transcript
    : [{ role: "system", content: agent?.ready ? "Agent ready. Type a SkyBlock question or objective." : "Starting local agent session..." }];
  return (
    <Box flexDirection="column">
      <Header title="Agent chat" />
      {state.loading && <Text color="yellow">{state.activity ?? "Working..."}</Text>}
      {state.error && <Text color="red">Error: {state.error}</Text>}
      {degradedMessages.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {degradedMessages.slice(0, 5).map((message, index) => (
            <Text key={`${message}-${index}`} color="yellow">! {message}</Text>
          ))}
        </Box>
      )}
      <Box flexDirection="column" marginBottom={1}>
        <Text>Session: {agent?.id ?? "not started"}</Text>
        <Text>Player: {agent?.player?.username ?? agent?.player?.input ?? "not configured"} | Profile: {agent?.selectedProfile?.cuteName ?? agent?.selectedProfile?.profileId ?? "not selected"}</Text>
        <Text>Context: {freshnessLabel(agent)}</Text>
        <Text>LiteLLM: {provider?.configured ? `${provider.provider}:${provider.model}` : "not configured"}</Text>
        <Text>Objectives: {objectives.length} active | [/] select | tab add typed objective | x complete selected</Text>
      </Box>
      <Box flexDirection="column" marginBottom={1}>
        {objectives.slice(0, 5).map((objective: any, index: number) => (
          <Text key={objective.id ?? `${objective.title}-${index}`} color={index === selectedObjectiveIndex ? "green" : undefined}>
            {index === selectedObjectiveIndex ? "> " : "  "}{objective.itemKind ?? "objective"}: {objective.title ?? objective.id} [{objective.status ?? "open"}]
          </Text>
        ))}
        {!objectives.length && <Text dimColor>No active objectives. Type one and press tab.</Text>}
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} minHeight={10}>
        {transcript.slice(-10).map((message, index) => (
          <Text key={`${message.role}-${index}`} color={message.role === "user" ? "green" : message.role === "assistant" ? "cyan" : "gray"}>
            {message.role}: {message.content || (message.pending ? "..." : "")}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="green">{"> "}</Text>
        <Text>{state.input}</Text>
        <Text dimColor>{state.input ? "" : "type here"}</Text>
      </Box>
    </Box>
  );
}

function Menu({ activeIndex }: { activeIndex: number }) {
  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      {MENU.map((item, index) => (
        <Text key={item.id} color={index === activeIndex ? "green" : undefined}>
          {index === activeIndex ? "> " : "  "}{item.label}
        </Text>
      ))}
    </Box>
  );
}

function StatusScreen({ state }: { state: TuiState }) {
  const status = tuiStatus();
  const config = state.config ?? status.config;
  const gateway = state.gateway?.status;
  return (
    <Box flexDirection="column">
      <Header title="Config / status" />
      {state.loading && <Text color="yellow">Connecting to local gateway...</Text>}
      {state.error && <Text color="red">Gateway: {state.error}</Text>}
      <Text>Gateway: {gateway ? `${gateway.url} pid=${gateway.pid}` : "not connected"}</Text>
      <Text>Username: {config.username ?? "not configured"}</Text>
      <Text>UUID: {config.uuid ?? "not configured"}</Text>
      <Text>Selected profile: {config.selectedProfileId ?? "not configured"}</Text>
      <Text>API key configured: {boolLabel(config.apiKeyConfigured)}{config.apiKeySource ? ` (${config.apiKeySource})` : ""}</Text>
      <Text>Data dir: {config.dataDir}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Providers / cache</Text>
        <Text>Hypixel API: {config.apiKeyConfigured ? "configured" : "missing_api_key"}</Text>
        <Text>Item metadata: {status.providers.itemMetadata}</Text>
        <Text>Price cache: {status.providers.priceCache}</Text>
      </Box>
    </Box>
  );
}

function ProfilesScreen({ state }: { state: TuiState }) {
  return (
    <Box flexDirection="column">
      <Header title="Profile selector" />
      {state.loading && <Text color="yellow">Loading profiles...</Text>}
      {!state.loading && state.error && (
        <>
          <Text color="red">Error: {state.error}</Text>
          <Text dimColor>Complete setup in Config / status, then press r.</Text>
        </>
      )}
      {!state.loading && !state.error && state.profiles.length === 0 && <Text>No profiles loaded. Press r to fetch profiles.</Text>}
      {!state.loading && !state.error && state.profiles.length > 0 && (
        <>
          <Text dimColor>Select a profile and press enter to store it in SkyAgent config.</Text>
          <Box flexDirection="column" marginTop={1}>
            {state.profiles.map((profile, index) => (
              <Text key={profile.profileId} color={index === state.profileCursor ? "green" : undefined}>
                {index === state.profileCursor ? "> " : "  "}{profileLabel(profile)}
              </Text>
            ))}
          </Box>
        </>
      )}
    </Box>
  );
}

function OverviewScreen({ state }: { state: TuiState }) {
  const overview = state.overview;
  return (
    <Box flexDirection="column">
      <Header title="Profile overview" />
      {state.loading && <Text color="yellow">Loading overview...</Text>}
      {!state.loading && state.error && (
        <>
          <Text color="red">Error: {state.error}</Text>
          <Text dimColor>Complete setup in Config / status, then press r.</Text>
        </>
      )}
      {!state.loading && !state.error && !overview && <Text>No overview loaded. Press r to fetch the selected profile overview.</Text>}
      {!state.loading && !state.error && overview && (
        <Box flexDirection="column">
          <Text>Profile: {overview.selectedProfile.cuteName ?? "unnamed"} ({overview.selectedProfile.profileId})</Text>
          <Text>Game mode: {overview.selectedProfile.gameMode}</Text>
          <Text>Purse: {formatCoins(overview.economy.purse)}</Text>
          <Text>Bank: {formatCoins(overview.economy.bank)}</Text>
          <Text>SkyBlock level XP: {overview.progression.skyblockLevelXp ?? "unknown"}</Text>
          <Text>Skill XP keys: {overview.progression.skillExperienceKeys.length}</Text>
          <Text>Slayer bosses: {overview.progression.slayerBosses.join(", ") || "none"}</Text>
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Inventory API signals</Text>
            {Object.entries(overview.inventoryApiSignals).map(([key, value]) => (
              <Text key={key}>- {key}: {boolLabel(value)}</Text>
            ))}
          </Box>
          {overview.rateLimit && (
            <Text>Rate limit: remaining={overview.rateLimit.remaining ?? "unknown"} reset={overview.rateLimit.reset ?? "unknown"}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}

function DebugScreen({ state }: { state: TuiState }) {
  return (
    <Box flexDirection="column">
      <Header title="Raw API / debug launcher" />
      {state.loading && <Text color="yellow">Running request...</Text>}
      {!state.loading && state.error && <Text color="red">Error: {state.error}</Text>}
      <Text dimColor>Select an endpoint abstraction and press enter.</Text>
      <Box flexDirection="column" marginTop={1}>
        {DEBUG_ACTIONS.map((action, index) => (
          <Text key={action.endpoint} color={index === state.debugCursor ? "green" : undefined}>
            {index === state.debugCursor ? "> " : "  "}{action.label}
          </Text>
        ))}
      </Box>
      {state.debugResult && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Last result</Text>
          <Text>{JSON.stringify(state.debugResult, null, 2)}</Text>
        </Box>
      )}
    </Box>
  );
}

function AdvancedScreen({ state }: { state: TuiState }) {
  const gateway = state.gateway?.status;
  const config = state.config;
  return (
    <Box flexDirection="column">
      <Header title="Advanced sections" />
      {state.loading && <Text color="yellow">Refreshing gateway contract...</Text>}
      {state.error && <Text color="red">Error: {state.error}</Text>}
      <Text>Gateway: {gateway ? `${gateway.url} pid=${gateway.pid}` : "not connected"}</Text>
      <Text>Configured player: {config?.username ?? config?.uuid ?? "not configured"}</Text>
      <Text>Selected profile: {config?.selectedProfileId ?? "not configured"}</Text>
      {PENDING_SECTIONS.map(([name, note]) => (
        <Text key={name}>- {name}: {note}</Text>
      ))}
    </Box>
  );
}

function ActiveScreen({ state }: { state: TuiState }) {
  const active = MENU[state.menuIndex].id;
  if (active === "agent") {
    return <AgentScreen state={state} />;
  }
  if (active === "status") {
    return <StatusScreen state={state} />;
  }
  if (active === "profiles") {
    return <ProfilesScreen state={state} />;
  }
  if (active === "overview") {
    return <OverviewScreen state={state} />;
  }
  if (active === "debug") {
    return <DebugScreen state={state} />;
  }
  return <AdvancedScreen state={state} />;
}

export async function connectTuiGateway() {
  const gateway = await gatewayClient();
  const configResponse = await gateway.client.config();
  const agentResponse = await gateway.client.startAgent({ cacheOnly: true, allowStale: true, sourceKind: "tui", sourceTransport: "ink" });
  return { gateway, config: configResponse.config, agent: agentResponse.agent };
}

export function SkyAgentTuiApp() {
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(() => createState());

  const patchState = useCallback((patch: Partial<TuiState>) => {
    setState((current) => ({ ...current, ...patch }));
  }, []);

  const connectGateway = useCallback(async () => {
    const session = await connectTuiGateway();
    patchState({ gateway: session.gateway, config: session.config, agent: session.agent, error: null });
    return session;
  }, [patchState]);

  const sendAgentMessage = useCallback(async () => {
    const message = state.input.trim();
    if (!message) return;
    patchState({
      loading: true,
      error: null,
      input: "",
      activity: "Streaming agent response...",
      transcript: startAgentTranscript(state.transcript, message),
    });
    try {
      const { gateway } = state.gateway
        ? { gateway: state.gateway }
        : await connectGateway();
      let assistant = "";
      await gateway.client.streamAgentMessage({ message }, (event) => {
        if (event.type === "activity") {
          patchState({ activity: event.message });
        }
        if (event.type === "text_delta") {
          assistant += event.text;
          setState((current) => {
            return { ...current, transcript: applyAgentTranscriptDelta(current.transcript, assistant) };
          });
        }
        if (event.type === "agent_done") {
          patchState({ agent: event.session });
        }
        if (event.type === "error") {
          patchState({ error: event.error });
        }
      });
      setState((current) => {
        return { ...current, transcript: finishAgentTranscript(current.transcript, assistant), loading: false, activity: null };
      });
    } catch (error) {
      patchState({ error: error instanceof Error ? error.message : String(error), loading: false, activity: null });
    }
  }, [connectGateway, patchState, state.gateway, state.input, state.transcript]);

  const runObjectiveAction = useCallback(async (action: "create" | "complete") => {
    const objectives = activeObjectiveItems(state.agent);
    const selected = objectives.length ? objectives[Math.min(state.objectiveCursor, objectives.length - 1)] : null;
    const title = state.input.trim();
    if (action === "create" && !title) {
      patchState({ error: "Type an objective title before pressing tab." });
      return;
    }
    if (action === "complete" && !selected?.id) {
      patchState({ error: "No active objective selected." });
      return;
    }
    patchState({ loading: true, error: null, activity: action === "create" ? "Creating objective..." : "Completing objective..." });
    try {
      const { gateway } = state.gateway
        ? { gateway: state.gateway }
        : await connectGateway();
      if (action === "create") {
        await gateway.client.agentObjectives({ action: "create", itemKind: "objective", title });
      } else {
        await gateway.client.agentObjectives({ action: "complete", id: selected.id });
      }
      const response = await gateway.client.agentStatus();
      patchState({
        agent: response.agent,
        input: action === "create" ? "" : state.input,
        objectiveCursor: objectiveCursorAction("", state.objectiveCursor, activeObjectiveItems(response.agent).length),
        loading: false,
        activity: null,
      });
    } catch (error) {
      patchState({ error: error instanceof Error ? error.message : String(error), loading: false, activity: null });
    }
  }, [connectGateway, patchState, state.agent, state.gateway, state.input, state.objectiveCursor]);

  const loadProfiles = useCallback(async () => {
    patchState({ loading: true, error: null });
    try {
      const { gateway, config } = state.gateway && state.config
        ? { gateway: state.gateway, config: state.config }
        : await connectGateway();
      const guidance = setupGuidance(config);
      if (guidance) {
        patchState({ error: guidance, loading: false });
        return;
      }
      const response = await gateway.client.profiles();
      const profiles = response.profiles ?? [];
      const selectedIndex = profiles.findIndex((profile) => profile.profileId === config.selectedProfileId || profile.selected);
      patchState({ profiles, profileCursor: Math.max(0, selectedIndex), loading: false });
    } catch (error) {
      patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  }, [connectGateway, patchState, state.config, state.gateway]);

  const loadOverview = useCallback(async () => {
    patchState({ loading: true, error: null });
    try {
      const { gateway, config } = state.gateway && state.config
        ? { gateway: state.gateway, config: state.config }
        : await connectGateway();
      const guidance = setupGuidance(config, true);
      if (guidance) {
        patchState({ error: guidance, loading: false });
        return;
      }
      const response = await gateway.client.overview();
      patchState({ overview: response.overview, loading: false });
    } catch (error) {
      patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  }, [connectGateway, patchState, state.config, state.gateway]);

  const runDebugAction = useCallback(async () => {
    const action = DEBUG_ACTIONS[state.debugCursor];
    patchState({ loading: true, error: null, debugResult: null });
    try {
      const { gateway, config } = state.gateway && state.config
        ? { gateway: state.gateway, config: state.config }
        : await connectGateway();
      const guidance = action.endpoint === "profiles"
        ? setupGuidance(config)
        : action.endpoint === "overview"
          ? setupGuidance(config, true)
          : null;
      if (guidance) {
        patchState({ error: guidance, loading: false });
        return;
      }
      const response = action.endpoint === "version"
        ? await gateway.client.version()
        : action.endpoint === "config"
          ? await gateway.client.config()
          : action.endpoint === "profiles"
            ? await gateway.client.profiles()
            : await gateway.client.overview();
      patchState({
        loading: false,
        debugResult: {
          endpoint: action.endpoint,
          keys: response && typeof response === "object" ? Object.keys(response) : [],
          response,
        },
      });
    } catch (error) {
      patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
    }
  }, [connectGateway, patchState, state.config, state.debugCursor, state.gateway]);

  const refreshActive = useCallback(async () => {
    const active = MENU[state.menuIndex].id;
    if (active === "profiles") {
      await loadProfiles();
    } else if (active === "overview") {
      await loadOverview();
    } else if (active === "agent") {
      patchState({ loading: true, error: null, activity: "Refreshing context capsule..." });
      try {
        const { gateway } = state.gateway
          ? { gateway: state.gateway }
          : await connectGateway();
        const response = await gateway.client.refreshAgentContext({ allowStale: true });
        patchState({ agent: response.agent, loading: false, activity: null });
      } catch (error) {
        patchState({ error: error instanceof Error ? error.message : String(error), loading: false, activity: null });
      }
    } else if (active === "status" || active === "advanced") {
      patchState({ loading: true, error: null });
      try {
        await connectGateway();
        patchState({ loading: false });
      } catch (error) {
        patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
      }
    }
  }, [connectGateway, loadOverview, loadProfiles, patchState, state.menuIndex]);

  const selectActive = useCallback(async () => {
    const active = MENU[state.menuIndex].id;
    if (active === "profiles" && state.profiles[state.profileCursor]) {
      patchState({ loading: true, error: null });
      try {
        const { gateway } = state.gateway
          ? { gateway: state.gateway }
          : await connectGateway();
        const selectedProfileId = state.profiles[state.profileCursor].profileId;
        const configResponse = await gateway.client.setConfig({ selectedProfileId });
        const overviewResponse = await gateway.client.overview();
        patchState({
          config: configResponse.config,
          overview: overviewResponse.overview,
          loading: false,
          menuIndex: MENU.findIndex((item) => item.id === "overview"),
        });
      } catch (error) {
        patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
      }
    } else if (active === "debug") {
      await runDebugAction();
    } else if (active === "agent") {
      await sendAgentMessage();
    } else {
      await refreshActive();
    }
  }, [connectGateway, patchState, refreshActive, runDebugAction, sendAgentMessage, state.gateway, state.menuIndex, state.profileCursor, state.profiles]);

  useInput((input, key) => {
    if (state.loading) {
      return;
    }
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    if (agentRefreshShortcut(input, key)) {
      void refreshActive();
      return;
    }
    const active = MENU[state.menuIndex].id;
    if (key.return) {
      void selectActive();
      return;
    }
    if (active === "agent" && !state.input && (input === "[" || input === "]")) {
      setState((current) => ({
        ...current,
        objectiveCursor: objectiveCursorAction(input, current.objectiveCursor, activeObjectiveItems(current.agent).length),
      }));
      return;
    }
    if (active === "agent" && (key.tab || objectiveActionLabel(input) === "create")) {
      void runObjectiveAction("create");
      return;
    }
    if (active === "agent" && !state.input && objectiveActionLabel(input) === "complete") {
      void runObjectiveAction("complete");
      return;
    }
    if (active === "agent" && (key.backspace || (key as { delete?: boolean }).delete)) {
      setState((current) => ({ ...current, input: current.input.slice(0, -1) }));
      return;
    }
    if (active === "agent" && agentShouldAppendPrintableInput(input, state.input, key)) {
      const result = agentInputAction(input, state.input);
      if (result.action === "quit") {
        exit();
      } else {
        setState((current) => ({ ...current, input: result.input }));
      }
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (key.upArrow || input === "k") {
      setState((current) => ({ ...current, menuIndex: (current.menuIndex - 1 + MENU.length) % MENU.length }));
    } else if (key.downArrow || input === "j") {
      setState((current) => ({ ...current, menuIndex: (current.menuIndex + 1) % MENU.length }));
    } else if (key.leftArrow || input === "h") {
      setState((current) => {
        const active = MENU[current.menuIndex].id;
        if (active === "profiles" && current.profiles.length) {
          return { ...current, profileCursor: (current.profileCursor - 1 + current.profiles.length) % current.profiles.length };
        }
        if (active === "debug") {
          return { ...current, debugCursor: (current.debugCursor - 1 + DEBUG_ACTIONS.length) % DEBUG_ACTIONS.length };
        }
        return current;
      });
    } else if (key.rightArrow || input === "l") {
      setState((current) => {
        const active = MENU[current.menuIndex].id;
        if (active === "profiles" && current.profiles.length) {
          return { ...current, profileCursor: (current.profileCursor + 1) % current.profiles.length };
        }
        if (active === "debug") {
          return { ...current, debugCursor: (current.debugCursor + 1) % DEBUG_ACTIONS.length };
        }
        return current;
      });
    }
  });

  useEffect(() => {
    const active = MENU[state.menuIndex].id;
    if (active === "status") {
      patchState({ error: null });
    }
  }, [patchState, state.menuIndex]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      patchState({ loading: true, error: null });
      try {
        const session = await connectTuiGateway();
        if (!cancelled) {
          patchState({ gateway: session.gateway, config: session.config, agent: session.agent, loading: false });
        }
      } catch (error) {
        if (!cancelled) {
          patchState({ error: error instanceof Error ? error.message : String(error), loading: false });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [patchState]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <ActiveScreen state={state} />
      <Menu activeIndex={state.menuIndex} />
    </Box>
  );
}

export async function runInteractiveTui() {
  const instance = render(<SkyAgentTuiApp />);
  await instance.waitUntilExit();
}

export async function runTui(args = process.argv.slice(2)) {
  if (args.includes("--smoke") || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stdout.write(`${JSON.stringify(tuiSnapshot(), null, 2)}\n`);
    return;
  }
  await runInteractiveTui();
}
