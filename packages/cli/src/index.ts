#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import { configPath, publicConfig, setConfigValue } from "@skyagent/core/store";
import { agentContextForPlayer } from "@skyagent/core/agent-context";
import { persistContextEvent, readPersistedContextEvents, serverStatusForPlayer, subscribeContextEvents } from "@skyagent/core/context-events";
import { DEFAULT_ACCESSORY_MAX_PRICE_LOOKUPS, DEFAULT_ACCESSORY_TIMEOUT_MS, accessoriesForPlayer, accessoryUpgradesForPlayer, missingAccessoriesForPlayer } from "@skyagent/core/accessories";
import { configuredProfileId, hypixelRequest, resolveMinecraftUsername, resourceEndpoint, skyblockProfiles, uuidFromNameOrUuid } from "@skyagent/core/hypixel";
import { inventoryForPlayer, inventorySectionForPlayer } from "@skyagent/core/inventory";
import { itemMetadata, normalizedItemsForPlayer } from "@skyagent/core/items";
import { museumDonationPlanForPlayer } from "@skyagent/core/museum";
import { DEFAULT_NETWORTH_INCLUDE_ITEMS, DEFAULT_NETWORTH_MAX_ITEMS, DEFAULT_NETWORTH_TIMEOUT_MS, itemNetworthForPlayer, networthForPlayer } from "@skyagent/core/networth";
import { completeObjectiveItem, createObjectiveItem, deleteObjectiveItem, listObjectiveItems, updateObjectiveItem } from "@skyagent/core/objectives";
import { nextUpgradesForPlayer, planGoalForPlayer } from "@skyagent/core/planner";
import { coflnetPriceHistory, itemPrice, lowestBin } from "@skyagent/core/prices";
import { profileSnapshotForPlayer } from "@skyagent/core/profile-cache";
import { compactProfileOverview, fetchProfileContext, profileSummaries, skycryptUrl } from "@skyagent/core/profile";
import { readinessForPlayer } from "@skyagent/core/readiness";
import { profileSectionForPlayer, progressionForPlayer } from "@skyagent/core/sections";
import { runSetup, setupStatus } from "@skyagent/core/setup";
import { weightForPlayer } from "@skyagent/core/weight";
import { runTui, tuiSnapshot } from "@skyagent/tui";
import { startMcpServer } from "@skyagent/mcp";
import { webCommand } from "./web.ts";

function print(value, pretty = true) {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function printLine(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function usageText() {
  return `SkyAgent CLI

Usage:
  agents packages run skyagent -- config get
  agents packages run skyagent -- config path
  agents packages run skyagent -- config set username <minecraftName>
  agents packages run skyagent -- config set uuid <uuid>
  agents packages run skyagent -- config set profile <profileId>
  agents packages run skyagent -- setup [--json] [--username <name>] [--profile <profileIdOrName>] [--no-write]
  agents packages run skyagent -- setup status [--json]
  agents packages run skyagent -- version [--json]
  agents packages run skyagent -- doctor [--json]
  agents packages run skyagent -- mcp
  agents packages run skyagent -- context [nameOrUuid] [profileIdOrName] [--cache-only] [--allow-stale] [--ttl-ms <ms>]  # cached read
  agents packages run skyagent -- context refresh [nameOrUuid] [profileIdOrName] [--ttl-ms <ms>]
  agents packages run skyagent -- context watch [--since <sequence>] [--limit <n>] [--once]
  agents packages run skyagent -- context emit [type] [--message <text>]
  agents packages run skyagent -- server-status [nameOrUuid]
  agents packages run skyagent -- objective create <objective|task|buy|source|snipe> <title> [--objective <id>] [--item-id <id>] [--target-price <coins>] [--budget <coins>] [--priority <n>] [--source-provider <name>] [--freshness-status <status>] [--freshness-source <source>] [--freshness-fetched-at <iso>] [--warning <code:message[:sourcePath]>...] [--note <text>] [--tag <tag>...]
  agents packages run skyagent -- objective list [--kind <kind>] [--status <status>] [--include-deleted]
  agents packages run skyagent -- objective update <id> [--title <text>] [--status <status>] [--objective <id>] [--item-id <id>] [--target-price <coins>] [--budget <coins>] [--priority <n>] [--source-provider <name>] [--freshness-status <status>] [--freshness-source <source>] [--freshness-fetched-at <iso>] [--warning <code:message[:sourcePath]>...] [--note <text>] [--tag <tag>...]
  agents packages run skyagent -- objective complete <id>
  agents packages run skyagent -- objective delete <id>
  agents packages run skyagent -- resolve <minecraftName>
  agents packages run skyagent -- player [nameOrUuid]
  agents packages run skyagent -- status [nameOrUuid]
  agents packages run skyagent -- profiles [nameOrUuid]
  agents packages run skyagent -- profiles-summary [nameOrUuid]
  agents packages run skyagent -- profile [profileId]
  agents packages run skyagent -- profile-snapshot [nameOrUuid] [profileIdOrName] [--refresh] [--cache-only] [--allow-stale] [--ttl-ms <ms>]
  agents packages run skyagent -- member [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- overview [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- inventory [nameOrUuid] [profileIdOrName] [--debug-raw]
  agents packages run skyagent -- inventory-section <section> [nameOrUuid] [profileIdOrName] [--debug-raw]
  agents packages run skyagent -- item-dump [nameOrUuid] [profileIdOrName] --section <section> [--debug-raw]
  agents packages run skyagent -- normalize-items [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- networth [nameOrUuid] [profileIdOrName] [--max-items <n>] [--timeout-ms <ms>] [--details]
  agents packages run skyagent -- item-networth [nameOrUuid] [profileIdOrName] --section <section> [--max-items <n>] [--timeout-ms <ms>] [--summary]
  agents packages run skyagent -- accessories [nameOrUuid] [profileIdOrName] [--max-price-lookups <n>] [--timeout-ms <ms>]
  agents packages run skyagent -- missing-accessories [nameOrUuid] [profileIdOrName] [--max-price-lookups <n>] [--timeout-ms <ms>]
  agents packages run skyagent -- accessory-upgrades [nameOrUuid] [profileIdOrName] --budget <coins> [--max-price-lookups <n>] [--timeout-ms <ms>]
  agents packages run skyagent -- section <name> [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- progression [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- weight [nameOrUuid] [profileIdOrName]
  agents packages run skyagent -- readiness <area[:target]> [nameOrUuid] [profileIdOrName] [--budget <coins>] [--max-items <n>] [--networth-timeout-ms <ms>] [--max-price-lookups <n>] [--accessory-timeout-ms <ms>]
  agents packages run skyagent -- plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>] [--use-context] [--persist-objectives] [--objective <id>] [--max-items <n>] [--networth-timeout-ms <ms>] [--max-price-lookups <n>] [--accessory-timeout-ms <ms>]
  agents packages run skyagent -- museum-plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>] [--max-price-lookups <n>] [--timeout-ms <ms>] [--persist-objectives]
  agents packages run skyagent -- next-upgrades [nameOrUuid] [profileIdOrName] --budget <coins> [--max-price-lookups <n>] [--accessory-timeout-ms <ms>]
  agents packages run skyagent -- item <internalId>
  agents packages run skyagent -- price <itemId>
  agents packages run skyagent -- lbin <itemId>
  agents packages run skyagent -- price-history <itemId> [window]
  agents packages run skyagent -- skycrypt [nameOrUuid] [profileName]
  agents packages run skyagent -- museum [profileId]
  agents packages run skyagent -- garden [profileId]
  agents packages run skyagent -- bingo [nameOrUuid]
  agents packages run skyagent -- resource <collections|skills|items|election|bingo>
  agents packages run skyagent -- bazaar
  agents packages run skyagent -- auctions [page]
  agents packages run skyagent -- auction <uuid|player|profile> <id>
  agents packages run skyagent -- auctions-ended
  agents packages run skyagent -- firesales
  agents packages run skyagent -- news
  agents packages run skyagent -- request <v2/path> [key=value ...]
  agents packages run skyagent -- tui [--smoke]
  agents packages run skyagent -- web start [--no-open] [--json]
  agents packages run skyagent -- web stop [--json]
  agents packages run skyagent -- web restart [--no-open] [--json]
  agents packages run skyagent -- web status [--json]
  agents packages run skyagent -- web open [--json]
  agents packages run skyagent -- web logs [--json]

Set the Hypixel API key only through: agents secrets set HYPIXEL_API_KEY
`;
}

function usage() {
  process.stdout.write(usageText());
}

function kvPairs(args) {
  const query = {};
  for (const arg of args) {
    const index = arg.indexOf("=");
    if (index === -1) {
      throw new Error(`Expected key=value, got: ${arg}`);
    }
    query[arg.slice(0, index)] = arg.slice(index + 1);
  }
  return query;
}

function withoutFlags(args) {
  return args.filter((arg) => !arg.startsWith("--"));
}

function optionValue(args, option) {
  const index = args.indexOf(option);
  return index === -1 ? null : args[index + 1] ?? null;
}

function optionValues(args, option) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === option && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

const GLOBAL_OUTPUT_FLAGS = new Set(["--json"]);
const GLOBAL_OPTION_VALUE_FLAGS = new Set([
  "--username",
  "--profile",
  "--ttl-ms",
  "--message",
  "--kind",
  "--type",
  "--status",
  "--title",
  "--objective",
  "--item-id",
  "--target-price",
  "--budget",
  "--priority",
  "--source-provider",
  "--freshness-status",
  "--freshness-source",
  "--freshness-fetched-at",
  "--warning",
  "--note",
  "--tag",
  "--section",
  "--max-items",
  "--timeout-ms",
  "--max-price-lookups",
  "--accessory-timeout-ms",
  "--networth-timeout-ms",
]);

export function parseGlobalOutputArgs(args) {
  const values = [];
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (GLOBAL_OUTPUT_FLAGS.has(arg) && isGlobalOutputFlag(args, index)) {
      json = true;
      continue;
    }
    values.push(arg);
    if (GLOBAL_OPTION_VALUE_FLAGS.has(arg) && index + 1 < args.length) {
      index += 1;
      values.push(args[index]);
    }
  }
  return { args: values, json };
}

function isGlobalOutputFlag(args, index) {
  if (index > 0 && GLOBAL_OPTION_VALUE_FLAGS.has(args[index - 1])) {
    return false;
  }

  const [area, action] = args;
  const isOnlyPositionalValue =
    area === "config" && action === "set" && index === 3 && args.length === 4;

  return !isOnlyPositionalValue;
}

function parseWarningValue(value: string) {
  const [code, message, ...sourceParts] = String(value).split(":");
  if (!code || !message) {
    throw new Error("--warning values must use code:message[:sourcePath]");
  }
  return {
    code,
    message,
    sourcePath: sourceParts.join(":") || null,
  };
}

function positionalArgs(args, optionsWithValues = []) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      if (optionsWithValues.includes(arg)) {
        index += 1;
      }
      continue;
    }
    values.push(arg);
  }
  return values;
}

export function parseInventoryArgs(args) {
  return {
    values: withoutFlags(args),
    debugRaw: args.includes("--debug-raw"),
  };
}

export function parseItemDumpArgs(args) {
  const section = optionValue(args, "--section");
  return {
    section,
    values: positionalArgs(args, ["--section"]),
    debugRaw: args.includes("--debug-raw"),
  };
}

export function parseItemNetworthArgs(args) {
  const section = optionValue(args, "--section");
  return {
    section,
    values: positionalArgs(args, ["--section", "--max-items", "--timeout-ms", "--summary", "--details"]),
    ...parseNetworthBounds(args, true),
  };
}

function optionalNumericOption(args, option) {
  const value = optionValue(args, option);
  return value === null ? undefined : Number(value);
}

function optionalBoundedNumericOption(args, option, fallback, { min = 0, integer = false } = {}) {
  const value = optionValue(args, option);
  if (value === null) {
    return fallback;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min) {
    throw new Error(`${option} must be a finite number greater than or equal to ${min}.`);
  }
  if (integer && !Number.isInteger(number)) {
    throw new Error(`${option} must be an integer.`);
  }
  return number;
}

function parseNetworthBounds(args, defaultIncludeItems = DEFAULT_NETWORTH_INCLUDE_ITEMS) {
  return {
    maxItems: optionalNumericOption(args, "--max-items") ?? DEFAULT_NETWORTH_MAX_ITEMS,
    timeoutMs: optionalNumericOption(args, "--timeout-ms") ?? DEFAULT_NETWORTH_TIMEOUT_MS,
    includeItems: args.includes("--summary") ? false : args.includes("--details") ? true : defaultIncludeItems,
  };
}

function parseAccessoryBounds(args) {
  return {
    maxPriceLookups: optionalNumericOption(args, "--max-price-lookups") ?? DEFAULT_ACCESSORY_MAX_PRICE_LOOKUPS,
    timeoutMs: optionalNumericOption(args, "--timeout-ms") ?? optionalNumericOption(args, "--accessory-timeout-ms") ?? DEFAULT_ACCESSORY_TIMEOUT_MS,
  };
}

export function parseAccessoryUpgradeArgs(args) {
  const budget = optionValue(args, "--budget");
  return {
    budget: budget === null ? null : Number(budget),
    values: positionalArgs(args, ["--budget", "--max-price-lookups", "--timeout-ms", "--accessory-timeout-ms"]),
    ...parseAccessoryBounds(args),
  };
}

export function parseNextUpgradesArgs(args) {
  const budget = optionValue(args, "--budget");
  return {
    budget: budget === null ? null : Number(budget),
    values: positionalArgs(args, ["--budget", "--max-price-lookups", "--accessory-timeout-ms"]),
    maxPriceLookups: optionalNumericOption(args, "--max-price-lookups") ?? DEFAULT_ACCESSORY_MAX_PRICE_LOOKUPS,
    accessoryTimeoutMs: optionalNumericOption(args, "--accessory-timeout-ms") ?? DEFAULT_ACCESSORY_TIMEOUT_MS,
  };
}

export function parsePlanArgs(args) {
  const budget = optionValue(args, "--budget");
  return {
    goal: args[0] ?? null,
    budget: budget === null ? null : Number(budget),
    values: positionalArgs(args.slice(1), ["--budget", "--use-context", "--persist-objectives", "--objective", "--max-items", "--networth-timeout-ms", "--max-price-lookups", "--accessory-timeout-ms"]),
    useContext: args.includes("--use-context"),
    persistObjectives: args.includes("--persist-objectives"),
    objectiveId: optionValue(args, "--objective"),
    maxItems: optionalNumericOption(args, "--max-items") ?? DEFAULT_NETWORTH_MAX_ITEMS,
    networthTimeoutMs: optionalNumericOption(args, "--networth-timeout-ms") ?? DEFAULT_NETWORTH_TIMEOUT_MS,
    maxPriceLookups: optionalNumericOption(args, "--max-price-lookups") ?? DEFAULT_ACCESSORY_MAX_PRICE_LOOKUPS,
    accessoryTimeoutMs: optionalNumericOption(args, "--accessory-timeout-ms") ?? DEFAULT_ACCESSORY_TIMEOUT_MS,
  };
}

export function parseReadinessArgs(args) {
  const budget = optionValue(args, "--budget");
  return {
    area: args[0] ?? null,
    budget: budget === null ? null : Number(budget),
    values: positionalArgs(args.slice(1), ["--budget", "--max-items", "--networth-timeout-ms", "--max-price-lookups", "--accessory-timeout-ms"]),
    maxItems: optionalNumericOption(args, "--max-items") ?? DEFAULT_NETWORTH_MAX_ITEMS,
    networthTimeoutMs: optionalNumericOption(args, "--networth-timeout-ms") ?? DEFAULT_NETWORTH_TIMEOUT_MS,
    maxPriceLookups: optionalNumericOption(args, "--max-price-lookups") ?? DEFAULT_ACCESSORY_MAX_PRICE_LOOKUPS,
    accessoryTimeoutMs: optionalNumericOption(args, "--accessory-timeout-ms") ?? DEFAULT_ACCESSORY_TIMEOUT_MS,
  };
}

export function parseMuseumPlanArgs(args) {
  const budget = optionValue(args, "--budget");
  const positionals = positionalArgs(args, ["--budget", "--max-price-lookups", "--timeout-ms", "--persist-objectives"]);
  const goalParts = positionals.length ? [positionals[0]] : [];
  const values = positionals.slice(1);
  const first = String(positionals[0] ?? "");
  const startsWithMuseumIntent = /^(museum|donate|donation|plan|buy|source|snipe)$/i.test(first);
  const naturalGoalWord = /^[a-z][a-z0-9'’-]*$/i;
  const internalItemId = /^[A-Z0-9]+(?:_[A-Z0-9]+)+$/;
  const shouldExtendNaturalGoal = (token) => {
    const value = String(token);
    if (!naturalGoalWord.test(value)) {
      return false;
    }
    const parsedGoalWords = startsWithMuseumIntent ? goalParts.slice(1) : goalParts;
    if (parsedGoalWords.some((part) => internalItemId.test(String(part)))) {
      return false;
    }
    if (/^[a-z]/.test(value)) {
      return true;
    }
    return parsedGoalWords.length < 2;
  };
  if (startsWithMuseumIntent && values.length) {
    goalParts.push(values.shift());
    while (values.length && shouldExtendNaturalGoal(values[0])) {
      goalParts.push(values.shift());
    }
  } else {
    while (values.length && naturalGoalWord.test(first) && shouldExtendNaturalGoal(values[0])) {
      goalParts.push(values.shift());
    }
  }
  return {
    goal: goalParts.length ? goalParts.join(" ") : null,
    budget: budget === null ? null : Number(budget),
    values,
    maxPriceLookups: optionalBoundedNumericOption(args, "--max-price-lookups", 25, { min: 0, integer: true }),
    timeoutMs: optionalBoundedNumericOption(args, "--timeout-ms", 8_000, { min: 1, integer: true }),
    persistObjectives: args.includes("--persist-objectives"),
  };
}

export function parseSetupArgs(args) {
  return {
    json: args.includes("--json"),
    noWrite: args.includes("--no-write"),
    username: optionValue(args, "--username"),
    profile: optionValue(args, "--profile"),
  };
}

export function parseProfileSnapshotArgs(args) {
  const ttl = optionValue(args, "--ttl-ms");
  return {
    values: positionalArgs(args, ["--ttl-ms"]),
    refresh: args.includes("--refresh"),
    cacheOnly: args.includes("--cache-only"),
    allowStale: args.includes("--allow-stale"),
    ttlMs: ttl === null ? undefined : Number(ttl),
  };
}

export function parseContextArgs(args) {
  const ttl = optionValue(args, "--ttl-ms");
  const refresh = args[0] === "refresh" || args.includes("--refresh");
  const valueArgs = args[0] === "refresh" ? args.slice(1) : args.filter((arg) => arg !== "--refresh");
  return {
    refresh,
    values: positionalArgs(valueArgs, ["--ttl-ms"]),
    cacheOnly: args.includes("--cache-only"),
    allowStale: args.includes("--allow-stale"),
    ttlMs: ttl === null ? undefined : Number(ttl),
  };
}

function parseObjectivePatchArgs(args) {
  const patch: Record<string, any> = {};
  const map = {
    "--title": "title",
    "--status": "status",
    "--objective": "objectiveId",
    "--item-id": "itemId",
    "--target-price": "targetPrice",
    "--budget": "budget",
    "--priority": "priority",
    "--source-provider": "sourceProvider",
    "--note": "notes",
  };
  for (const [flag, key] of Object.entries(map)) {
    const value = optionValue(args, flag);
    if (value !== null) {
      patch[key] = value;
    }
  }
  const tags = optionValues(args, "--tag");
  if (tags.length) {
    patch.tags = tags;
  }
  const freshness: Record<string, any> = {};
  const freshnessStatus = optionValue(args, "--freshness-status");
  const freshnessSource = optionValue(args, "--freshness-source");
  const freshnessFetchedAt = optionValue(args, "--freshness-fetched-at");
  if (freshnessStatus !== null) freshness.status = freshnessStatus;
  if (freshnessSource !== null) freshness.source = freshnessSource;
  if (freshnessFetchedAt !== null) freshness.fetchedAt = freshnessFetchedAt;
  const warnings = optionValues(args, "--warning").map(parseWarningValue);
  if (warnings.length) freshness.warnings = warnings;
  if (Object.keys(freshness).length) {
    patch.freshness = freshness;
  }
  return patch;
}

function parseObjectiveCreateArgs(args) {
  const [itemKind, ...rest] = args;
  const titleParts = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg.startsWith("--")) {
      index += 1;
      continue;
    }
    titleParts.push(arg);
  }
  return {
    ...parseObjectivePatchArgs(rest),
    itemKind,
    title: titleParts.join(" "),
  };
}

async function watchContextEvents(args) {
  let latestSequence = Number(optionValue(args, "--since") ?? 0);
  const batch = readPersistedContextEvents({
    sinceSequence: optionValue(args, "--since") ?? 0,
    limit: optionValue(args, "--limit") ?? undefined,
  });
  latestSequence = Math.max(latestSequence, batch.latestSequence);
  if (args.includes("--once")) {
    print(batch);
    return;
  }

  for (const event of batch.events) {
    printLine(event);
  }

  await new Promise<void>((resolve) => {
    const unsubscribe = subscribeContextEvents((event) => {
      latestSequence = Math.max(latestSequence, event.sequence);
      printLine(event);
    });
    const interval = setInterval(() => {
      const nextBatch = readPersistedContextEvents({ sinceSequence: latestSequence });
      latestSequence = Math.max(latestSequence, nextBatch.latestSequence);
      for (const event of nextBatch.events) {
        printLine(event);
      }
    }, 1_000);
    function cleanup() {
      clearInterval(interval);
      unsubscribe();
      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
      resolve();
    }
    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
  });
}

async function promptSetupInputs(initial) {
  const current = publicConfig();
  if (!process.stdin.isTTY || initial.json) {
    return initial;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const username = initial.username ?? current.username ?? await rl.question("Minecraft username: ");
    const profile = initial.profile ?? await rl.question("SkyBlock profile name or ID (blank for selected/default): ");
    return {
      ...initial,
      username: username || null,
      profile: profile || null,
    };
  } finally {
    rl.close();
  }
}

export function doctorStatus() {
  const setup = setupStatus();
  return {
    ok: Boolean(setup.version && setup.dataDir && process.env.AGENTS_HOME),
    version: setup.version,
    managedBy: "agent-os",
    launch: "agents packages run skyagent --",
    runtime: {
      bun: typeof Bun !== "undefined" ? Bun.version : null,
      platform: process.platform,
      arch: process.arch,
    },
    dataDir: setup.dataDir,
    config: setup.config,
  };
}

export async function command(args) {
  const global = parseGlobalOutputArgs(args);
  const [area, action, ...rest] = global.args;
  const output = (value, pretty = true) => print(value, global.json ? false : pretty);

  if (!area || area === "help" || area === "--help" || area === "-h") {
    usage();
    return;
  }

  if (area === "config") {
    if (action === "path") {
      output({ configPath: configPath() });
      return;
    }
    if (action === "get") {
      output(publicConfig());
      return;
    }
    if (action === "set") {
      const [key, ...valueParts] = rest;
      const value = valueParts.join(" ");
      const keyMap = {
        username: "username",
        uuid: "uuid",
        profile: "selectedProfileId",
      } as const;
      if (!keyMap[key]) {
        throw new Error("Supported config keys: username, uuid, profile. Secrets are managed with `agents secrets set`.");
      }
      output(setConfigValue(keyMap[key], value));
      return;
    }
  }

  if (area === "setup") {
    const args = [action, ...rest].filter(Boolean);
    const compact = global.json;
    if (action === "status") {
      output(setupStatus(), !compact);
      return;
    }
    const parsed = parseSetupArgs(args);
    const inputs = await promptSetupInputs(parsed);
    output(await runSetup({
      username: inputs.username,
      profile: inputs.profile,
      write: !inputs.noWrite,
    }), !compact);
    return;
  }

  if (area === "version") {
    const version = setupStatus().version;
    output({ version });
    return;
  }

  if (area === "doctor") {
    output(doctorStatus());
    return;
  }

  if (area === "context") {
    if (action === "watch") {
      await watchContextEvents(rest);
      return;
    }
    if (action === "emit") {
      output(persistContextEvent({
        type: rest.find((arg) => !arg.startsWith("--")) ?? "cli.context_event",
        source: { kind: "cli", transport: "command" },
        payload: { message: optionValue(rest, "--message") ?? null },
        freshness: { status: "local", source: "cli" },
      }));
      return;
    }
    const parsed = parseContextArgs([action, ...rest].filter(Boolean));
    output(await agentContextForPlayer(parsed.values[0], parsed.values[1], {
      refresh: parsed.refresh,
      cacheOnly: parsed.cacheOnly ? true : undefined,
      allowStale: parsed.allowStale,
      ttlMs: parsed.ttlMs,
    }));
    return;
  }

  if (area === "server-status") {
    output(await serverStatusForPlayer(action));
    return;
  }

  if (area === "objective") {
    if (action === "create") {
      output(createObjectiveItem(parseObjectiveCreateArgs(rest)));
      return;
    }
    if (action === "list") {
      output(listObjectiveItems({
        kind: optionValue(rest, "--kind") ?? optionValue(rest, "--type"),
        status: optionValue(rest, "--status"),
        includeDeleted: rest.includes("--include-deleted"),
      }));
      return;
    }
    if (action === "update") {
      if (!rest[0]) {
        throw new Error("Usage: agents packages run skyagent -- objective update <id> [flags]");
      }
      output(updateObjectiveItem(rest[0], parseObjectivePatchArgs(rest.slice(1))));
      return;
    }
    if (action === "complete") {
      output(completeObjectiveItem(rest[0]));
      return;
    }
    if (action === "delete") {
      output(deleteObjectiveItem(rest[0]));
      return;
    }
    throw new Error("Usage: agents packages run skyagent -- objective create|list|update|complete|delete");
  }

  if (area === "mcp") {
    startMcpServer();
    return;
  }

  if (area === "tui") {
    if (action === "--smoke" || rest.includes("--smoke")) {
      output(tuiSnapshot(), true);
      return;
    }
    await runTui([action, ...rest].filter(Boolean));
    return;
  }

  if (area === "web") {
    output(await webCommand(action, rest), true);
    return;
  }

  if (area === "resolve") {
    output(await resolveMinecraftUsername(action));
    return;
  }

  if (area === "player") {
    const uuid = await uuidFromNameOrUuid(action);
    output(await hypixelRequest("player", { uuid }, { requireKey: true }));
    return;
  }

  if (area === "status") {
    const uuid = await uuidFromNameOrUuid(action);
    output(await hypixelRequest("status", { uuid }, { requireKey: true }));
    return;
  }

  if (area === "profiles") {
    output(await skyblockProfiles(action));
    return;
  }

  if (area === "profiles-summary") {
    const uuid = await uuidFromNameOrUuid(action);
    const response = await skyblockProfiles(uuid);
    output({
      uuid,
      profiles: profileSummaries(response.body?.profiles ?? [], uuid),
      rateLimit: response.rateLimit,
    });
    return;
  }

  if (area === "profile-snapshot") {
    const parsed = parseProfileSnapshotArgs([action, ...rest].filter(Boolean));
    output(await profileSnapshotForPlayer(parsed.values[0], parsed.values[1], {
      refresh: parsed.refresh,
      cacheOnly: parsed.cacheOnly,
      allowStale: parsed.allowStale,
      ttlMs: parsed.ttlMs,
    }));
    return;
  }

  if (area === "member") {
    const context = await fetchProfileContext(action, rest[0]);
    output({
      uuid: context.uuid,
      profile: {
        profileId: context.profile.profile_id,
        cuteName: context.profile.cute_name ?? null,
      },
      member: context.member,
      rateLimit: context.rateLimit,
    });
    return;
  }

  if (area === "overview") {
    output(compactProfileOverview(await fetchProfileContext(action, rest[0])));
    return;
  }

  if (area === "inventory") {
    const args = [action, ...rest].filter(Boolean);
    const parsed = parseInventoryArgs(args);
    output(await inventoryForPlayer(parsed.values[0], parsed.values[1], { debugRaw: parsed.debugRaw }));
    return;
  }

  if (area === "inventory-section") {
    const values = withoutFlags(rest);
    output(await inventorySectionForPlayer(action, values[0], values[1], { debugRaw: rest.includes("--debug-raw") }));
    return;
  }

  if (area === "item-dump") {
    const args = [action, ...rest].filter(Boolean);
    const parsed = parseItemDumpArgs(args);
    if (!parsed.section) {
      throw new Error("Usage: agents packages run skyagent -- item-dump [nameOrUuid] [profileIdOrName] --section <section>");
    }
    const result = await inventorySectionForPlayer(parsed.section, parsed.values[0], parsed.values[1], { debugRaw: parsed.debugRaw });
    output({
      uuid: result.uuid,
      profile: result.profile,
      section: result.section,
      sourcePath: result.sourcePath,
      itemCount: result.itemCount,
      items: result.items,
      warnings: result.warnings,
    });
    return;
  }

  if (area === "normalize-items") {
    const values = withoutFlags([action, ...rest].filter(Boolean));
    output(await normalizedItemsForPlayer(values[0], values[1]));
    return;
  }

  if (area === "networth") {
    const args = [action, ...rest].filter(Boolean);
    const values = positionalArgs(args, ["--max-items", "--timeout-ms", "--summary", "--details"]);
    const bounds = parseNetworthBounds(args);
    output(await networthForPlayer(values[0], values[1], bounds));
    return;
  }

  if (area === "item-networth") {
    const args = [action, ...rest].filter(Boolean);
    const parsed = parseItemNetworthArgs(args);
    if (!parsed.section) {
      throw new Error("Usage: agents packages run skyagent -- item-networth [nameOrUuid] [profileIdOrName] --section <section>");
    }
    output(await itemNetworthForPlayer(parsed.values[0], parsed.values[1], parsed.section, {
      maxItems: parsed.maxItems,
      timeoutMs: parsed.timeoutMs,
      includeItems: parsed.includeItems,
    }));
    return;
  }

  if (area === "accessories") {
    const args = [action, ...rest].filter(Boolean);
    const values = positionalArgs(args, ["--max-price-lookups", "--timeout-ms"]);
    output(await accessoriesForPlayer(values[0], values[1], parseAccessoryBounds(args)));
    return;
  }

  if (area === "missing-accessories") {
    const args = [action, ...rest].filter(Boolean);
    const values = positionalArgs(args, ["--max-price-lookups", "--timeout-ms"]);
    output(await missingAccessoriesForPlayer(values[0], values[1], parseAccessoryBounds(args)));
    return;
  }

  if (area === "accessory-upgrades") {
    const parsed = parseAccessoryUpgradeArgs([action, ...rest].filter(Boolean));
    if (parsed.budget === null || !Number.isFinite(parsed.budget) || parsed.budget < 0) {
      throw new Error("Usage: agents packages run skyagent -- accessory-upgrades [nameOrUuid] [profileIdOrName] --budget <coins>");
    }
    output(await accessoryUpgradesForPlayer(parsed.values[0], parsed.values[1], parsed.budget, {
      maxPriceLookups: parsed.maxPriceLookups,
      timeoutMs: parsed.timeoutMs,
    }));
    return;
  }

  if (area === "section") {
    if (!action) {
      throw new Error("Usage: agents packages run skyagent -- section <name> [nameOrUuid] [profileIdOrName]");
    }
    output(await profileSectionForPlayer(action, rest[0], rest[1]));
    return;
  }

  if (area === "progression") {
    const values = withoutFlags([action, ...rest].filter(Boolean));
    output(await progressionForPlayer(values[0], values[1]));
    return;
  }

  if (area === "weight") {
    const values = withoutFlags([action, ...rest].filter(Boolean));
    output(await weightForPlayer(values[0], values[1]));
    return;
  }

  if (area === "readiness") {
    const parsed = parseReadinessArgs([action, ...rest].filter(Boolean));
    if (!parsed.area) {
      throw new Error("Usage: agents packages run skyagent -- readiness <area[:target]> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    if (parsed.budget !== null && (!Number.isFinite(parsed.budget) || parsed.budget < 0)) {
      throw new Error("Usage: agents packages run skyagent -- readiness <area[:target]> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    output(await readinessForPlayer(parsed.area, parsed.values[0], parsed.values[1], {
      budget: parsed.budget,
      maxItems: parsed.maxItems,
      networthTimeoutMs: parsed.networthTimeoutMs,
      maxPriceLookups: parsed.maxPriceLookups,
      accessoryTimeoutMs: parsed.accessoryTimeoutMs,
    }));
    return;
  }

  if (area === "plan") {
    const parsed = parsePlanArgs([action, ...rest].filter(Boolean));
    if (!parsed.goal) {
      throw new Error("Usage: agents packages run skyagent -- plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    if (parsed.budget !== null && (!Number.isFinite(parsed.budget) || parsed.budget < 0)) {
      throw new Error("Usage: agents packages run skyagent -- plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    output(await planGoalForPlayer(parsed.goal, parsed.values[0], parsed.values[1], {
      budget: parsed.budget,
      useContext: parsed.useContext,
      persistObjectives: parsed.persistObjectives,
      objectiveId: parsed.objectiveId,
      maxItems: parsed.maxItems,
      networthTimeoutMs: parsed.networthTimeoutMs,
      maxPriceLookups: parsed.maxPriceLookups,
      accessoryTimeoutMs: parsed.accessoryTimeoutMs,
    }));
    return;
  }

  if (area === "museum-plan") {
    const parsed = parseMuseumPlanArgs([action, ...rest].filter(Boolean));
    if (!parsed.goal) {
      throw new Error("Usage: agents packages run skyagent -- museum-plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    if (parsed.budget !== null && (!Number.isFinite(parsed.budget) || parsed.budget < 0)) {
      throw new Error("Usage: agents packages run skyagent -- museum-plan <goal> [nameOrUuid] [profileIdOrName] [--budget <coins>]");
    }
    output(await museumDonationPlanForPlayer(parsed.goal, parsed.values[0], parsed.values[1], {
      budget: parsed.budget,
      maxPriceLookups: parsed.maxPriceLookups,
      timeoutMs: parsed.timeoutMs,
      persistObjectives: parsed.persistObjectives,
    }));
    return;
  }

  if (area === "next-upgrades") {
    const parsed = parseNextUpgradesArgs([action, ...rest].filter(Boolean));
    if (parsed.budget === null || !Number.isFinite(parsed.budget) || parsed.budget < 0) {
      throw new Error("Usage: agents packages run skyagent -- next-upgrades [nameOrUuid] [profileIdOrName] --budget <coins>");
    }
    output(await nextUpgradesForPlayer(parsed.values[0], parsed.values[1], parsed.budget, {
      maxPriceLookups: parsed.maxPriceLookups,
      accessoryTimeoutMs: parsed.accessoryTimeoutMs,
    }));
    return;
  }

  if (area === "item") {
    if (!action) {
      throw new Error("Usage: agents packages run skyagent -- item <internalId>");
    }
    output(await itemMetadata(action));
    return;
  }

  if (area === "price") {
    if (!action) {
      throw new Error("Usage: agents packages run skyagent -- price <itemId>");
    }
    output(await itemPrice(action));
    return;
  }

  if (area === "lbin") {
    if (!action) {
      throw new Error("Usage: agents packages run skyagent -- lbin <itemId>");
    }
    output(await lowestBin(action));
    return;
  }

  if (area === "price-history") {
    if (!action) {
      throw new Error("Usage: agents packages run skyagent -- price-history <itemId> [window]");
    }
    output(await coflnetPriceHistory(action, rest[0]));
    return;
  }

  if (area === "skycrypt") {
    output({ url: skycryptUrl(action ?? publicConfig().username ?? publicConfig().uuid, rest[0]) });
    return;
  }

  if (area === "profile") {
    output(await hypixelRequest("skyblock/profile", { profile: await configuredProfileId(action) }, { requireKey: true }));
    return;
  }

  if (area === "museum") {
    output(await hypixelRequest("skyblock/museum", { profile: await configuredProfileId(action) }, { requireKey: true }));
    return;
  }

  if (area === "garden") {
    output(await hypixelRequest("skyblock/garden", { profile: await configuredProfileId(action) }, { requireKey: true }));
    return;
  }

  if (area === "bingo") {
    const uuid = await uuidFromNameOrUuid(action);
    output(await hypixelRequest("skyblock/bingo", { uuid }, { requireKey: true }));
    return;
  }

  if (area === "resource") {
    output(await hypixelRequest(resourceEndpoint(action)));
    return;
  }

  if (area === "bazaar") {
    output(await hypixelRequest("skyblock/bazaar"));
    return;
  }

  if (area === "auctions") {
    output(await hypixelRequest("skyblock/auctions", { page: action || 0 }));
    return;
  }

  if (area === "auction") {
    const [lookupType, lookupId] = [action, rest[0]];
    if (!["uuid", "player", "profile"].includes(lookupType) || !lookupId) {
      throw new Error("Usage: agents packages run skyagent -- auction <uuid|player|profile> <id>");
    }
    output(await hypixelRequest("skyblock/auction", { [lookupType]: lookupId }, { requireKey: true }));
    return;
  }

  if (area === "auctions-ended") {
    output(await hypixelRequest("skyblock/auctions_ended"));
    return;
  }

  if (area === "firesales") {
    output(await hypixelRequest("skyblock/firesales"));
    return;
  }

  if (area === "news") {
    output(await hypixelRequest("skyblock/news", {}, { requireKey: true }));
    return;
  }

  if (area === "request") {
    output(await hypixelRequest(action, kvPairs(rest)));
    return;
  }

  throw new Error(`Unknown command: ${area}`);
}

export function runCli(args = process.argv.slice(2)) {
  command(args).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    if (error.result) {
      process.stderr.write(`${JSON.stringify(error.result, null, 2)}\n`);
    }
    process.exitCode = 1;
  });
}

if (import.meta.main) {
  runCli();
}
