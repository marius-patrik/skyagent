import {
  completeObjectiveItem,
  createObjectiveItem,
  dataDir,
  listObjectiveItems,
  objectiveContextSummary,
  readJson,
  startSkyAgentSession,
  streamLlmChat,
  updateObjectiveItem,
  type LlmMessage,
} from "@skyagent/core";
import fs from "node:fs";
import path from "node:path";

type AgentDeps = {
  startSkyAgentSession: typeof startSkyAgentSession;
  streamLlmChat: typeof streamLlmChat;
  listObjectiveItems: typeof listObjectiveItems;
  objectiveContextSummary: typeof objectiveContextSummary;
  createObjectiveItem: typeof createObjectiveItem;
  updateObjectiveItem: typeof updateObjectiveItem;
  completeObjectiveItem: typeof completeObjectiveItem;
};

export type AgentRuntimeDeps = Partial<AgentDeps> & {
  sessionPath?: string | null;
};

type AgentMessage = {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt: string;
};

type AgentSession = {
  id: string;
  startedAt: string;
  updatedAt: string;
  startup: any;
  messages: AgentMessage[];
};

type PendingToolCall = {
  id: string;
  name: string | null;
  argumentsText: string;
};

const MAX_PROVIDER_HISTORY_MESSAGES = 16;
const MAX_PROVIDER_MESSAGE_CHARS = 4_000;

const defaultDeps: AgentDeps = {
  startSkyAgentSession,
  streamLlmChat,
  listObjectiveItems,
  objectiveContextSummary,
  createObjectiveItem,
  updateObjectiveItem,
  completeObjectiveItem,
};

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function stableId(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedSelection(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function matchesSelection(requested: unknown, values: unknown[]) {
  const normalized = normalizedSelection(requested);
  if (!normalized) return true;
  return values.some((value) => normalizedSelection(value) === normalized);
}

function persistedStartupIsStale(startup: any) {
  const cache = startup?.context?.cache ?? startup?.freshness ?? null;
  return cache?.stale === true
    || cache?.status === "stale"
    || startup?.providerStatus?.profile?.status === "stale";
}

function canReuseSessionForInput(active: AgentSession | null, input: Record<string, any>) {
  if (!active || input.refresh || input.force) return false;
  if (persistedStartupIsStale(active.startup) && !(input.cacheOnly && input.allowStale)) {
    return false;
  }
  return matchesSelection(input.player, [
    active.startup?.player?.input,
    active.startup?.player?.username,
    active.startup?.player?.uuid,
  ]) && matchesSelection(input.profile, [
    active.startup?.selectedProfile?.profileId,
    active.startup?.selectedProfile?.profileUuid,
    active.startup?.selectedProfile?.cuteName,
    active.startup?.selectedProfile?.name,
  ]);
}

function compactJson(value: unknown, maxLength = 16_000) {
  const text = JSON.stringify(value, null, 2);
  return text.length > maxLength ? `${text.slice(0, maxLength)}\n...[truncated]` : text;
}

function redactProviderContent(value: string) {
  return value
    .replace(/bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer redacted")
    .replace(/(authorization\s*[:=]\s*)[^\s,}]+/gi, "$1redacted")
    .replace(/(["']?(?:api[_-]?key|token|secret|password|auth)["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, "$1redacted")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "sk-redacted");
}

function boundedProviderContent(message: AgentMessage) {
  let content = redactProviderContent(message.content);
  if (message.role === "assistant" && content.includes("Objective actions executed:")) {
    content = content.split("Objective actions executed:")[0]?.trim() || "[previous objective tool summary omitted]";
  }
  return content.length > MAX_PROVIDER_MESSAGE_CHARS
    ? `${content.slice(0, MAX_PROVIDER_MESSAGE_CHARS)}\n...[truncated for provider context]`
    : content;
}

function providerMessages(messages: AgentMessage[]): LlmMessage[] {
  const system = messages.find((message) => message.role === "system");
  const recent = messages
    .filter((message) => message.role !== "system")
    .slice(-MAX_PROVIDER_HISTORY_MESSAGES + (system ? 1 : 0));
  return [...(system ? [system] : []), ...recent].map((message) => ({
    role: message.role,
    content: boundedProviderContent(message),
  }));
}

function assistantToolCallMessage(content: string, toolResults: ReturnType<typeof formatToolResults>): LlmMessage {
  return {
    role: "assistant" as const,
    content,
    tool_calls: toolResults.map((result) => ({
      id: result.id,
      type: "function",
      function: {
        name: result.name,
        arguments: JSON.stringify(result.arguments),
      },
    })),
  };
}

function toolResultMessages(toolResults: ReturnType<typeof formatToolResults>): LlmMessage[] {
  return toolResults.map((result) => ({
    role: "tool" as const,
    tool_call_id: result.id,
    name: result.name,
    content: compactJson(result.result, 4_000),
  }));
}

function formatToolResults(results: Array<{ id: string; name: string; arguments: Record<string, any>; result: unknown }>) {
  return results;
}

function objectiveTools() {
  return [
    {
      type: "function" as const,
      function: {
        name: "skyagent_objective_list",
        description: "List tracked SkyAgent objectives, tasks, buy targets, source items, and snipes.",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["objective", "task", "buy", "source", "snipe"] },
            status: { type: "string" },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "skyagent_objective_create",
        description: "Create a tracked SkyAgent objective, task, buy target, source item, or snipe.",
        parameters: {
          type: "object",
          required: ["title"],
          properties: {
            itemKind: { type: "string", enum: ["objective", "task", "buy", "source", "snipe"] },
            title: { type: "string" },
            notes: { type: "string" },
            priority: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
            itemId: { type: "string" },
            targetPrice: { type: "number" },
            budget: { type: "number" },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "skyagent_objective_update",
        description: "Update an existing tracked SkyAgent objective item by id.",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            notes: { type: "string" },
            status: { type: "string" },
            priority: { type: "number" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "skyagent_objective_complete",
        description: "Mark an existing tracked SkyAgent objective item complete by id.",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            notes: { type: "string" },
          },
        },
      },
    },
  ];
}

function mergeToolCallDeltas(pending: Map<string, PendingToolCall>, toolCalls: unknown[]) {
  for (const raw of toolCalls) {
    if (!raw || typeof raw !== "object") continue;
    const call = raw as any;
    const key = String(call.index ?? call.id ?? call.item_id ?? call.call_id ?? pending.size);
    const id = String(call.id ?? call.item_id ?? call.call_id ?? key);
    const existing = pending.get(key) ?? { id, name: null, argumentsText: "" };
    if (call.id || call.item_id || call.call_id) existing.id = id;
    const name = call.function?.name ?? call.name;
    if (typeof name === "string" && name) existing.name = name;
    const argumentDelta = call.function?.arguments ?? call.arguments ?? call.delta;
    if (typeof argumentDelta === "string") existing.argumentsText += argumentDelta;
    pending.set(key, existing);
  }
}

function parseToolArguments(text: string) {
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { title: text.trim() };
  }
}

function agentSessionPath() {
  return path.join(dataDir(), "agent", "session.json");
}

function validMessage(message: any): message is AgentMessage {
  return Boolean(
    message
    && ["system", "user", "assistant"].includes(message.role)
    && typeof message.id === "string"
    && typeof message.content === "string"
    && typeof message.createdAt === "string",
  );
}

function redactPersistedString(value: string) {
  return redactProviderContent(value)
    .replace(/Bearer\s+[^\s,}]+/gi, "Bearer redacted")
    .replace(/\b[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}\b/g, "token-redacted");
}

function redactPersistedValue(value: unknown): unknown {
  if (typeof value === "string") {
    return redactPersistedString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactPersistedValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/(api[_-]?key|token|secret|password|authorization|auth)/i.test(key)) {
      redacted[key] = entry ? "redacted" : entry;
    } else {
      redacted[key] = redactPersistedValue(entry);
    }
  }
  return redacted;
}

function writePrivateAgentSession(file: string, value: AgentSession) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // Best effort on platforms/filesystems that do not support POSIX modes.
  }
  const temporary = path.join(dir, `${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(redactPersistedValue(value), null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(temporary, 0o600);
  } catch {
    // Best effort on Windows.
  }
  fs.renameSync(temporary, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // Best effort on Windows.
  }
}

function readPersistedSession(file: string | null): AgentSession | null {
  if (!file) return null;
  const stored = readJson<any>(file, null);
  if (!stored || typeof stored !== "object") return null;
  if (typeof stored.id !== "string" || typeof stored.startedAt !== "string" || typeof stored.updatedAt !== "string") {
    return null;
  }
  if (!Array.isArray(stored.messages) || !stored.messages.every(validMessage)) {
    return null;
  }
  return {
    id: stored.id,
    startedAt: stored.startedAt,
    updatedAt: stored.updatedAt,
    startup: stored.startup ?? null,
    messages: stored.messages,
  };
}

function systemPrompt(startup: any) {
  return [
    "You are SkyAgent, a persistent local Hypixel SkyBlock assistant.",
    "Use the provided context capsule before asking the user for facts that are already known.",
    "Be proactive: surface likely blockers, next checks, concrete commands, and objective updates.",
    "Use skyagent_objective_* tools when the user asks to create, list, update, complete, or track objectives.",
    "When context is stale or incomplete, say what is stale and request or trigger a refresh through SkyAgent.",
    "Do not invent exact prices, meta claims, profile state, or API fields when the capsule marks them missing.",
    "Current SkyAgent context capsule:",
    compactJson({
      generatedAt: startup?.generatedAt,
      player: startup?.player,
      selectedProfile: startup?.selectedProfile,
      freshnessPolicy: startup?.freshnessPolicy,
      cache: startup?.context?.cache,
      sections: startup?.context?.sections,
      objectives: startup?.objectives,
      serverStatus: startup?.serverStatus,
      providerStatus: startup?.providerStatus,
      warnings: startup?.warnings,
      followUpTools: startup?.followUpTools,
    }),
  ].join("\n\n");
}

export function createAgentRuntime(depsInput: AgentRuntimeDeps = {}) {
  const deps = { ...defaultDeps, ...depsInput };
  const sessionPath = depsInput.sessionPath === null ? null : depsInput.sessionPath ?? agentSessionPath();
  let session: AgentSession | null = readPersistedSession(sessionPath);

  function persistSession() {
    if (session && sessionPath) {
      writePrivateAgentSession(sessionPath, session);
    }
  }

  function deletePersistedSession() {
    if (sessionPath) {
      fs.rmSync(sessionPath, { force: true });
    }
  }

  function setSystemPrompt(startup: any) {
    if (!session) return;
    const system = {
      id: stableId("msg"),
      role: "system" as const,
      content: systemPrompt(startup),
      createdAt: nowIso(),
    };
    const withoutSystem = session.messages.filter((message) => message.role !== "system");
    session.messages = [system, ...withoutSystem];
    persistSession();
  }

  async function refreshStartup(input: Record<string, any> = {}) {
    if (!session) {
      await start(input);
      return publicSession();
    }
    const startup = await deps.startSkyAgentSession({
      ...input,
      refresh: input.refresh ?? true,
      allowStale: input.allowStale ?? true,
      sourceKind: input.sourceKind ?? "gateway",
      sourceId: input.sourceId ?? "persistent-agent-refresh",
      sourceTransport: input.sourceTransport ?? "http",
    });
    session.startup = startup;
    session.updatedAt = nowIso(input.now);
    setSystemPrompt(startup);
    persistSession();
    return publicSession();
  }

  function syncObjectiveSummary() {
    if (session) {
      session.startup = {
        ...session.startup,
        objectives: deps.objectiveContextSummary(),
      };
      session.updatedAt = nowIso();
      setSystemPrompt(session.startup);
      persistSession();
    }
  }

  function publicSession() {
    if (!session) {
      return {
        running: false,
        ready: false,
        history: [],
        messageCount: 0,
      };
    }
    return {
      running: true,
      ready: true,
      id: session.id,
      startedAt: session.startedAt,
      updatedAt: session.updatedAt,
      player: session.startup?.player ?? null,
      selectedProfile: session.startup?.selectedProfile ?? null,
      freshness: session.startup?.context?.cache ?? null,
      objectives: session.startup?.objectives ?? deps.objectiveContextSummary(),
      providerStatus: session.startup?.providerStatus ?? null,
      warnings: session.startup?.warnings ?? [],
      messageCount: session.messages.filter((message) => message.role !== "system").length,
      history: session.messages.filter((message) => message.role !== "system"),
    };
  }

  async function start(input: Record<string, any> = {}) {
    if (canReuseSessionForInput(session, input)) {
      return publicSession();
    }
    const startup = await deps.startSkyAgentSession({
      ...input,
      sourceKind: input.sourceKind ?? "gateway",
      sourceId: input.sourceId ?? "persistent-agent",
      sourceTransport: input.sourceTransport ?? "http",
    });
    const startedAt = nowIso(input.now);
    session = {
      id: input.sessionId ?? stableId("agent"),
      startedAt,
      updatedAt: startedAt,
      startup,
      messages: [{
        id: stableId("msg"),
        role: "system",
        content: systemPrompt(startup),
        createdAt: startedAt,
      }],
    };
    persistSession();
    return publicSession();
  }

  async function refreshContext(input: Record<string, any> = {}) {
    return refreshStartup({ ...input, refresh: true });
  }

  function stop() {
    session = null;
    deletePersistedSession();
    return publicSession();
  }

  function history() {
    return publicSession();
  }

  async function* message(input: Record<string, any> = {}) {
    if (!session) {
      await start(input.start ?? {});
    }
    if (!session) {
      throw new Error("Agent session did not start.");
    }
    if (input.refreshContext || session.startup?.context?.cache?.stale) {
      await refreshStartup({ ...(input.start ?? {}), refresh: true, allowStale: true });
    }
    const text = String(input.message ?? "").trim();
    if (!text) {
      throw new Error("Agent message is required.");
    }
    const createdAt = nowIso(input.now);
    const userMessage: AgentMessage = {
      id: stableId("msg"),
      role: "user",
      content: text,
      createdAt,
    };
    session.messages.push(userMessage);
    session.updatedAt = createdAt;
    persistSession();

    const assistantMessage: AgentMessage = {
      id: stableId("msg"),
      role: "assistant",
      content: "",
      createdAt: nowIso(input.now),
    };

    yield { type: "agent_start", session: publicSession() };
    yield { type: "activity", message: "Sending context and history through LiteLLM." };

    const pendingToolCalls = new Map<string, PendingToolCall>();
    const requestMessages = providerMessages(session.messages);
    for await (const event of deps.streamLlmChat({
      messages: requestMessages,
      tools: objectiveTools(),
      toolChoice: "auto",
      temperature: input.temperature ?? 0.2,
      maxTokens: input.maxTokens,
    }, { streamApi: input.streamApi })) {
      if (event.type === "text_delta") {
        assistantMessage.content += event.text;
      }
      if (event.type === "tool_call_delta") {
        mergeToolCallDeltas(pendingToolCalls, event.toolCalls);
      }
      yield event;
    }

    const toolResults = formatToolResults(executeObjectiveToolCalls([...pendingToolCalls.values()]));
    if (toolResults.length > 0) {
      yield { type: "activity", message: `Executed ${toolResults.length} objective action${toolResults.length === 1 ? "" : "s"}.` };
      for (const result of toolResults) {
        yield { type: "tool_result", ...result };
      }
      yield { type: "activity", message: "Sending objective results back through LiteLLM." };
      let followUpText = "";
      for await (const event of deps.streamLlmChat({
        messages: [
          ...requestMessages,
          assistantToolCallMessage(assistantMessage.content, toolResults),
          ...toolResultMessages(toolResults),
        ],
        tools: objectiveTools(),
        toolChoice: "none",
        temperature: input.temperature ?? 0.2,
        maxTokens: input.maxTokens,
      }, { streamApi: input.streamApi })) {
        if (event.type === "text_delta") {
          followUpText += event.text;
        }
        yield event;
      }
      if (followUpText.trim()) {
        assistantMessage.content = followUpText.trim();
      } else if (!assistantMessage.content.trim()) {
        assistantMessage.content = "Objective actions executed, but the provider returned no follow-up text.";
      }
    }

    session.messages.push(assistantMessage);
    session.updatedAt = nowIso(input.now);
    persistSession();
    yield { type: "agent_done", message: assistantMessage, session: publicSession() };
  }

  function executeObjectiveToolCalls(calls: PendingToolCall[]) {
    const results = [];
    for (const call of calls) {
      const name = call.name;
      if (!name?.startsWith("skyagent_objective_")) continue;
      let args: Record<string, any> = {};
      try {
        args = parseToolArguments(call.argumentsText) as Record<string, any>;
        let result: unknown;
        if (name === "skyagent_objective_list") {
          result = deps.listObjectiveItems(args);
        } else if (name === "skyagent_objective_create") {
          result = deps.createObjectiveItem(args);
        } else if (name === "skyagent_objective_update") {
          const { id, patch, ...rest } = args;
          if (!id) throw new Error("skyagent_objective_update requires id.");
          result = deps.updateObjectiveItem(id, patch && typeof patch === "object" ? patch : rest);
        } else if (name === "skyagent_objective_complete") {
          const { id, patch, ...rest } = args;
          if (!id) throw new Error("skyagent_objective_complete requires id.");
          result = deps.completeObjectiveItem(id, patch && typeof patch === "object" ? patch : rest);
        } else {
          continue;
        }
        syncObjectiveSummary();
        results.push({ id: call.id, name, arguments: args, result });
      } catch (error) {
        results.push({
          id: call.id,
          name,
          arguments: args,
          result: {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
    return results;
  }

  function objectives(action: string, input: Record<string, any> = {}) {
    if (action === "list") {
      const listed = deps.listObjectiveItems(input);
      syncObjectiveSummary();
      return listed;
    }
    let result: unknown;
    if (action === "create") {
      result = deps.createObjectiveItem(input);
      syncObjectiveSummary();
      return result;
    }
    if (action === "update") {
      if (!input.id) throw new Error("Objective id is required.");
      result = deps.updateObjectiveItem(String(input.id), input.patch ?? input);
      syncObjectiveSummary();
      return result;
    }
    if (action === "complete") {
      if (!input.id) throw new Error("Objective id is required.");
      result = deps.completeObjectiveItem(String(input.id), input.patch ?? {});
      syncObjectiveSummary();
      return result;
    }
    throw new Error("Supported objective actions: list, create, update, complete.");
  }

  return {
    start,
    stop,
    refreshContext,
    history,
    message,
    objectives,
  };
}
