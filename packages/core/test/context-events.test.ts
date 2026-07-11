import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { ContextEventBus, contextEventBus, createServerStatusMonitor, emitContextEvent, emitProviderStatusEvent, persistContextEvent, providerStatusWithEvent, readContextEvents, readPersistedContextEvents, serverStatusForPlayer } from "../src/context-events.ts";
import type { ContextEvent } from "../src/context-events.ts";

function tempEventLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-context-events-"));
  return path.join(dir, "context-events.ndjson");
}

describe("context events", () => {
  test("orders events and keeps bounded history for reconnect reads", () => {
    const bus = new ContextEventBus({ historyLimit: 3 });

    bus.emit({ type: "profile.refresh", source: { kind: "profile-snapshot" }, payload: { n: 1 } });
    const second = bus.emit({ type: "provider.cache", source: { kind: "provider-cache" }, payload: { n: 2 } });
    bus.emit({ type: "objective.progress", source: { kind: "agent" }, payload: { n: 3 } });
    bus.emit({
      type: "minecraft.telemetry",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "localhost" },
      payload: { sessionId: "session-1", n: 4 },
    });

    const batch = bus.read({ sinceSequence: second.sequence, limit: 10, now: 1_000 });

    expect(batch.events.map((event) => event.payload.n)).toEqual([3, 4]);
    expect(bus.read({ limit: 10 }).events.map((event) => event.payload.n)).toEqual([2, 3, 4]);
    expect(batch.events[0].provenance.futureProducer.expectedFields).toContain("inventoryDelta");
  });

  test("notifies subscribers for watch-style consumers", () => {
    const bus = new ContextEventBus({ historyLimit: 10 });
    const seen: string[] = [];
    const unsubscribe = bus.subscribe((event) => seen.push(event.type));

    bus.emit({ type: "cli.context_event", source: { kind: "cli" } });
    unsubscribe();
    bus.emit({ type: "mcp.context_event", source: { kind: "mcp" } });

    expect(seen).toEqual(["cli.context_event"]);
  });

  test("returns no events for explicit zero-limit reconnect reads", () => {
    const bus = new ContextEventBus({ historyLimit: 10 });
    bus.emit({ type: "one", source: { kind: "agent" } });
    bus.emit({ type: "two", source: { kind: "agent" } });

    const batch = bus.read({ limit: 0 });

    expect(batch.limit).toBe(0);
    expect(batch.events).toEqual([]);
    expect(batch.latestSequence).toBeGreaterThan(0);
  });

  test("normalizes malformed reconnect cursors to zero", () => {
    contextEventBus.clear();
    const logPath = tempEventLog();
    const persisted = persistContextEvent({
      type: "cli.persisted_cursor_test",
      source: { kind: "cli", transport: "command" },
      payload: { n: 1 },
    }, { path: logPath });
    const live = emitContextEvent({
      type: "provider.live_cursor_test",
      source: { kind: "provider-cache" },
      payload: { n: 2 },
    });

    const persistedBatch = readPersistedContextEvents({ path: logPath, sinceSequence: "not-a-number", limit: 10 });
    const mergedBatch = readContextEvents({ path: logPath, sinceSequence: "not-a-number", limit: 10 });
    const liveBatch = contextEventBus.read({ sinceSequence: "not-a-number", limit: 10 });

    expect(persistedBatch.sinceSequence).toBe(0);
    expect(mergedBatch.sinceSequence).toBe(0);
    expect(liveBatch.sinceSequence).toBe(0);
    expect(persistedBatch.events).toContainEqual(expect.objectContaining({ id: persisted.id }));
    expect(mergedBatch.events).toContainEqual(expect.objectContaining({ id: live.id }));
    expect(liveBatch.events).toContainEqual(expect.objectContaining({ id: live.id }));
  });

  test("persists explicit events for cross-invocation reconnect reads", () => {
    contextEventBus.clear();
    const logPath = tempEventLog();
    const seen: string[] = [];
    const unsubscribe = contextEventBus.subscribe((event) => seen.push(event.type));
    const event = persistContextEvent({
      type: "mcp.persisted_test",
      source: { kind: "mcp", transport: "tool" },
      payload: { ok: true },
      freshness: { status: "local", source: "mcp" },
    }, { path: logPath });
    unsubscribe();
    contextEventBus.clear();

    const persisted = readPersistedContextEvents({ path: logPath, sinceSequence: event.sequence - 1 });
    const merged = readContextEvents({ path: logPath, sinceSequence: event.sequence - 1 });

    expect(seen).toEqual(["mcp.persisted_test"]);
    expect(persisted.events).toContainEqual(expect.objectContaining({ id: event.id, type: "mcp.persisted_test" }));
    expect(merged.events).toContainEqual(expect.objectContaining({ id: event.id, type: "mcp.persisted_test" }));
    expect(readContextEvents({ path: logPath, sinceSequence: event.sequence }).events).toEqual([]);
  });

  test("repairs duplicate persisted ids by log order", () => {
    contextEventBus.clear();
    const logPath = tempEventLog();
    const first = {
      kind: "skyagent.contextEvent",
      schemaVersion: 1,
      id: "ctx-000001",
      sequence: 1,
      type: "cli.first_process",
      source: { kind: "cli", id: null, transport: "command" },
      timestamp: new Date(1_000).toISOString(),
      player: null,
      profile: null,
      payload: { n: 1 },
      freshness: { status: "local", fetchedAt: new Date(1_000).toISOString(), source: "cli", rateLimit: null, warnings: [] },
      provenance: { producer: "skyagent", version: "context-event-v1", provider: null, futureProducer: { kind: "minecraft-mod-telemetry", status: "reserved", expectedFields: [] } },
    };
    const second = { ...first, type: "mcp.second_process", timestamp: new Date(2_000).toISOString(), payload: { n: 2 } };
    fs.appendFileSync(logPath, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`, "utf8");

    const persisted = readPersistedContextEvents({ path: logPath, sinceSequence: 0, limit: 10 });
    expect(persisted.events.map((event) => [event.id, event.sequence, event.type])).toEqual([
      ["ctx-000001", 1, "cli.first_process"],
      ["ctx-000002", 2, "mcp.second_process"],
    ]);
  });

  test("keeps live stream and reconnect reads in one sequence space after persisted history", () => {
    const previousHome = process.env.AGENTS_HOME;
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-context-home-"));
    process.env.AGENTS_HOME = tempHome;
    contextEventBus.clear();
    try {
      const persisted = persistContextEvent({
        type: "cli.persisted_before_live",
        source: { kind: "cli", transport: "command" },
        payload: { n: 1 },
      });
      contextEventBus.clear();
      const live = emitContextEvent({
        type: "provider.live_after_reconnect",
        source: { kind: "provider-cache" },
        payload: { n: 2 },
      });
      expect(live.sequence).toBeGreaterThan(persisted.sequence);

      const afterPersisted = readContextEvents({ sinceSequence: persisted.sequence, limit: 10 });
      expect(afterPersisted.events).toContainEqual(expect.objectContaining({ id: live.id, sequence: live.sequence, type: live.type }));
      expect(readContextEvents({ sinceSequence: live.sequence, limit: 10 }).events).toEqual([]);
    } finally {
      contextEventBus.clear();
      if (previousHome === undefined) {
        delete process.env.AGENTS_HOME;
      } else {
        process.env.AGENTS_HOME = previousHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  test("offsets live events that predate persisted sequence state at reconnect read time", () => {
    contextEventBus.clear();
    const logPath = tempEventLog();
    const persisted: ContextEvent = {
      kind: "skyagent.contextEvent" as const,
      schemaVersion: 1 as const,
      id: "ctx-000005",
      sequence: 5,
      type: "cli.persisted_from_other_process",
      source: { kind: "cli", id: null, transport: "command" },
      timestamp: new Date(1_000).toISOString(),
      player: null,
      profile: null,
      payload: { n: 5 },
      freshness: { status: "local", fetchedAt: new Date(1_000).toISOString(), source: "cli", rateLimit: null, warnings: [] },
      provenance: { producer: "skyagent", version: "context-event-v1", provider: null, futureProducer: { kind: "minecraft-mod-telemetry", status: "reserved", expectedFields: [] } },
    };
    fs.appendFileSync(logPath, `${JSON.stringify(persisted)}\n`, "utf8");
    contextEventBus.emitNormalized({
      ...persisted,
      id: "ctx-000001",
      sequence: 1,
      type: "provider.live_lower_sequence",
      source: { kind: "provider-cache", id: null, transport: null },
      timestamp: new Date(2_000).toISOString(),
      payload: { n: 1 },
      freshness: { status: "local", fetchedAt: new Date(2_000).toISOString(), source: "provider-status", rateLimit: null, warnings: [] },
    });

    const afterPersisted = readContextEvents({ path: logPath, sinceSequence: 5, limit: 10 });

    expect(afterPersisted.events).toContainEqual(expect.objectContaining({
      id: "ctx-000006",
      sequence: 6,
      type: "provider.live_lower_sequence",
    }));
    expect(afterPersisted.latestSequence).toBe(6);

    fs.appendFileSync(logPath, `${JSON.stringify({
      ...persisted,
      id: "ctx-000006",
      sequence: 6,
      type: "mcp.persisted_after_live_read",
      timestamp: new Date(3_000).toISOString(),
      payload: { n: 6 },
    })}\n`, "utf8");
    const afterPersistedGrowth = readContextEvents({ path: logPath, sinceSequence: 5, limit: 10 });
    expect(afterPersistedGrowth.events.map((event) => [event.sequence, event.type])).toEqual([
      [6, "mcp.persisted_after_live_read"],
      [7, "provider.live_lower_sequence"],
    ]);
    expect(readContextEvents({ path: logPath, sinceSequence: 6, limit: 10 }).events).toContainEqual(expect.objectContaining({
      sequence: 7,
      type: "provider.live_lower_sequence",
    }));
  });

  test("keeps profile refresh events visible in merged reconnect reads", () => {
    contextEventBus.clear();
    const logPath = tempEventLog();
    const persisted = persistContextEvent({
      type: "cli.persisted_before_profile_refresh",
      source: { kind: "cli", transport: "command" },
      payload: { n: 1 },
    }, { path: logPath });
    const profileRefresh = emitContextEvent({
      type: "profile.snapshot_refresh",
      source: { kind: "profile-snapshot", id: "selected-profile" },
      payload: { cacheStatus: "refreshed" },
      freshness: { status: "fresh", source: "profile-cache" },
    });

    const afterPersisted = readContextEvents({ path: logPath, sinceSequence: persisted.sequence, limit: 10 });

    expect(afterPersisted.events).toContainEqual(expect.objectContaining({
      id: profileRefresh.id,
      type: "profile.snapshot_refresh",
      source: expect.objectContaining({ kind: "profile-snapshot", id: "selected-profile" }),
    }));
  });

  test("validates future minecraft-mod telemetry and rejects secret-like payload fields", () => {
    const event = persistContextEvent({
      type: "minecraft.inventory_delta",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "localhost" },
      payload: {
        sessionId: "local-session",
        inventoryDelta: [{ itemId: "ENCHANTED_HARD_STONE", countDelta: 8 }],
      },
      freshness: { status: "local", source: "minecraft-mod" },
      provenance: { provider: "minecraft-mod" },
    }, { path: tempEventLog() });

    expect(event).toMatchObject({
      type: "minecraft.inventory_delta",
      source: { kind: "minecraft-mod", transport: "localhost" },
      payload: { sessionId: "local-session" },
      provenance: { provider: "minecraft-mod" },
    });
    expect(() => persistContextEvent({
      type: "minecraft.inventory_delta",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "localhost" },
      payload: { sessionId: "local-session" },
    }, { path: tempEventLog() })).toThrow("inventoryDelta");
    expect(() => persistContextEvent({
      type: "minecraft.inventory_delta",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "http" },
      payload: { sessionId: "local-session", inventoryDelta: [] },
    }, { path: tempEventLog() })).toThrow("localhost");
    expect(() => persistContextEvent({
      type: "minecraft.inventory_delta",
      source: { kind: "minecraft-mod", transport: "localhost" },
      payload: { sessionId: "local-session", inventoryDelta: [] },
    }, { path: tempEventLog() })).toThrow("source.id");
    expect(() => persistContextEvent({
      type: "minecraft.chat_signal",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "localhost" },
      payload: { sessionId: "local-session", signal: "drop", apiKey: "secret" },
    }, { path: tempEventLog() })).toThrow("secret-like");
    expect(() => persistContextEvent({
      type: "minecraft.chat_signal",
      source: { kind: "minecraft-mod", id: "skyagent-fabric", transport: "localhost" },
      payload: { sessionId: "local-session", signal: "drop", token: { value: "secret" } },
    }, { path: tempEventLog() })).toThrow("secret-like");
    expect(() => persistContextEvent({
      type: "provider.cache_status",
      source: { kind: "provider-cache" },
      payload: { auth: { apiKeyConfigured: true, apiKeySource: "config" }, configuredRateLimit: { tokensPerMinute: 12000 } },
    }, { path: tempEventLog() })).not.toThrow();
  });

  test("emits provider cache status events", () => {
    const event = emitProviderStatusEvent({
      generatedAt: new Date(1_000).toISOString(),
      providers: [{ id: "pricing", status: "available" }],
      warnings: [],
    });

    expect(event).toMatchObject({
      type: "provider.cache_status",
      source: { kind: "provider-cache" },
      payload: { providers: [expect.objectContaining({ id: "pricing" })] },
    });
  });

  test("emits provider cache change events when provider state changes", () => {
    contextEventBus.clear();

    providerStatusWithEvent({
      providerStatus: () => ({
        generatedAt: new Date(1_000).toISOString(),
        providers: [{ id: "pricing", status: "available", cache: { staleCount: 0 }, warnings: [] }],
        warnings: [],
      }),
      forceChange: true,
    });
    providerStatusWithEvent({
      providerStatus: () => ({
        generatedAt: new Date(2_000).toISOString(),
        providers: [{ id: "pricing", status: "stale_cache_available", cache: { staleCount: 1 }, warnings: [{ code: "stale_price_cache" }] }],
        warnings: [{ code: "stale_price_cache" }],
      }),
    });

    const changes = contextEventBus.read({ type: "provider.cache_status_change", limit: 10 }).events;
    expect(changes).toHaveLength(2);
    expect(changes.at(-1)?.payload.providers[0].status).toBe("stale_cache_available");
  });
});

describe("server status", () => {
  test("reports Hypixel session fields and emits a status event", async () => {
    contextEventBus.clear();
    const status = await serverStatusForPlayer("Notch", {
      now: 1_000,
      uuidFromNameOrUuid: async () => "uuid-1",
      providerStatus: () => ({ generatedAt: new Date(1_000).toISOString(), providers: [], warnings: [] }),
      hypixelRequest: async () => ({
        status: 200,
        url: "https://api.hypixel.net/v2/status?uuid=uuid-1",
        rateLimit: { limit: "120", remaining: "119", reset: "1" },
        body: { session: { online: true, gameType: "SKYBLOCK", mode: "dynamic", map: "Private Island" } },
      }),
    });

    expect(status).toMatchObject({
      kind: "skyagent.serverStatus",
      api: { available: true, status: 200 },
      online: true,
      session: { gameType: "SKYBLOCK", mode: "dynamic", map: "Private Island" },
    });
    expect(contextEventBus.read({ type: "hypixel.server_status_change", limit: 10 }).events).toHaveLength(1);
  });

  test("returns provider warnings instead of throwing on status failures", async () => {
    const error = Object.assign(new Error("Hypixel request failed: HTTP 503 maintenance"), {
      result: {
        status: 503,
        url: "https://api.hypixel.net/v2/status?uuid=uuid-1",
        rateLimit: { limit: null, remaining: null, reset: null },
      },
    });
    const status = await serverStatusForPlayer("Notch", {
      uuidFromNameOrUuid: async () => "uuid-1",
      providerStatus: () => ({ generatedAt: new Date(1_000).toISOString(), providers: [], warnings: [] }),
      hypixelRequest: async () => {
        throw error;
      },
    });

    expect(status.api).toMatchObject({ available: false, status: 503 });
    expect(status.online).toBeNull();
    expect(status.warnings).toContainEqual(expect.objectContaining({ code: "hypixel_status_provider_error" }));
  });

  test("reports player resolution failures without marking the Hypixel API unavailable", async () => {
    const status = await serverStatusForPlayer("missing-player", {
      uuidFromNameOrUuid: async () => {
        throw new Error("Minecraft username not found: missing-player");
      },
      providerStatus: () => ({ generatedAt: new Date(1_000).toISOString(), providers: [], warnings: [] }),
      hypixelRequest: async () => {
        throw new Error("should not request Hypixel after resolution failure");
      },
    });

    expect(status).toMatchObject({
      api: { available: null, status: null },
      online: null,
      player: { input: "missing-player", uuid: null },
    });
    expect(status.warnings).toContainEqual(expect.objectContaining({ code: "player_resolution_error" }));
  });

  test("reports missing local API keys without marking the Hypixel API unavailable", async () => {
    const status = await serverStatusForPlayer("Notch", {
      uuidFromNameOrUuid: async () => "uuid-1",
      providerStatus: () => ({ generatedAt: new Date(1_000).toISOString(), providers: [], warnings: [] }),
      hypixelRequest: async () => {
        throw new Error("Hypixel API key is required. Run `agents secrets set HYPIXEL_API_KEY`.");
      },
    });

    expect(status.api).toMatchObject({ available: null, status: null });
    expect(status.warnings).toContainEqual(expect.objectContaining({ code: "hypixel_api_key_required" }));
  });

  test("server status monitor emits change events only when status state changes", async () => {
    contextEventBus.clear();
    const statuses = [
      {
        kind: "skyagent.serverStatus",
        schemaVersion: 1,
        generatedAt: new Date(1_000).toISOString(),
        player: { input: "Notch", uuid: "uuid-1" },
        api: { available: true, status: 200, url: "https://api.hypixel.net/v2/status?uuid=uuid-1", rateLimit: null },
        online: true,
        session: { gameType: "SKYBLOCK", mode: "dynamic", map: "Private Island" },
        providers: { providers: [], warnings: [] },
        warnings: [],
      },
      {
        kind: "skyagent.serverStatus",
        schemaVersion: 1,
        generatedAt: new Date(2_000).toISOString(),
        player: { input: "Notch", uuid: "uuid-1" },
        api: { available: true, status: 200, url: "https://api.hypixel.net/v2/status?uuid=uuid-1", rateLimit: null },
        online: true,
        session: { gameType: "SKYBLOCK", mode: "dynamic", map: "Private Island" },
        providers: { providers: [], warnings: [] },
        warnings: [],
      },
      {
        kind: "skyagent.serverStatus",
        schemaVersion: 1,
        generatedAt: new Date(3_000).toISOString(),
        player: { input: "Notch", uuid: "uuid-1" },
        api: { available: true, status: 200, url: "https://api.hypixel.net/v2/status?uuid=uuid-1", rateLimit: null },
        online: false,
        session: { gameType: null, mode: null, map: null },
        providers: { providers: [], warnings: [] },
        warnings: [],
      },
    ];
    let index = 0;
    const monitor = createServerStatusMonitor("Notch", {
      statusProvider: async () => statuses[Math.min(index++, statuses.length - 1)],
    });

    await monitor.tick();
    await monitor.tick();
    await monitor.tick();

    const changeEvents = contextEventBus.read({ limit: 10, type: "hypixel.server_status_change" }).events;
    expect(changeEvents).toHaveLength(2);
    expect(changeEvents.map((event) => event.payload.online)).toEqual([true, false]);
  });
});
