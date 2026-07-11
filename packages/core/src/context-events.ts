import fs from "node:fs";
import path from "node:path";
import { hypixelRequest, uuidFromNameOrUuid } from "./hypixel.ts";
import { providerStatus } from "./providers.ts";
import { ensureDataDir } from "./store.ts";

export const DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT = 200;

export type ContextEventSourceKind = "agent" | "cli" | "mcp" | "hypixel-api" | "profile-snapshot" | "provider-cache" | "minecraft-mod" | string;

export type ContextEventSource = {
  kind: ContextEventSourceKind;
  id: string | null;
  transport: string | null;
};

export type ContextEventFreshness = {
  status: "fresh" | "hit" | "stale" | "local" | "error" | "unknown" | string;
  fetchedAt: string | null;
  source: string;
  rateLimit: any;
  warnings: Array<{ code: string; message: string; sourcePath: string | null }>;
};

export type ContextEventProvenance = {
  producer: string;
  version: string;
  provider: string | null;
  futureProducer: {
    kind: "minecraft-mod-telemetry";
    status: "reserved";
    expectedFields: string[];
  };
};

export type ContextEvent = {
  kind: "skyagent.contextEvent";
  schemaVersion: 1;
  id: string;
  sequence: number;
  type: string;
  source: ContextEventSource;
  timestamp: string;
  player: any;
  profile: any;
  payload: Record<string, any>;
  freshness: ContextEventFreshness;
  provenance: ContextEventProvenance;
};

export type ContextEventBatch = {
  kind: "skyagent.contextEventBatch";
  schemaVersion: 1;
  generatedAt: string;
  sinceSequence: number;
  latestSequence: number;
  limit: number;
  events: ContextEvent[];
};

export type ServerStatus = {
  kind: "skyagent.serverStatus";
  schemaVersion: 1;
  generatedAt: string;
  player: { input: string | null; uuid: string | null };
  api: { available: boolean | null; status: number | null; url: string | null; rateLimit: any };
  online: boolean | null;
  session: { gameType: string | null; mode: string | null; map: string | null };
  providers: any;
  warnings: Array<{ code: string; message: string; sourcePath?: string }>;
};

let nextSequence = 1;
const lastServerStatusSignatures = new Map<string, string>();
let lastProviderStatusSignature: string | null = null;
const liveReadSequenceAssignments = new Map<string, number>();
const REDACTED_SECRET_STATUS_KEYS = new Set(["apiKeyConfigured", "apiKeySource", "authSource"]);
const MINECRAFT_EVENT_TYPES = new Set([
  "minecraft.location_update",
  "minecraft.inventory_delta",
  "minecraft.objective_progress",
  "minecraft.chat_signal",
  "minecraft.terminal_session",
  "minecraft.telemetry",
]);

function nowIso(now = Date.now()) {
  return new Date(now).toISOString();
}

function compactWarning(warning: any) {
  return {
    code: warning?.code ?? "warning",
    message: warning?.message ?? String(warning),
    sourcePath: warning?.sourcePath ?? warning?.source ?? null,
  };
}

function eventId(sequence: number) {
  return `ctx-${sequence.toString(36).padStart(6, "0")}`;
}

function eventMergeKey(event: ContextEvent) {
  return `${event.id}\u0000${event.sequence}\u0000${event.type}\u0000${event.timestamp}\u0000${event.source.kind}\u0000${event.source.id ?? ""}`;
}

function liveReadAssignmentKey(event: ContextEvent) {
  return `${event.type}\u0000${event.timestamp}\u0000${event.source.kind}\u0000${event.source.id ?? ""}\u0000${event.source.transport ?? ""}\u0000${JSON.stringify(event.payload ?? null)}`;
}

function normalizeSinceSequence(options: Record<string, any> = {}) {
  const since = Number(options.sinceSequence ?? options.since ?? 0);
  return Number.isFinite(since) ? Math.max(0, since) : 0;
}

function isRawSecretScalarKey(key: string) {
  if (REDACTED_SECRET_STATUS_KEYS.has(key)) return false;
  const normalized = key.replace(/[-_\s]/g, "").toLowerCase();
  return normalized === "apikey"
    || normalized === "token"
    || normalized.endsWith("token")
    || normalized.includes("secret")
    || normalized === "password"
    || normalized.includes("authorization")
    || normalized === "bearer";
}

function assertNoSecretKeys(value: any, path = "payload") {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const currentPath = `${path}.${key}`;
    if (isRawSecretScalarKey(key)) {
      throw new Error(`Context event payload contains disallowed secret-like field: ${currentPath}`);
    }
    assertNoSecretKeys(nested, currentPath);
  }
}

function normalizeMinecraftModPayload(type: string, payload: Record<string, any>) {
  if (!MINECRAFT_EVENT_TYPES.has(type)) {
    throw new Error(`Unsupported minecraft-mod context event type: ${type}`);
  }
  if (typeof payload.sessionId !== "string" || payload.sessionId.length === 0) {
    throw new Error("minecraft-mod context events require payload.sessionId.");
  }
  if (type === "minecraft.location_update" && !payload.location) {
    throw new Error("minecraft.location_update requires payload.location.");
  }
  if (type === "minecraft.inventory_delta" && !Array.isArray(payload.inventoryDelta)) {
    throw new Error("minecraft.inventory_delta requires payload.inventoryDelta.");
  }
  if (type === "minecraft.objective_progress" && !payload.objectiveProgress) {
    throw new Error("minecraft.objective_progress requires payload.objectiveProgress.");
  }
  if (type === "minecraft.chat_signal" && !payload.signal) {
    throw new Error("minecraft.chat_signal requires payload.signal.");
  }
  if (type === "minecraft.terminal_session" && !payload.terminal) {
    throw new Error("minecraft.terminal_session requires payload.terminal.");
  }
  if (type === "minecraft.telemetry" && Object.keys(payload).length <= 1) {
    throw new Error("minecraft.telemetry requires at least one telemetry field besides payload.sessionId.");
  }
  return payload;
}

function validateContextEventInput(input: Record<string, any>) {
  const sourceKind = input.source?.kind ?? input.source ?? "agent";
  const payload = input.payload ?? {};
  assertNoSecretKeys(payload);
  if (sourceKind === "minecraft-mod") {
    if (input.source?.transport !== "localhost") {
      throw new Error('minecraft-mod context events require source.transport "localhost".');
    }
    if (typeof input.source?.id !== "string" || input.source.id.length === 0) {
      throw new Error("minecraft-mod context events require source.id.");
    }
    normalizeMinecraftModPayload(input.type ?? "context.note", payload);
  }
  return { sourceKind, payload };
}

export function normalizeContextEvent(input: Record<string, any>, options: Record<string, any> = {}): ContextEvent {
  const validation = validateContextEventInput(input);
  const sequence = options.sequence ?? nextSequence++;
  const timestamp = input.timestamp ?? nowIso(options.now);
  return {
    kind: "skyagent.contextEvent",
    schemaVersion: 1,
    id: input.id ?? eventId(sequence),
    sequence,
    type: input.type ?? "context.note",
    source: {
      kind: validation.sourceKind,
      id: input.source?.id ?? null,
      transport: input.source?.transport ?? null,
    },
    timestamp,
    player: input.player ?? null,
    profile: input.profile ?? null,
    payload: validation.payload,
    freshness: {
      status: input.freshness?.status ?? "unknown",
      fetchedAt: input.freshness?.fetchedAt ?? timestamp,
      source: input.freshness?.source ?? input.source?.kind ?? input.source ?? "local",
      rateLimit: input.freshness?.rateLimit ?? null,
      warnings: (input.freshness?.warnings ?? input.warnings ?? []).map(compactWarning),
    },
    provenance: {
      producer: input.provenance?.producer ?? "skyagent",
      version: input.provenance?.version ?? "context-event-v1",
      provider: input.provenance?.provider ?? null,
      futureProducer: input.provenance?.futureProducer ?? {
        kind: "minecraft-mod-telemetry",
        status: "reserved",
        expectedFields: ["modId", "minecraftVersion", "sessionId", "world", "location", "inventoryDelta", "objectiveProgress"],
      },
    },
  };
}

export class ContextEventBus {
  historyLimit: number;
  history: ContextEvent[];
  listeners: Set<(event: ContextEvent) => void>;

  constructor({ historyLimit = DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT } = {}) {
    this.historyLimit = historyLimit;
    this.history = [];
    this.listeners = new Set();
  }

  emit(input: Record<string, any>) {
    return this.emitNormalized(normalizeContextEvent(input));
  }

  emitNormalized(event: ContextEvent) {
    if (event.sequence >= nextSequence) {
      nextSequence = event.sequence + 1;
    }
    this.history.push(event);
    if (this.history.length > this.historyLimit) {
      this.history = this.history.slice(-this.historyLimit);
    }
    for (const listener of this.listeners) {
      listener(event);
    }
    return event;
  }

  read(options: Record<string, any> = {}): ContextEventBatch {
    const since = normalizeSinceSequence(options);
    const parsedLimit = Number(options.limit ?? this.historyLimit);
    const limit = Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : this.historyLimit;
    const type = options.type ?? null;
    const matchingEvents = this.history
      .filter((event) => event.sequence > since)
      .filter((event) => !type || event.type === type);
    const events = limit === 0 ? [] : matchingEvents.slice(-limit);
    return {
      kind: "skyagent.contextEventBatch",
      schemaVersion: 1,
      generatedAt: nowIso(options.now),
      sinceSequence: since,
      latestSequence: this.history.at(-1)?.sequence ?? 0,
      limit,
      events,
    };
  }

  subscribe(listener: (event: ContextEvent) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear() {
    this.history = [];
    this.listeners.clear();
    liveReadSequenceAssignments.clear();
  }
}

export function contextEventLogPath(options: Record<string, any> = {}) {
  return options.path ?? path.join(ensureDataDir(), "context-events.ndjson");
}

function readPersistedEvents(options: Record<string, any> = {}) {
  const file = contextEventLogPath(options);
  try {
    let previousSequence = 0;
    return fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ContextEvent)
      .filter((event) => event?.kind === "skyagent.contextEvent")
      .map((event) => {
        const storedSequence = Number(event.sequence);
        const sequence = Number.isFinite(storedSequence) && storedSequence > previousSequence ? storedSequence : previousSequence + 1;
        previousSequence = sequence;
        return { ...event, id: eventId(sequence), sequence };
      });
  } catch (error) {
    if ((error as any)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export function readPersistedContextEvents(options: Record<string, any> = {}) {
  const persisted = readPersistedEvents(options);
  const since = normalizeSinceSequence(options);
  const parsedLimit = Number(options.limit ?? DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT);
  const limit = Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT;
  const type = options.type ?? null;
  const matchingEvents = persisted
    .filter((event) => event.sequence > since)
    .filter((event) => !type || event.type === type);
  const events = limit === 0 ? [] : matchingEvents.slice(-limit);
  return {
    kind: "skyagent.contextEventBatch",
    schemaVersion: 1,
    generatedAt: nowIso(options.now),
    sinceSequence: since,
    latestSequence: persisted.at(-1)?.sequence ?? 0,
    limit,
    events,
  };
}

function maxPersistedSequence(options: Record<string, any> = {}) {
  return Math.max(0, ...readPersistedEvents(options).map((event) => event.sequence));
}

function ensureNextSequenceAfterPersisted(options: Record<string, any> = {}) {
  nextSequence = Math.max(nextSequence, maxPersistedSequence(options) + 1);
}

function nextPersistedSequence(options: Record<string, any> = {}) {
  return maxPersistedSequence(options) + 1;
}

function mergeLiveEventsAfterPersisted(persistedEvents: ContextEvent[], liveEvents: ContextEvent[]) {
  let previousSequence = Math.max(0, ...persistedEvents.map((event) => event.sequence));
  return liveEvents
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => {
      const assignmentKey = liveReadAssignmentKey(event);
      const existingSequence = liveReadSequenceAssignments.get(assignmentKey);
      const sequence = existingSequence !== undefined && existingSequence > previousSequence
        ? existingSequence
        : event.sequence > previousSequence ? event.sequence : previousSequence + 1;
      if (existingSequence !== sequence) {
        liveReadSequenceAssignments.set(assignmentKey, sequence);
      }
      previousSequence = Math.max(previousSequence, sequence);
      return sequence === event.sequence ? event : { ...event, id: eventId(sequence), sequence };
    });
}

export function persistContextEvent(input: Record<string, any>, options: Record<string, any> = {}) {
  const event = normalizeContextEvent(input, { ...options, sequence: nextPersistedSequence(options) });
  fs.mkdirSync(path.dirname(contextEventLogPath(options)), { recursive: true });
  fs.appendFileSync(contextEventLogPath(options), `${JSON.stringify(event)}\n`, "utf8");
  return contextEventBus.emitNormalized(event);
}

export const contextEventBus = new ContextEventBus();

export function emitContextEvent(input: Record<string, any>) {
  ensureNextSequenceAfterPersisted();
  return contextEventBus.emit(input);
}

export function readContextEvents(options: Record<string, any> = {}) {
  const persistedEvents = readPersistedEvents(options);
  const persistedKeys = new Set(persistedEvents.map(eventMergeKey));
  const live = contextEventBus.read({ ...options, sinceSequence: 0, limit: DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT });
  const liveEvents = live.events
    .filter((event) => !persistedKeys.has(eventMergeKey(event)));
  const mergedLiveEvents = mergeLiveEventsAfterPersisted(persistedEvents, liveEvents);
  const byEvent = new Map<string, ContextEvent>();
  for (const event of [...persistedEvents, ...mergedLiveEvents]) {
    byEvent.set(eventMergeKey(event), event);
  }
  const since = normalizeSinceSequence(options);
  const parsedLimit = Number(options.limit ?? DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT);
  const limit = Number.isFinite(parsedLimit) ? Math.max(0, parsedLimit) : DEFAULT_CONTEXT_EVENT_HISTORY_LIMIT;
  const type = options.type ?? null;
  const matchingEvents = [...byEvent.values()]
    .filter((event) => event.sequence > since)
    .filter((event) => !type || event.type === type)
    .sort((a, b) => a.sequence - b.sequence);
  const events = limit === 0 ? [] : matchingEvents.slice(-limit);
  return {
    kind: "skyagent.contextEventBatch",
    schemaVersion: 1,
    generatedAt: nowIso(options.now),
    sinceSequence: since,
    latestSequence: Math.max(...persistedEvents.map((event) => event.sequence), ...mergedLiveEvents.map((event) => event.sequence), 0),
    limit,
    events,
  };
}

export function subscribeContextEvents(listener: (event: ContextEvent) => void) {
  return contextEventBus.subscribe(listener);
}

export function emitProviderStatusEvent(status: any = providerStatus(), options: Record<string, any> = {}) {
  const event = emitContextEvent({
    type: "provider.cache_status",
    source: { kind: "provider-cache", id: options.id ?? "provider-status" },
    payload: status,
    freshness: {
      status: "local",
      fetchedAt: status.generatedAt ?? nowIso(options.now),
      source: "provider-status",
      warnings: status.warnings ?? [],
    },
    provenance: { provider: "skyagent-provider-status" },
  });
  const signature = JSON.stringify({
    providers: (status.providers ?? []).map((provider: any) => ({
      id: provider.id,
      status: provider.status,
      cache: provider.cache,
      warnings: (provider.warnings ?? []).map((warning: any) => warning.code),
    })),
    warnings: (status.warnings ?? []).map((warning: any) => warning.code),
  });
  if (options.forceChange || signature !== lastProviderStatusSignature) {
    lastProviderStatusSignature = signature;
    emitContextEvent({
      type: "provider.cache_status_change",
      source: { kind: "provider-cache", id: options.id ?? "provider-status" },
      payload: status,
      freshness: {
        status: "local",
        fetchedAt: status.generatedAt ?? nowIso(options.now),
        source: "provider-status",
        warnings: status.warnings ?? [],
      },
      provenance: { provider: "skyagent-provider-status" },
    });
  }
  return event;
}

export function providerStatusWithEvent(options: Record<string, any> = {}) {
  const readStatus = options.providerStatus ?? providerStatus;
  const status = readStatus();
  emitProviderStatusEvent(status, options);
  return status;
}

function statusWarning(code: string, message: string, sourcePath?: string) {
  return { code, message, sourcePath };
}

function localStatusError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Hypixel API key is required")) {
    return statusWarning("hypixel_api_key_required", message, "config.apiKey");
  }
  return null;
}

function statusSignature(status: ServerStatus) {
  return JSON.stringify({
    apiAvailable: status.api.available,
    online: status.online,
    session: status.session,
    warningCodes: status.warnings.map((warning) => warning.code),
  });
}

function statusKey(status: ServerStatus) {
  return status.player.uuid ?? status.player.input ?? "configured-player";
}

function emitServerStatusChangeIfNeeded(status: ServerStatus, options: Record<string, any> = {}) {
  const key = statusKey(status);
  const signature = statusSignature(status);
  if (!options.forceChange && lastServerStatusSignatures.get(key) === signature) {
    return null;
  }
  lastServerStatusSignatures.set(key, signature);
  return emitContextEvent({
    type: "hypixel.server_status_change",
    source: { kind: "hypixel-api", id: options.sourceId ?? "status" },
    player: status.player,
    payload: { online: status.online, session: status.session, api: status.api },
    freshness: {
      status: status.api.available === false || status.api.available === null ? "error" : "fresh",
      fetchedAt: status.generatedAt,
      source: options.source ?? "hypixel-status",
      rateLimit: status.api.rateLimit,
      warnings: status.warnings,
    },
    provenance: { provider: status.api.available === null ? "local-config" : "hypixel" },
  });
}

export async function serverStatusForPlayer(player?: string, options: Record<string, any> = {}): Promise<ServerStatus> {
  const generatedAt = nowIso(options.now);
  const resolveUuid = options.uuidFromNameOrUuid ?? uuidFromNameOrUuid;
  const request = options.hypixelRequest ?? hypixelRequest;
  const providers = options.providerStatus ?? providerStatus;
  let uuid = null;
  const warnings: any[] = [];

  try {
    uuid = await resolveUuid(player);
  } catch (error) {
    warnings.push(statusWarning(
      "player_resolution_error",
      error instanceof Error ? error.message : String(error),
      "player",
    ));
    const status: ServerStatus = {
      kind: "skyagent.serverStatus",
      schemaVersion: 1,
      generatedAt,
      player: { input: player ?? null, uuid: null },
      api: {
        available: null,
        status: null,
        url: null,
        rateLimit: null,
      },
      online: null,
      session: { gameType: null, mode: null, map: null },
      providers: providers(),
      warnings,
    };
    emitContextEvent({
      type: "hypixel.server_status_resolution_error",
      source: { kind: "agent", id: "server-status" },
      player: status.player,
      payload: { api: status.api },
      freshness: { status: "error", fetchedAt: generatedAt, source: "player-resolution", warnings },
      provenance: { provider: "local-config" },
    });
    if (options.emitChangeEvent !== false) {
      emitServerStatusChangeIfNeeded(status);
    }
    return status;
  }

  try {
    const response = await request("status", { uuid }, { requireKey: true });
    const session = response.body?.session ?? {};
    const result: ServerStatus = {
      kind: "skyagent.serverStatus",
      schemaVersion: 1,
      generatedAt,
      player: { input: player ?? null, uuid },
      api: {
        available: true,
        status: response.status,
        url: response.url,
        rateLimit: response.rateLimit,
      },
      online: Boolean(session.online),
      session: {
        gameType: session.gameType ?? null,
        mode: session.mode ?? null,
        map: session.map ?? null,
      },
      providers: providers(),
      warnings,
    };
    emitContextEvent({
      type: "hypixel.server_status",
      source: { kind: "hypixel-api", id: "status" },
      player: result.player,
      payload: { online: result.online, session: result.session },
      freshness: { status: "fresh", fetchedAt: generatedAt, source: "hypixel-status", rateLimit: response.rateLimit },
      provenance: { provider: "hypixel" },
    });
    if (options.emitChangeEvent !== false) {
      emitServerStatusChangeIfNeeded(result);
    }
    return result;
  } catch (error) {
    const localWarning = localStatusError(error);
    if (localWarning) {
      warnings.push(localWarning);
      const status: ServerStatus = {
        kind: "skyagent.serverStatus",
        schemaVersion: 1,
        generatedAt,
        player: { input: player ?? null, uuid },
        api: {
          available: null,
          status: null,
          url: null,
          rateLimit: null,
        },
        online: null,
        session: { gameType: null, mode: null, map: null },
        providers: providers(),
        warnings,
      };
      emitContextEvent({
        type: "hypixel.server_status_config_error",
        source: { kind: "agent", id: "server-status" },
        player: status.player,
        payload: { api: status.api },
        freshness: { status: "error", fetchedAt: generatedAt, source: "local-config", warnings },
        provenance: { provider: "local-config" },
      });
      if (options.emitChangeEvent !== false) {
        emitServerStatusChangeIfNeeded(status);
      }
      return status;
    }

    const result = (error as any)?.result;
    warnings.push(statusWarning(
      "hypixel_status_provider_error",
      error instanceof Error ? error.message : String(error),
      "hypixel.status",
    ));
    const status: ServerStatus = {
      kind: "skyagent.serverStatus",
      schemaVersion: 1,
      generatedAt,
      player: { input: player ?? null, uuid },
      api: {
        available: false,
        status: result?.status ?? null,
        url: result?.url ?? null,
        rateLimit: result?.rateLimit ?? null,
      },
      online: null,
      session: { gameType: null, mode: null, map: null },
      providers: providers(),
      warnings,
    };
    emitContextEvent({
      type: "hypixel.server_status_error",
      source: { kind: "hypixel-api", id: "status" },
      player: status.player,
      payload: { api: status.api },
      freshness: { status: "error", fetchedAt: generatedAt, source: "hypixel-status", warnings },
      provenance: { provider: "hypixel" },
    });
    if (options.emitChangeEvent !== false) {
      emitServerStatusChangeIfNeeded(status);
    }
    return status;
  }
}

export function createServerStatusMonitor(player?: string, options: Record<string, any> = {}) {
  const intervalMs = Math.max(1, Number(options.intervalMs ?? 30_000));
  const statusProvider = options.statusProvider ?? ((target?: string) => serverStatusForPlayer(target, { ...options, emitChangeEvent: false }));
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick() {
    const status = await statusProvider(player);
    emitServerStatusChangeIfNeeded(status, { sourceId: "status-monitor", source: "hypixel-status-monitor" });
    return status;
  }

  return {
    async start() {
      if (!timer) {
        if (options.emitInitial !== false) {
          await tick();
        }
        timer = setInterval(() => {
          tick().catch(() => {
            // serverStatusForPlayer converts provider errors into status events.
          });
        }, intervalMs);
      }
      return { running: true, intervalMs };
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      return { running: false };
    },
    tick,
  };
}
