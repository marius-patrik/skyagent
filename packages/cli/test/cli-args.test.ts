import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { listObjectiveItems } from "@skyagent/core/objectives";
import { SURFACE_CONTRACTS, allContractCliCommands } from "@skyagent/core/surface-contracts";
import {
  command,
  doctorStatus,
  parseAccessoryUpgradeArgs,
  parseContextArgs,
  parseGlobalOutputArgs,
  parseInventoryArgs,
  parseItemDumpArgs,
  parseItemNetworthArgs,
  parseMuseumPlanArgs,
  parseNextUpgradesArgs,
  parsePlanArgs,
  parseProfileSnapshotArgs,
  parseReadinessArgs,
  parseSetupArgs,
  usageText,
} from "../src/index.ts";

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-cli-test-"));
  process.env.AGENTS_HOME = tempHome;
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  delete process.env.AGENTS_HOME;
});

describe("CLI argument parsing", () => {
  test("documents the canonical manager launch and every contract command", () => {
    const usage = usageText();
    expect(usage).toContain("agents packages run skyagent --");
    expect(usage).not.toContain("skyagent start");
    expect(usage).not.toContain("skyagent provider config");
    expect(usage).not.toContain("skyagent memory");
    for (const commandName of allContractCliCommands()) expect(usage).toContain(`agents packages run skyagent -- ${commandName}`);
    for (const flag of new Set(SURFACE_CONTRACTS.flatMap((contract) => contract.cliFlags ?? []))) expect(usage).toContain(flag);
  });

  test("global JSON output flags remain positional-safe", () => {
    expect(parseGlobalOutputArgs(["--json", "overview", "Notch", "Apple"])).toEqual({ json: true, args: ["overview", "Notch", "Apple"] });
    expect(parseGlobalOutputArgs(["context", "emit", "note", "--message", "--json"])).toEqual({ json: false, args: ["context", "emit", "note", "--message", "--json"] });
    expect(parseGlobalOutputArgs(["config", "set", "username", "--json"])).toEqual({ json: false, args: ["config", "set", "username", "--json"] });
  });

  test("parses inventory and item networth bounds", () => {
    expect(parseInventoryArgs(["--debug-raw"])).toEqual({ values: [], debugRaw: true });
    expect(parseItemDumpArgs(["--debug-raw", "--section", "accessory_bag"])).toEqual({ section: "accessory_bag", values: [], debugRaw: true });
    expect(parseItemNetworthArgs(["Notch", "--section", "armor", "--max-items", "25", "--timeout-ms", "500", "--summary"])).toEqual({
      section: "armor",
      values: ["Notch"],
      maxItems: 25,
      timeoutMs: 500,
      includeItems: false,
    });
  });

  test("parses bounded planning commands", () => {
    expect(parseAccessoryUpgradeArgs(["Notch", "Apple", "--budget", "1000000"])).toMatchObject({ budget: 1_000_000, values: ["Notch", "Apple"], maxPriceLookups: 75, timeoutMs: 8_000 });
    expect(parseNextUpgradesArgs(["Notch", "--budget", "1000000", "--max-price-lookups", "30"])).toMatchObject({ budget: 1_000_000, values: ["Notch"], maxPriceLookups: 30 });
    expect(parsePlanArgs(["f7", "Notch", "Apple", "--budget", "1000000", "--max-items", "50"])).toMatchObject({ goal: "f7", budget: 1_000_000, values: ["Notch", "Apple"], maxItems: 50 });
    expect(parseReadinessArgs(["dungeons:f7", "Notch", "Apple", "--budget", "1000000"])).toMatchObject({ area: "dungeons:f7", budget: 1_000_000, values: ["Notch", "Apple"] });
    expect(parseMuseumPlanArgs(["Museum GIANTS_SWORD", "Notch", "Apple", "--budget", "1000000"])).toMatchObject({ goal: "Museum GIANTS_SWORD", budget: 1_000_000, values: ["Notch", "Apple"] });
    expect(() => parseMuseumPlanArgs(["Museum TERMINATOR", "--timeout-ms", "0"])).toThrow("--timeout-ms must be a finite number");
  });

  test("setup accepts no secret-bearing flags", () => {
    expect(parseSetupArgs(["--json", "--username", "Pastik_", "--profile", "Apple", "--no-write"])).toEqual({
      json: true,
      noWrite: true,
      username: "Pastik_",
      profile: "Apple",
    });
    expect(usageText()).not.toContain("--api-key");
  });

  test("parses profile context cache controls", () => {
    expect(parseProfileSnapshotArgs(["Notch", "Apple", "--refresh", "--ttl-ms", "60000"])).toEqual({ values: ["Notch", "Apple"], refresh: true, cacheOnly: false, allowStale: false, ttlMs: 60_000 });
    expect(parseContextArgs(["refresh", "Notch", "Apple"])).toMatchObject({ refresh: true, values: ["Notch", "Apple"] });
  });

  test("invalid budgets fail before profile access", async () => {
    await expect(command(["plan", "f7", "--budget", "-1"])).rejects.toThrow("Usage: agents packages run skyagent -- plan");
  });

  test("config rejects secret keys and points to Agent OS", async () => {
    await command(["config", "set", "username", "Pastik_"]);
    await expect(command(["config", "set", "api-key", "secret"])).rejects.toThrow("agents secrets set");
  });

  test("status commands run without network access", async () => {
    await command(["version", "--json"]);
    await command(["doctor", "--json"]);
    await command(["setup", "status", "--json"]);
    expect(doctorStatus()).toMatchObject({ ok: true, version: "2.0.0", managedBy: "agent-os", launch: "agents packages run skyagent --" });
  });

  test("context events persist across canonical CLI processes", async () => {
    await command(["context", "emit", "cli.persisted_test", "--message", "hello"]);
    const proc = Bun.spawn(["bun", "./packages/cli/src/bin.ts", "context", "watch", "--once", "--since", "0", "--limit", "5"], {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: { ...process.env, AGENTS_HOME: tempHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    expect(await proc.exited).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("cli.persisted_test");
  });

  test("objective commands operate on canonical application state", async () => {
    await command(["objective", "create", "buy", "Buy", "Hyperion", "--item-id", "HYPERION", "--target-price", "2000000000"]);
    const created = listObjectiveItems({ kind: "buy" }).items[0];
    expect(created).toMatchObject({ title: "Buy Hyperion", itemId: "HYPERION" });
    await command(["objective", "complete", created.id]);
    expect(listObjectiveItems({ status: "done" }).items[0].id).toBe(created.id);
    await command(["objective", "delete", created.id]);
    expect(listObjectiveItems().items).toEqual([]);
  });

  test("canonical CLI entry exposes the provider-neutral TUI snapshot", async () => {
    const proc = Bun.spawn(["bun", "./packages/cli/src/bin.ts", "tui", "--smoke"], {
      cwd: path.resolve(import.meta.dir, "../../.."),
      env: { ...process.env, AGENTS_HOME: tempHome },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).json();
    expect(await proc.exited).toBe(0);
    expect(stdout.screens).toContain("profiles");
    expect(stdout.screens).not.toContain("agent");
  });
});
