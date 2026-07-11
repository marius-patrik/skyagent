---
name: skyagent-live-progress
description: Use SkyAgent context events and live-progress streams for Hypixel SkyBlock activity. Use for context stream reads, context watch, explicit event emission, Hypixel server-status changes, provider/cache status changes, profile refresh events, and future Minecraft mod telemetry.
metadata:
  display_name: "SkyAgent Live Progress"
  short_description: "Read context event streams."
  default_prompt: "Use $skyagent-live-progress to check recent SkyBlock context events."
---

# SkyAgent Live Progress

Use this skill when an answer should account for recent session progress, refresh events, provider changes, or future live telemetry.

## Tool Routing

- Use `skyagent_context_get` through `$skyagent-context-engine` when recent events need to be interpreted alongside compact profile state.
- Use `skyagent_context_events` to read recent bounded context events for deterministic follow-up analysis; continue from its latest sequence cursor.
- Use `skyagent_context_events` when the session needs a stream of progress, refresh, `provider.cache_status`, `provider.cache_status_change`, or server-status events.
- Use `skyagent_context_event_emit` when the active Agent OS model, CLI, MCP service, or a future producer needs to add an explicit persisted domain event.
- Use `skyagent_server_status` when online state, SkyBlock session mode/map, Hypixel API availability, or status warnings matter; status changes should appear as `hypixel.server_status_change` events.
- Use `skyagent_context_refresh` after meaningful profile-changing events so the context capsule reflects current profile state.
- Route durable progress and work-item changes to `$skyagent-objectives`.
- Route compact profile context to `$skyagent-context-engine`.

## Event Handling

- Prefer event sequence IDs or `since` cursors for reconnects.
- Treat CLI, MCP-service, and application events as persisted domain history; treat provider/cache, server-status, and profile-refresh events as live advisory signals unless they also appear in persisted history.
- Treat `provider.cache_status` and `provider.cache_status_change` events as freshness signals, not as proof that profile state changed.
- Treat explicit agent events as notes unless they are backed by a tool result, live profile refresh, or user confirmation.
- Future Minecraft mod telemetry should enter through the same event contract with `source.kind: "minecraft-mod"`, `payload.sessionId`, localhost provenance fields such as `modId` and `minecraftVersion`, and typed payloads such as `location`, `inventoryDelta`, `objectiveProgress`, `signal`, or `terminal`.

## Rules

- Do not assume live streams are available. Fall back to cached events or context refresh when needed.
- Preserve event source, timestamp, player/profile identity, provider provenance, freshness, warnings, and sequence ID.
- Use live progress to avoid asking the user to restate progress that is already present in the stream.
- Do not implement Minecraft mod behavior from this skill; only consume events that already exist.
- Do not store secrets in emitted events or event payloads; redacted booleans such as `apiKeyConfigured` are acceptable, raw `apiKey`, `token`, `password`, or `secret` values are not.
