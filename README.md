# SkyAgent

SkyAgent is a Codex plugin for Hypixel SkyBlock profile analysis and progression planning.

The goal is to connect Codex to live player data, game reference data, and curated meta knowledge so it can answer questions like:

- What should I do next to reach a specific net worth, skill, dungeon, or Slayer goal?
- Which upgrades give the best return for my current profile?
- What daily and weekly route should I follow with my available play time?
- Which advice is stale after a patch, profile state, or economy change?

## Architecture

- `skills/` contains durable SkyBlock reasoning rules and source-priority guidance.
- `.mcp.json` exposes local tools for Hypixel API calls, profile data, public SkyBlock resources, and persistent SkyAgent notes.
- `scripts/skyagent.mjs` is the CLI.
- `scripts/mcp-server.mjs` is the MCP server used by Codex.
- `assets/` is reserved for plugin assets and reference fixtures.

## Local Setup

Use an environment variable for the API key when possible:

```powershell
$env:HYPIXEL_API_KEY = "your-key"
```

Or store it in the SkyAgent user config:

```powershell
node .\scripts\skyagent.mjs config set api-key your-key
node .\scripts\skyagent.mjs config set username YourMinecraftName
```

SkyAgent stores config and memories outside the repo:

- Windows default: `%APPDATA%\skyagent`
- Override: `SKYAGENT_HOME`

## CLI Examples

```powershell
node .\scripts\skyagent.mjs config get
node .\scripts\skyagent.mjs resolve YourMinecraftName
node .\scripts\skyagent.mjs profiles
node .\scripts\skyagent.mjs profiles-summary
node .\scripts\skyagent.mjs overview
node .\scripts\skyagent.mjs skycrypt YourMinecraftName
node .\scripts\skyagent.mjs resource items
node .\scripts\skyagent.mjs bazaar
node .\scripts\skyagent.mjs firesales
node .\scripts\skyagent.mjs memory add "Working toward F7 completion" goal dungeon
```

## Data Sources

Initial targets:

- Hypixel API profile and player endpoints.
- Official Hypixel SkyBlock patch notes.
- Hypixel SkyBlock Wiki pages.
- Community meta sources where explicitly enabled.

Source priority should generally be: live API data, official patch notes, official/current wiki pages, leaderboards or logs, then community guides.

## API Notes

Hypixel v2 uses the `API-Key` request header for authenticated endpoints. Rate-limit details are returned in `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers. SkyBlock item and inventory payloads can contain base64 encoded gzipped NBT data; decoding that is intentionally left for a later parser module.

See `docs/parity.md` for the current gap between SkyAgent and SkyCrypt/SkyHelper-style tools.
