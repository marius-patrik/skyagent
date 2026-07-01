# Missing SkyBlock Tool Parity Spec

This document defines the work needed for SkyAgent to approach parity with common Hypixel SkyBlock tools such as SkyCrypt, SkyHelper-style Discord bots, NotEnoughUpdates-backed calculators, and economy trackers.

## Goals

- Turn raw Hypixel API data into profile sections that are useful for progression planning.
- Provide deterministic CLI and MCP tools for common SkyBlock analysis tasks.
- Keep derived calculations auditable by documenting data providers, formulas, assumptions, and freshness.
- Preserve a raw API escape hatch while adding higher-level abstractions for repeated workflows.

## Non-Goals

- Do not clone SkyCrypt UI directly.
- Do not present third-party-derived values as authoritative.
- Do not require Hypixel API secrets for public data checks.
- Do not store user profile snapshots or API keys in the repo.
- Do not add web app UX choices beyond the already selected future stack: Bun, Rsbuild, React, TypeScript, and shadcn/ui.

## Current Baseline

SkyAgent currently has:

- Mojang username resolution.
- Hypixel v2 raw request support.
- Player/status/profile/museum/garden/bingo endpoints.
- Public SkyBlock resources, Bazaar, auctions, ended auctions, fire sales, and news.
- Compact profile summaries, member extraction, profile overview metadata, and SkyCrypt URL generation.
- Local user config and memories.

It does not yet parse inventory NBT, normalize items, calculate prices/networth, identify missing upgrades, or render full profile sections.

## Reference Tools And Signals

- SkyCrypt-style profile viewers: profile sections, inventory sections, skill/progression views, NotEnoughUpdates item metadata, and SkyHelper-derived networth.
- SkyHelper-style bots/APIs: networth, item networth, skills, prices, profile lookup, and progress commands.
- Economy trackers such as CoflNet: lowest BIN, auction history, Bazaar history, item search, and pricing filters.
- Discord utility bots: profile stats, skills, Slayer, Dungeons, missing accessories, stat optimization, minions, timers, prices, auctions, and event reminders.

Treat these as parity references. Official Hypixel API data remains the source of truth for profile state.

## Data Providers

### Required

- Hypixel API: profile state, museum, garden, public resources, Bazaar, auctions, news, and status.
- Mojang API: username to UUID resolution.
- Static SkyBlock tables: skill XP curves, Catacombs XP curves, Slayer XP thresholds, rarity ordering, item-tier metadata, and known profile-section mappings.

### Preferred Third-Party Providers

- NotEnoughUpdates item data or an equivalent maintained item metadata dataset.
- SkyHelper-Networth or compatible formulas for initial networth parity.
- CoflNet or compatible endpoints for lowest BIN and historical price data.
- Official/current wiki pages for item, collection, and progression explanations when user-facing reasoning needs textual context.

### Provider Rules

- Each provider must have a module-level adapter under `scripts/lib/`.
- Each adapter must return provider metadata: source name, fetched URL or local version, fetched time, and cache status.
- Cache public metadata and economy responses with explicit TTLs.
- Keep user profile data uncached by default unless the user explicitly asks for snapshots.
- Derived values must include assumptions and provider freshness in output.

## Phase 1: NBT And Inventory Parser

### Capability

Decode Hypixel SkyBlock inventory payloads and extract item stacks from:

- Inventory.
- Armor.
- Equipment.
- Wardrobe.
- Ender Chest.
- Backpacks.
- Accessory bag.
- Personal vault.
- Pets menu or pet data where exposed.

### Implementation

- Add `scripts/lib/nbt.ts` for base64 + gzip + NBT parsing.
- Prefer a maintained NBT parser package over hand-rolling the binary format.
- Add `scripts/lib/inventory.ts` for section extraction and item stack normalization.
- Preserve raw decoded data behind a debug option.

### CLI

- `skyagent inventory [player] [profile]`
- `skyagent inventory-section <section> [player] [profile]`
- `skyagent item-dump [player] [profile] --section <section>`

### MCP

- `skyblock_inventory`
- `skyblock_inventory_section`
- `skyblock_item_dump`

### Validation

- Fixture tests with representative encoded NBT payloads.
- Empty/missing inventory API cases.
- Corrupt NBT input.
- Profile API disabled or partial-profile cases.

## Phase 2: Item Normalization

### Capability

Convert raw item stacks into stable SkyBlock item records.

Fields should include:

- Internal item ID.
- Display name and clean name.
- Rarity.
- Item category.
- Count.
- Reforge.
- Enchantments.
- Attributes.
- Hot Potato/Fuming counts.
- Stars, master stars, dungeonized state, dungeon item quality where available.
- Gemstones and slots.
- Recombobulated state.
- Rune, skin, dye, cake year, pet item, held item, and other special modifiers where available.
- Raw NBT pointer for debugging.

### Implementation

- Add `scripts/lib/items.ts`.
- Add provider adapter for NotEnoughUpdates-style metadata.
- Keep normalization deterministic and side-effect free.

### CLI

- `skyagent normalize-items [player] [profile]`
- `skyagent item <internalId>`

### MCP

- `skyblock_normalized_items`
- `skyblock_item_metadata`

### Validation

- Golden fixtures for common weapons, armor, pets, accessories, gemstones, attributes, and dungeon items.
- Snapshot tests for parsed item records.
- Provider-unavailable fallback behavior.

## Phase 3: Price Providers

### Capability

Resolve item value using multiple sources:

- Bazaar instant buy/sell and moving averages where available.
- Current lowest BIN for auctionable items.
- Auction history or median price when current LBIN is unreliable.
- NPC/shop fallback where known.
- Zero/unknown value when pricing is unavailable.

### Implementation

- Add `scripts/lib/prices.ts`.
- Add provider adapters for Hypixel Bazaar/Auctions and CoflNet-compatible endpoints.
- Add price strategy metadata: provider, method, confidence, timestamp, and fallback chain.
- Cache public price data separately from user data.

### CLI

- `skyagent price <itemId>`
- `skyagent lbin <itemId>`
- `skyagent price-history <itemId> [window]`

### MCP

- `skyblock_price`
- `skyblock_lowest_bin`
- `skyblock_price_history`

### Validation

- Known Bazaar item pricing.
- Known auction-only item pricing.
- Missing item and provider outage behavior.
- Rate-limit and stale-cache behavior.

## Phase 4: Networth

### Capability

Calculate total and per-section networth:

- Purse and bank.
- Armor.
- Equipment.
- Wardrobe.
- Weapons.
- Inventory.
- Ender Chest.
- Backpacks.
- Accessories.
- Pets.
- Museum where useful.
- Miscellaneous profile-bound valuables where safely supported.

### Implementation

- Add `scripts/lib/networth.ts`.
- Start with SkyHelper-Networth-compatible behavior where license and integration constraints allow.
- Output section totals, item totals, ignored items, unknown prices, and provider assumptions.
- Include confidence and stale-data warnings.

### CLI

- `skyagent networth [player] [profile]`
- `skyagent item-networth [player] [profile] --section <section>`

### MCP

- `skyblock_networth`
- `skyblock_item_networth`

### Validation

- Fixture profile with known expected section totals.
- Provider unavailable mode.
- Comparison smoke checks against SkyCrypt/SkyHelper-style output for a public profile, with tolerance and source-date notes.

## Phase 5: Accessories And Upgrade Priority

### Capability

Identify missing accessories and rank upgrades by expected value:

- Missing accessories.
- Duplicate/ignored accessories.
- Recombobulated accessories.
- Enrichment state.
- Magical Power estimate.
- Cheapest missing accessories.
- Coin-per-MP upgrade ranking.

### Implementation

- Add `scripts/lib/accessories.ts`.
- Use maintained accessory metadata and price provider.
- Separate exact calculations from estimates when API data is incomplete.

### CLI

- `skyagent accessories [player] [profile]`
- `skyagent missing-accessories [player] [profile]`
- `skyagent accessory-upgrades [player] [profile] --budget <coins>`

### MCP

- `skyblock_accessories`
- `skyblock_missing_accessories`
- `skyblock_accessory_upgrades`

### Validation

- Accessory bag fixture with duplicates and upgrades.
- Price-driven ranking snapshot.
- Missing metadata fallback behavior.

## Phase 6: Skills And Profile Progression Sections

### Capability

Render progression sections similar to profile viewers and bots:

- Skills and skill average.
- Catacombs and class levels.
- Slayer levels and XP.
- Bestiary.
- Collections.
- Minions.
- Museum.
- Garden and farming milestones.
- Mining, HotM, commissions, powder, and major mining unlocks.
- Crimson Isle and Kuudra.
- Rift.
- Trophy Fishing.
- Pets.
- Essence, currencies, and important unlocks.

### Implementation

- Add section modules under `scripts/lib/sections/`.
- Add shared XP curve utilities under `scripts/lib/progression.ts`.
- Keep each section independently testable.

### CLI

- `skyagent section <name> [player] [profile]`
- `skyagent progression [player] [profile]`

### MCP

- `skyblock_profile_section`
- `skyblock_progression`

### Validation

- XP curve boundary tests.
- Public profile smoke tests.
- Golden snapshots for section summaries.

## Phase 7: Weight And Readiness Calculators

### Capability

Add derived meta calculators:

- Senither/Lily-style weight where formulas are available and maintained.
- Dungeon readiness.
- Slayer readiness.
- Kuudra readiness.
- Garden/farming readiness.
- Mining money-making readiness.

### Implementation

- Add `scripts/lib/weight.ts`.
- Add `scripts/lib/readiness.ts`.
- Every output must name formulas and assumptions.
- If formulas are stale or unavailable, output an explicit unsupported/estimate status.

### CLI

- `skyagent weight [player] [profile]`
- `skyagent readiness <dungeons|slayer|kuudra|garden|mining> [player] [profile]`

### MCP

- `skyblock_weight`
- `skyblock_readiness`

### Validation

- Formula fixture tests.
- Stale-formula warnings.
- Manual comparison against reference tools with date-stamped notes.

## Phase 8: Planning And Recommendations

### Capability

Turn profile state and calculators into action plans:

- Upgrade priority.
- Daily/weekly route.
- Budget-constrained recommendations.
- Goal-specific blockers.
- What to skip.
- Source-aware uncertainty.

### Implementation

- Add `scripts/lib/planner.ts`.
- Use structured inputs from sections, networth, prices, and memories.
- Keep recommendation logic explainable: every recommendation should include reason, expected impact, cost/time estimate, prerequisites, and source freshness.

### CLI

- `skyagent plan <goal> [player] [profile]`
- `skyagent next-upgrades [player] [profile] --budget <coins>`

### MCP

- `skyblock_plan_goal`
- `skyblock_next_upgrades`

### Validation

- Scenario fixtures for early, mid, late, and Ironman profiles.
- Snapshot plans for common goals.
- Tests for budget constraints and missing-data fallbacks.

## Phase 9: Web App Parity

### Capability

Add a web app for interactive inspection and planning.

### Stack

- Bun.
- Rsbuild.
- React.
- TypeScript.
- shadcn/ui.

### Screens

- Profile selector.
- Profile overview.
- Inventory and item sections.
- Networth breakdown.
- Missing accessories.
- Progression sections.
- Goal planner.
- Settings for API key, username, profile, providers, and cache.

### Rules

- Reuse CLI/MCP library modules.
- Do not duplicate calculator logic in React components.
- Keep all secrets in local user storage or explicit environment configuration.

## Cross-Cutting Requirements

### CLI And MCP Parity

Every high-value CLI command must have a corresponding MCP tool. MCP outputs should include enough provenance for Codex to reason safely:

- Source provider.
- Fetched time.
- Cache status.
- Formula or strategy name for derived values.
- Warnings for missing data, stale data, or unsupported fields.

### Caching

- Public metadata: longer TTL.
- Economy data: short TTL.
- Profile data: no disk cache by default.
- User-approved snapshots: explicit command and clearly named storage.

### Error Handling

- Distinguish unavailable provider, rate limit, disabled API, missing profile, corrupt NBT, and unsupported calculation.
- Prefer structured warnings over silent omission.
- Never invent values when data is missing.

### Security

- Do not print API keys.
- Do not commit profile snapshots.
- Treat third-party provider URLs and responses as untrusted input.
- Keep CI Codex review secrets isolated from untrusted PR workflow code.

## Future Issue Slices

Recommended issue order:

1. Add NBT parser and inventory fixture tests.
2. Add normalized item model and NEU metadata provider.
3. Add Bazaar/LBIN price provider layer.
4. Add networth section calculator.
5. Add accessory/magical-power upgrade calculator.
6. Add progression section framework and XP curves.
7. Add Dungeons/Slayer/Mining/Garden section modules.
8. Add weight/readiness calculators.
9. Add goal planner.
10. Scaffold web app with Bun/Rsbuild/React/TypeScript/shadcn/ui.

