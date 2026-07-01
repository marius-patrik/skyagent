# Networth Comparison Smoke Notes

Source date: 2026-07-01

Public smoke target: `Notch` / `Apple`

Comparison references:

- SkyCrypt-style section layout: purse, bank, armor, equipment, wardrobe, inventory, ender chest, backpacks, accessories, pets.
- SkyHelper-Networth-style behavior: section totals, item totals, unknown or unpriced items, and assumptions surfaced with output.

Current tolerance:

- Exact totals are not expected to match SkyCrypt or SkyHelper while SkyAgent lacks modifier-specific valuation for enchantments, attributes, skins, dyes, gemstones, pet level, museum, and miscellaneous valuables.
- Direct item ID prices should be within the active provider's current Bazaar/LBIN result when a resolved price is available.
- Partial Hypixel auction `candidatePrice` values must not contribute to totals.

CI fixture coverage:

- `packages/core/test/networth.test.ts` verifies deterministic section totals, purse/bank inclusion, provider freshness, and unavailable price handling.
- Live comparison should be rerun manually after each modifier-valuation provider slice because public profile values and market prices are volatile.
