# SkyAgent Domain Playbook

This playbook describes how an Agent OS model should use SkyAgent’s deterministic domain tools. Agent OS owns the conversation, memory, provider, and session.

## Compact context first

For broad analysis:

1. Call `skyagent_context_get`.
2. Read `skyagent_objective_list` when ongoing SkyBlock work matters.
3. Read `skyagent_server_status` and recent `skyagent_context_events` when freshness matters.
4. Route to the narrow profile, inventory, economy, progression, readiness, or planning tool.

Use `skyagent_context_refresh` when the user says profile state changed or when a current purchase/readiness decision requires fresh data. Raw member and NBT payloads are debug evidence, not default answer material.

## Goal routing

- Museum: use `skyblock_museum_donation_plan`, then bounded Museum/profile/storage evidence for uncertain candidates.
- Damage, Slayer, Dungeons, or Kuudra: use target-specific `skyblock_readiness`, complete gear/pet/accessory context, budget, and current price evidence before purchases.
- Money routes: compare capital, unlocks, readiness, data freshness, and user constraints; never invent exact profit rates.
- Accessories: use owned, missing, and budgeted coin-per-Magical-Power tools.
- Progression: use named profile sections and preserve missing-data versus true-zero distinctions.

## Objectives

Preview planning does not mutate state. After explicit acceptance, planners may persist structured SkyBlock goals, tasks, buys, sources, and snipe watches. General preferences and personal history stay in Agent OS memory.

## Degraded data

- Missing API key: use cache/public resources when possible and instruct the user to run `agents secrets set HYPIXEL_API_KEY`.
- Stale cache: refresh for current-state or market-sensitive decisions; otherwise keep the stale warning.
- Partial external data: continue only with explicit coverage, confidence, and uncertainty.
- Missing parser: use the narrowest official field extraction and label the result partial.
- Large payload: switch to a summary, section, or normalized record.

Never store or print secrets in config, objectives, events, summaries, or logs.
