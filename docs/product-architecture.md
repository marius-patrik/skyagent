# SkyAgent Product Architecture

## Boundary

SkyAgent is one Agent OS application. It owns Hypixel SkyBlock domain behavior and application state. It does not own model selection, provider routing, shared memory, model sessions, identity, orchestration, or harness configuration.

The only launch authority is `agent.package.json`:

```text
agents packages run skyagent -- <command>
```

The manifest uses `kind: app` because the same product exposes a CLI, MCP protocol service, TUI, and web UI. None of those interfaces is a separate product or harness.

## Packages

- `packages/core`: API clients, state, profile cache, domain parsing and calculations.
- `packages/cli`: canonical executable and command routing.
- `packages/mcp`: stdio MCP service over core domain functions.
- `packages/tui`: Ink interface calling core domain functions directly.
- `packages/web`: React interface and loopback application server.

No package selects or invokes a model.

## State invariant

Every mutable file is beneath `$AGENTS_HOME`:

```text
$AGENTS_HOME/runtime/apps/skyagent/
├── config.json
├── profile-cache/
├── objectives.json
├── context-events.ndjson
├── web.json
└── web.log
```

The exact set grows only for domain state. SkyAgent has no private home override and no second memory store.

The Hypixel key is read from `$AGENTS_HOME/secrets/HYPIXEL_API_KEY.secret`. Application config cannot contain secret or provider fields. Files are physical, private, and written atomically where state replacement is required.

## Core flow

```text
Agent OS invocation
  └─ agents packages run skyagent -- ...
      ├─ CLI command ───────────────┐
      ├─ MCP stdio service ─────────┤
      ├─ TUI direct client ─────────┤─> @skyagent/core ─> Hypixel/data sources
      └─ web loopback /api service ─┘                 └─> Agent OS app state
```

All interfaces use the same core implementations. `packages/core/src/surface-contracts.ts` records which CLI commands, MCP tools, TUI screens, and skills cover each high-value domain.

## Context and objectives

The compact context capsule is profile-domain data, not a model session. `skyagent_context_get` reads the configured profile using cache policy; `skyagent_context_refresh` explicitly requests current data.

Context events record bounded SkyBlock application facts such as profile refreshes, server state changes, cache freshness, and explicit domain signals. They never establish model-session ownership.

Objectives are SkyBlock work items: goals, tasks, buys, sources, and snipe watches. They remain application state because they are structured inputs to deterministic planners. General user memory belongs exclusively to Agent OS.

## Interfaces

### CLI

CLI commands return JSON and call core directly. Setup writes only identity/profile selection. The API key must already exist in the Agent OS secret store.

### MCP

The MCP server is started with:

```text
agents packages run skyagent -- mcp
```

No repository-owned MCP client config exists. There is one tool name per behavior; aliases are forbidden.

### TUI

The TUI has no chat surface. It renders domain state and calls core directly, leaving conversation and provider selection to Agent OS.

### Web

The web process binds only to loopback. It serves static assets and bounded `/api/*` domain endpoints. Runtime metadata and logs remain under the canonical application state directory.

## Verification

`bun run validate:product` rejects provider-owned files, retired launchers, duplicate roots, checked-in generated output, model/provider runtime code, and manifest drift. `bun run validate:skill` validates provider-neutral domain skills. Type checking, tests, and a fresh web build complete the product gate.
