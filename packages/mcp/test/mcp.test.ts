import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { allContractMcpTools, SURFACE_CONTRACTS } from "@skyagent/core/surface-contracts";
import { callTool, textResult, tools } from "../src/tools.ts";

let tempHome: string;

beforeEach(() => {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-mcp-test-"));
  process.env.AGENTS_HOME = tempHome;
});

afterEach(() => {
  fs.rmSync(tempHome, { recursive: true, force: true });
  delete process.env.AGENTS_HOME;
});

test("MCP tool list covers every provider-neutral domain contract", () => {
  const names = tools.map((tool) => tool.name);
  for (const name of allContractMcpTools()) expect(names).toContain(name);
  expect(names).not.toContain(["skyagent", "start"].join("_"));
  expect(names.some((name) => name.includes("llm"))).toBe(false);
  expect(names.some((name) => name.includes("memory"))).toBe(false);
  expect(new Set(names).size).toBe(names.length);
});

test("bounded MCP schemas expose every contract bound", () => {
  for (const contract of SURFACE_CONTRACTS) {
    for (const [toolName, options] of Object.entries(contract.boundedMcpOptions ?? {})) {
      const schema = tools.find((tool) => tool.name === toolName)?.inputSchema;
      expect(schema).toBeTruthy();
      for (const option of options) expect(schema.properties).toHaveProperty(option);
    }
  }
});

test("config tools write only non-secret canonical application config", async () => {
  await callTool("skyagent_config_set", { key: "username", value: "Pastik_" });
  await callTool("skyagent_config_set", { key: "profile", value: "profile-1" });
  const config = await callTool("skyagent_config_get", {});
  expect(config).toMatchObject({ username: "Pastik_", selectedProfileId: "profile-1", apiKeyConfigured: false });
  expect(config.dataDir).toBe(path.join(tempHome, "runtime", "apps", "skyagent"));
  expect(tools.find((tool) => tool.name === "skyagent_config_set")?.inputSchema.properties.key.enum).not.toContain("api-key");
  await expect(callTool("skyagent_config_set", { key: "api-key", value: "secret" })).rejects.toThrow("Agent OS");
});

test("context event tools share canonical application history", async () => {
  const emitted = await callTool("skyagent_context_event_emit", {
    type: "mcp.test",
    payload: { ok: true },
  });
  const batch = await callTool("skyagent_context_events", { sinceSequence: 0, limit: 10 });
  expect(emitted).toMatchObject({ type: "mcp.test" });
  expect(batch.events).toContainEqual(expect.objectContaining({ id: emitted.id, type: "mcp.test" }));
});

test("objective MCP tools create, update, complete, and delete domain work", async () => {
  const created = await callTool("skyagent_objective_create", { itemKind: "buy", title: "Buy Hyperion", itemId: "HYPERION" });
  expect(created).toMatchObject({ title: "Buy Hyperion", itemId: "HYPERION" });
  const updated = await callTool("skyagent_objective_update", { id: created.id, notes: "Check current price" });
  expect(updated.notes).toBe("Check current price");
  expect((await callTool("skyagent_objective_complete", { id: created.id })).status).toBe("done");
  expect((await callTool("skyagent_objective_delete", { id: created.id })).status).toBe("deleted");
});

test("bounded tool arguments fail before any network request", async () => {
  await expect(callTool("skyblock_networth", { maxItems: -1 })).rejects.toThrow("maxItems must be a finite number");
  await expect(callTool("skyblock_accessories", { timeoutMs: 0 })).rejects.toThrow("timeoutMs must be a finite number");
  await expect(callTool("skyblock_readiness", { maxPriceLookups: 1.5 })).rejects.toThrow("maxPriceLookups must be an integer");
});

test("MCP text results serialize JSON without exposing implicit state", () => {
  expect(textResult({ ok: true })).toEqual({ content: [{ type: "text", text: "{\n  \"ok\": true\n}" }] });
});

test("canonical package CLI starts the MCP protocol service", async () => {
  const input = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    "",
  ].join("\n");
  const proc = Bun.spawn(["bun", "./packages/cli/src/bin.ts", "mcp"], {
    cwd: path.resolve(import.meta.dir, "../../.."),
    env: { ...process.env, AGENTS_HOME: tempHome },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(input);
  proc.stdin.end();
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain('"name":"skyagent"');
  expect(stdout).toContain('"name":"skyagent_context_get"');
  expect(stdout).not.toContain(["Lite", "LLM"].join(""));
});
