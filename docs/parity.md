# SkyBlock Tool Parity

SkyAgent currently covers official Hypixel API transport and light profile-viewer abstractions. It is not yet at SkyCrypt or Discord bot feature parity.

## Covered

- Mojang username to UUID resolution.
- Hypixel v2 raw request escape hatch.
- Player, status, SkyBlock profiles, profile by ID, museum, garden, player bingo.
- Public SkyBlock resources: collections, skills, items, election, bingo.
- Public economy/event surfaces: Bazaar, auctions, ended auctions, fire sales.
- Compact profile summaries, selected member extraction, overview metadata, and SkyCrypt URL generation.
- Local config and memory storage outside the repo.

## Missing for SkyCrypt-Style Parity

- Inventory decoding for base64 gzipped NBT fields.
- Item normalization, enchantments, attributes, reforges, gemstones, stars, dungeon quality, and item lore parsing.
- Armor, equipment, weapons, wardrobe, inventory, ender chest, backpack, vault, and accessory bag section views.
- Networth calculation and per-section networth breakdown.
- Missing accessories and cheapest-upgrade ranking.
- Skill level calculation from XP tables.
- Dungeons, Slayer, Bestiary, Mining/HotM, Farming/Garden, Trophy Fishing, Crimson Isle, Rift, Kuudra, and Collections section renderers.
- Weight calculations such as Senither/Lily-style weight.
- Historical price sources and lowest-BIN search beyond raw auction pages.

## Common Tool Signals

- SkyCrypt presents profile viewer sections such as stats, skills, armor, weapons, accessories, and uses Hypixel API, NotEnoughUpdates data, and SkyHelper Networth.
- SkyHelper-style bots commonly expose networth, item networth, profile lookup by user/profile, and utility endpoints such as Fetchur.
- Discord bot lists commonly advertise networth, missing accessories/talismans, stat optimization, bazaar prices, lowest BIN, auctions, minions, timers, updates, profile stats, skills, Dungeons, and Slayer.

## Next Implementation Layers

1. Add an inventory/NBT parser and section extractors.
2. Add item metadata from NotEnoughUpdates or another maintained item dataset.
3. Add price providers for Bazaar, lowest BIN, and optional third-party historical prices.
4. Add networth and missing-accessory calculators.
5. Add profile modules for skills, Dungeons, Slayer, Mining, Farming, Bestiary, Collections, and Minions.

