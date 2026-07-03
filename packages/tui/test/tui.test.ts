import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { stopGatewayProcess } from "@skyagent/gateway/manager";
import { SURFACE_CONTRACTS } from "@skyagent/core/surface-contracts";
import { activeObjectiveItems, agentConsumesPrintableInput, agentInputAction, agentRefreshShortcut, agentShouldAppendPrintableInput, applyAgentTranscriptDelta, connectTuiGateway, finishAgentTranscript, objectiveActionLabel, objectiveCursorAction, SkyAgentTuiApp, startAgentTranscript, tuiDegradedMessages, tuiSnapshot, tuiStatus } from "../src/index.tsx";

let tempHome: string | null = null;

afterEach(async () => {
  if (tempHome) {
    await stopGatewayProcess();
    fs.rmSync(tempHome, { recursive: true, force: true });
    tempHome = null;
  }
  delete process.env.SKYAGENT_HOME;
  delete process.env.SKYAGENT_GATEWAY_PORT;
});

function isolatedSkyAgentHome() {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "skyagent-tui-test-"));
  process.env.SKYAGENT_HOME = tempHome;
  process.env.SKYAGENT_GATEWAY_PORT = String(20_000 + Math.floor(Math.random() * 20_000));
}

test("tui status initializes without live credentials", () => {
  const status = tuiStatus();

  expect(status.surface).toBe("tui");
  expect(status.renderer).toBe("ink");
  expect(status.ready).toBe(true);
  expect(status.config.apiKeyConfigured).toBeTypeOf("boolean");
});

test("tui smoke snapshot exposes screens and does not print secrets", () => {
  const snapshot = tuiSnapshot();

  expect(snapshot.screens).toContain("agent");
  expect(snapshot.screens).toContain("status");
  expect(snapshot.screens).toContain("profiles");
  expect(snapshot.screens).toContain("overview");
  expect(snapshot.screens).toContain("debug");
  expect(snapshot.shortcuts).toContain("up/down or j/k");
  expect(snapshot.shortcuts).toContain("left/right or h/l");
  expect(snapshot.shortcuts).toContain("tab add objective");
  expect(snapshot.shortcuts).toContain("x complete objective");
  expect(snapshot.secrets).toContain("never printed");
  expect(snapshot.renderer).toBe("ink");
  expect(snapshot.contractCoverage.map((contract: any) => contract.id)).toEqual(SURFACE_CONTRACTS.map((contract) => contract.id));
  expect(snapshot.trackedContractGaps.every((gap: any) => gap.issue === 115)).toBe(true);
  for (const contract of snapshot.contractCoverage) {
    for (const screen of contract.screens) {
      expect(snapshot.screens as string[]).toContain(screen);
    }
  }
});

test("tui exports an Ink-backed React app surface", () => {
  expect(SkyAgentTuiApp).toBeTypeOf("function");
});

test("agent prompt keeps q as quit only before message input starts", () => {
  expect(agentInputAction("q", "")).toEqual({ action: "quit", input: "" });
  expect(agentInputAction("r", "")).toEqual({ action: "append", input: "r" });
  expect(agentInputAction("r", "oute to F7")).toEqual({ action: "append", input: "oute to F7r" });
  expect(agentInputAction("q", "how much is ")).toEqual({ action: "append", input: "how much is q" });
});

test("agent prompt reserves refresh for ctrl+r", () => {
  expect(agentRefreshShortcut("r", { ctrl: true })).toBe(true);
  expect(agentRefreshShortcut("\x12", { ctrl: true })).toBe(true);
  expect(agentRefreshShortcut("r", {})).toBe(false);
});

test("agent prompt leaves vim navigation keys global until text input starts", () => {
  expect(agentConsumesPrintableInput("j", "")).toBe(false);
  expect(agentConsumesPrintableInput("k", "")).toBe(false);
  expect(agentConsumesPrintableInput("h", "")).toBe(false);
  expect(agentConsumesPrintableInput("l", "")).toBe(false);
  expect(agentConsumesPrintableInput("\n", "juju")).toBe(false);
  expect(agentConsumesPrintableInput("\r", "juju")).toBe(false);
  expect(agentConsumesPrintableInput("j", "juju")).toBe(true);
});

test("agent prompt does not append backspace or delete control input", () => {
  expect(agentShouldAppendPrintableInput("\b", "juju", { backspace: true })).toBe(false);
  expect(agentShouldAppendPrintableInput("\x7f", "juju", { delete: true })).toBe(false);
  expect(agentShouldAppendPrintableInput("\t", "Buy Juju", { tab: true })).toBe(false);
  expect(agentShouldAppendPrintableInput("\t", "Buy Juju")).toBe(false);
  expect(agentShouldAppendPrintableInput("u", "juj")).toBe(true);
});

test("agent transcript tracks streaming assistant state", () => {
  const started = startAgentTranscript([], "what next?");
  expect(started).toEqual([
    { role: "user", content: "what next?" },
    { role: "assistant", content: "", pending: true },
  ]);

  const streamed = applyAgentTranscriptDelta(started, "Do dailies.");
  expect(streamed.at(-1)).toEqual({ role: "assistant", content: "Do dailies.", pending: true });

  const finished = finishAgentTranscript(streamed, "Do dailies.");
  expect(finished.at(-1)).toEqual({ role: "assistant", content: "Do dailies." });

  expect(applyAgentTranscriptDelta([], "Recovered.")).toEqual([{ role: "assistant", content: "Recovered.", pending: true }]);
  expect(finishAgentTranscript([], "")).toEqual([{ role: "assistant", content: "(no text returned)" }]);
});

test("agent degraded state exposes missing Hypixel and provider auth guidance", () => {
  const messages = tuiDegradedMessages(
    { username: null, uuid: null, apiKeyConfigured: false, selectedProfileId: null },
    {
      warnings: [{ code: "snapshot_only_context", message: "Context was built from cached snapshot data only." }],
      providerStatus: {
        llm: {
          warnings: [{ code: "llm_provider_missing", message: "Configure SkyAgent with provider=litellm before starting the persistent agent runtime." }],
        },
      },
    },
    true,
  );

  expect(messages.join("\n")).toContain("username or UUID");
  expect(messages.join("\n")).toContain("Hypixel API key");
  expect(messages.join("\n")).toContain("selected profile");
  expect(messages.join("\n")).toContain("cached snapshot");
  expect(messages.join("\n")).toContain("provider=litellm");
});

test("agent objective controls expose selectable actionable work items", () => {
  const agent = {
    objectives: {
      active: [
        { id: "obj-1", title: "Buy Juju", status: "open" },
        { id: "obj-2", title: "Done thing", status: "done" },
        { id: "obj-3", title: "Run dailies", status: "active" },
      ],
    },
  };

  expect(activeObjectiveItems(agent).map((item: any) => item.id)).toEqual(["obj-1", "obj-3"]);
  expect(objectiveCursorAction("]", 0, 2)).toBe(1);
  expect(objectiveCursorAction("[", 0, 2)).toBe(1);
  expect(objectiveCursorAction("", 5, 2)).toBe(1);
  expect(objectiveActionLabel("tab")).toBe("create");
  expect(objectiveActionLabel("\t")).toBe("create");
  expect(objectiveActionLabel("x")).toBe("complete");
});

test("tui gateway session starts local gateway and returns redacted config", async () => {
  isolatedSkyAgentHome();

  const session = await connectTuiGateway();

  expect(session.gateway.status.running).toBe(true);
  expect(session.gateway.status.url).toStartWith("http://127.0.0.1:");
  expect(session.agent.running).toBe(true);
  expect(session.agent.ready).toBe(true);
  expect(session.config.apiKeyConfigured).toBeTypeOf("boolean");
  expect(JSON.stringify(session.gateway.status)).not.toContain("\"token\":");
  expect(JSON.stringify(session.config)).not.toContain("apiKey\":");
});

test("root skyagent script delegates tui smoke mode", async () => {
  const proc = Bun.spawn(["bun", "./scripts/skyagent.ts", "tui", "--smoke"], {
    cwd: path.resolve(import.meta.dir, "../../.."),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).json();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(stdout.surface).toBe("tui");
  expect(stdout.screens).toContain("profiles");
});
