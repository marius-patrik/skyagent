# Project Rules

## Scope

SkyAgent owns Hypixel SkyBlock API access, parsing, calculations, planning, domain objectives, and domain context events. Agent OS owns models, providers, prompts, identity, shared memory, shared sessions, orchestration, capabilities, and secret registration.

## Architecture

- Add shared behavior to `packages/core` first.
- Keep `packages/cli/src/bin.ts` as the sole executable entry named by `agent.package.json`.
- Keep the MCP server as a subcommand of that entry; never add repository-owned client config.
- Keep the TUI direct-core and free of chat/provider logic.
- Keep the web server loopback-only and its routes domain-only.
- Do not create aliases, wrappers, migration readers, retired variable handling, or alternate state roots.

## Data

- Prefer live Hypixel and official sources.
- Identify community metadata and economy sources explicitly.
- Bound broad price, networth, inventory, and accessory operations.
- Preserve missing-data, stale-data, confidence, and unsupported-formula warnings.
- Never treat a missing field as a true zero without contract evidence.

## Secrets

- Read the Hypixel key only from the Agent OS secret file.
- Never accept the key through SkyAgent config, MCP config, command flags, UI forms, objectives, events, or logs.

## Verification

Use the exact commands in `COMMANDS.md`. Generated web output and dependencies must remain untracked.
