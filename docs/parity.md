# SkyAgent Domain Coverage

SkyAgent currently covers:

- player and profile resolution with cache controls;
- inventory/NBT decoding and normalized items;
- Bazaar and bounded external price evidence;
- conservative sectioned networth;
- accessory ownership, missing candidates, and budgeted Magical Power upgrades;
- broad progression sections and XP summaries;
- conservative weight and target-aware readiness;
- deterministic goal, Museum, and next-upgrade planning;
- structured SkyBlock objectives and domain context events;
- CLI, MCP service, TUI, and local web interfaces over the same core.

Known uncertainty remains explicit for exact modifier valuation, pet-level/skin/dye value, Museum value parity, exact Senither/Lily formulas, DPS simulation, volatile meta thresholds, and exact route profitability.

Cross-interface coverage is defined in `packages/core/src/surface-contracts.ts`. The product validator rejects duplicate launch/config authorities and the test suite checks every mapped CLI command, MCP tool, and TUI screen.
