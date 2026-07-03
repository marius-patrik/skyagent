---
name: skyagent-readiness-weight
description: Analyze SkyBlock weight estimates and activity readiness with SkyAgent. Use for Senither/Lily-style weight status, unsupported exact formulas, readiness for dungeons, slayer, kuudra, garden, or mining, formula freshness, assumptions, and missing-data limits.
metadata:
  display_name: "SkyAgent Readiness"
  short_description: "Estimate weight and activity readiness."
  default_prompt: "Use $skyagent-readiness-weight to check my dungeon readiness."
---

# SkyAgent Readiness/Weight

Use this skill when the user asks whether a profile is ready for an activity, asks for profile weight, or compares readiness against a goal.

## Tool Routing

- Use `skyblock_weight` for labeled profile-weight estimates, exact Senither/Lily unsupported status, formula provenance, assumptions, and missing data warnings.
- Use `skyblock_readiness` for activity readiness in `dungeons`, `slayer`, `kuudra`, `garden`, or `mining`; pass target-aware area strings such as `dungeons:f7`, `slayer:zombie:t4`, `slayer:eman:t4`, `kuudra:basic`, or `kuudra:burning` when the user names a target.
- Use `skyblock_profile_section` or `skyblock_progression` first only when the user needs the underlying section evidence behind a readiness or weight result.
- Use `$skyagent-context-engine` before broad readiness decisions so cached profile state, gear/pets/accessories, objectives, provider freshness, and warnings are available.
- Use `$skyagent-live-progress` when recent profile refresh events or session progress may have changed readiness.
- Use `$skyagent-objectives` when readiness gaps should become todos, buy-list entries, source-item tasks, or snipe targets.
- Route pure section summaries back to `$skyagent-progression`.
- For damage, Slayer, Dungeon, or Kuudra advice, start with target-aware `skyblock_readiness`; it should return checked armor, equipment, weapon, pet, Magical Power/accessory, modifier, freshness, and missing-field blockers. Use `$skyagent-inventory-items` or `$skyagent-accessories` only for follow-up detail when readiness reports a missing or uncertain section.

## Rules

- Treat exact Senither/Lily-style weight as unsupported unless maintained formula tables are bundled and the tool reports exact support.
- Label current weight outputs as estimates when the tool reports unsupported exact formulas.
- Preserve formula freshness, source fields, assumptions, unsupported statuses, and missing-data warnings.
- Do not present heuristic readiness as a guarantee of success, party acceptance, or profit.
- Verify current external meta before strong recommendations about F7/M7, Slayer tiers, Kuudra tiers, Garden contests, Mining methods, or patch-sensitive gear thresholds.
- Treat `readinessContext.gear`, failed check `blocker` fields, and `target` as the primary evidence for combat recommendations.
- If required profile sections are missing, report readiness as unknown or partial instead of filling gaps with assumptions.
- Refresh context after major gear, pet, accessory, or progression changes before recalculating readiness.
- If gear, pets, accessories, or profile sections are missing, state the missing readiness input and use the best narrow fallback before recommending buys.
