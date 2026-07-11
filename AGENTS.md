# SkyAgent Repository Contract

SkyAgent is one provider-neutral Agent OS application. Preserve the domain product and keep model/provider/session/memory authority in Agent OS.

- Launch only through `agents packages run skyagent -- ...` and `agent.package.json`.
- Keep mutable state under `$AGENTS_HOME/runtime/apps/skyagent` and the Hypixel secret at `$AGENTS_HOME/secrets/HYPIXEL_API_KEY.secret`.
- Do not add provider-owned config, model routing, a chat runtime, a second memory store, standalone installers, checked-in generated output, or alternate launchers.
- Keep shared domain behavior in `packages/core`; CLI, MCP, TUI, and web are interfaces over core.
- Preserve provenance, freshness, uncertainty, and bounded work for external data.
- Read `.agents/.project/AGENTS.md` and the other `.agents/.project` files before broad changes.
- Run `bun run typecheck`, `bun run test`, `bun run validate:product`, `bun run validate:skill`, and `bun run build:web` for changed product surfaces.
