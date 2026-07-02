---
name: skyagent-objectives
description: Manage SkyAgent durable objectives and work items for Hypixel SkyBlock. Use for goals, todos, task lists, buy lists, source-item lists, snipe targets, objective progress, converting plans into tracked work, and reading objective context before recommendations.
metadata:
  display_name: "SkyAgent Objectives"
  short_description: "Track goals and buy lists."
  default_prompt: "Use $skyagent-objectives to turn my SkyBlock plan into tracked tasks."
---

# SkyAgent Objectives

Use this skill when the user wants goals, todos, buy lists, source lists, snipe targets, or durable planning state.

## Tool Routing

- Use `skyagent_objective_list` before planning when existing objectives may change what should be recommended.
- Use `skyblock_plan_goal` with `persistObjectives: true` only after the user explicitly wants a plan saved as durable work.
- Use `skyagent_objective_create` for a new objective, task/todo, buy-list item, source-item entry, or snipe target.
- Use `skyagent_objective_update` to change status, priority, budget, target price, notes, item ID, provider, freshness, warnings, or payload.
- Use `skyagent_objective_complete` when the user says a goal, task, purchase, source item, or snipe target is done.
- Use `skyagent_objective_delete` only when the user asks to remove a record.
- Use `$skyagent-context-engine` before objective-aware recommendations so current context and objective summaries agree.
- Use `$skyagent-live-progress` when progress should be inferred from context-stream events before changing objective status.
- For accepted plans, map planner candidates deterministically: goals to `objective`, steps to `task`, purchases to `buy`, acquisition routes to `source`, and auction watches to `snipe`.

## Item Types

- Objectives are root goals with the user's target, constraints, and status.
- Tasks/todos are actionable steps that do not require a purchase.
- Buy-list entries are planned purchases with budget, price evidence, freshness, warnings, and priority.
- Source-item entries track items to grind, craft, drop, forge, garden-produce, dungeon-drop, or otherwise acquire.
- Snipe targets track auction or market watches with item ID, target price, budget, provider, freshness, and warning metadata.

## Rules

- Do not write objectives during preview-only planning.
- Ask before persisting a route unless the user already requested tracking, todos, buy lists, or snipe targets.
- Read recent context events before revising active objectives so captured progress does not need to be retyped by the user.
- Preserve source provider, price/budget evidence, source freshness, uncertainty, warnings, prerequisites, and expected impact.
- Do not mark progress complete from weak inference. Use explicit user confirmation or reliable context/live events.
- Keep objective records operational: short titles, clear next actions, status, priority, and enough payload to resume later.
- Never store secrets in objectives or objective payloads.
