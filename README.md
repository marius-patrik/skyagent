# SkyAgent

SkyAgent is the Agent OS application for Hypixel SkyBlock profile analysis and progression planning. It provides deterministic domain tools; Agent OS owns the active model, provider, memory, session, identity, and orchestration.

SkyAgent can answer questions such as:

- What should I do next for a Dungeon, Slayer, Garden, Mining, Museum, or economy goal?
- Which upgrades fit my current profile and budget?
- What do my inventory, accessories, networth, readiness, and progression data show?
- Which conclusions are limited by stale, partial, or third-party data?

## Canonical launch

Register and run SkyAgent through the manager:

```sh
agents packages register packages/skyblock-agent
agents packages run skyagent -- doctor --json
agents packages run skyagent -- setup status --json
agents packages run skyagent -- context --cache-only --allow-stale
agents packages run skyagent -- tui --smoke
```

The package contract is [agent.package.json](agent.package.json). Its `kind` is `app` because one user-facing product owns several interfaces: a JSON CLI, an MCP service, a terminal UI, and a local web UI. It is not a model harness and contains no model or provider selection.

## State and secrets

All mutable state is rooted in the one Agent OS home:

```text
$AGENTS_HOME/
├── runtime/apps/skyagent/       # profile config, cache, objectives, events, UI process metadata
└── secrets/HYPIXEL_API_KEY.secret
```

Set the Hypixel key with Agent OS:

```sh
agents secrets set HYPIXEL_API_KEY
```

SkyAgent never stores the key in its application config. Its config contains only the Minecraft username, UUID, and selected profile ID. Shared user memory stays in Agent OS memory and is not duplicated by SkyAgent.

## Interfaces

### CLI

Every CLI command uses the canonical package entry:

```sh
agents packages run skyagent -- config get
agents packages run skyagent -- setup --json --username YourMinecraftName --profile Apple
agents packages run skyagent -- profiles-summary
agents packages run skyagent -- overview
agents packages run skyagent -- inventory
agents packages run skyagent -- networth --summary
agents packages run skyagent -- accessories
agents packages run skyagent -- progression
agents packages run skyagent -- readiness dungeons:f7
agents packages run skyagent -- plan f7 --budget 10000000
agents packages run skyagent -- museum-plan "Museum GIANTS_SWORD"
agents packages run skyagent -- objective list
```

Commands return JSON. Raw decoded inventory payloads require explicit debug flags.

### MCP service

Start the package-owned MCP protocol service through the same entry:

```sh
agents packages run skyagent -- mcp
```

There is no checked-in client configuration. Agent OS decides when and how to expose this service to a model harness.

### Terminal UI

```sh
agents packages run skyagent -- tui
```

The Ink UI calls SkyAgent domain functions directly. It covers setup status, profiles, overview, inventory, gear, accessories, networth, progression/readiness, external data freshness, context events, objectives, and bounded debug output. Use `j`/`k` or arrow keys to navigate, `h`/`l` to select, `enter` or `r` to load, and `q` to quit.

### Web UI

```sh
agents packages run skyagent -- web start --no-open
agents packages run skyagent -- web status
agents packages run skyagent -- web stop
```

The local web server binds to `127.0.0.1`, serves the built React application, and exposes only package-owned `/api/*` domain routes. It does not host a model runtime.

## Architecture

- `packages/core` contains Hypixel clients, state access, profile parsing, cache, inventory/NBT, item metadata, pricing, networth, accessories, progression, readiness, planning, objectives, and context events.
- `packages/cli` is the canonical executable interface.
- `packages/mcp` is the package-owned MCP protocol service.
- `packages/tui` is the direct-core Ink terminal UI.
- `packages/web` is the Rsbuild/React UI and loopback application server.
- `skills` contains provider-neutral SkyBlock domain skills that can be published into Agent OS.
- `.agents/.project` contains repository-only continuity and project guidance; it contains no global state or skills.

## Data-source policy

Source priority is live Hypixel API data, official patch notes, official/current wiki material, leaderboards or logs, then explicitly identified community sources. Community metadata and price data are evidence with provenance, freshness, confidence, and warnings—not game truth.

SkyBlock inventory payloads may contain base64-encoded gzipped NBT. SkyAgent decodes supported sections and normalizes item records. NotEnoughUpdates-style metadata is optional. Bazaar prices come from Hypixel; LBIN/history may use CoflNet-compatible data. Unresolved prices do not contribute to totals.

Weight, readiness, modifier values, and route profitability remain conservative when maintained exact formulas or current sources are unavailable. Outputs preserve assumptions, missing fields, partial coverage, and stale-data warnings.

## Development

The repository pins Bun 1.3.14 and its TypeScript toolchain. Install and run the authoritative gates:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run validate:product
bun run validate:skill
bun run build:web
```

CI runs the same product checks and web visual QA. Generated web output and dependencies are build artifacts and are never committed.
