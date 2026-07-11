# Project

SkyAgent is the Hypixel SkyBlock application inside Agent OS.

Its one package contract is `agent.package.json` with `kind: app` and entry `bun packages/cli/src/bin.ts`. The app exposes a JSON CLI, MCP stdio service, Ink TUI, and loopback React web interface over one core domain library.

Canonical mutable state: `$AGENTS_HOME/runtime/apps/skyagent`.

Canonical secret: `$AGENTS_HOME/secrets/HYPIXEL_API_KEY.secret`.

Domain semantic version: `2.0.0`. This is SkyAgent’s application version, not an Agent OS or model version.
