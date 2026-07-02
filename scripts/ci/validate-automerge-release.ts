#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const root = path.resolve(import.meta.dir, "..", "..");
const workflowPath = path.join(root, ".github", "workflows", "automerge.yml");
const workflow = YAML.parse(fs.readFileSync(workflowPath, "utf8"));

function fail(message: string): never {
  throw new Error(`Automerge release validation failed: ${message}`);
}

function steps() {
  const job = workflow?.jobs?.automerge;
  if (!job) fail("missing automerge job");
  const contentsPermission = job.permissions?.contents ?? workflow?.permissions?.contents;
  if (contentsPermission !== "write") fail("automerge workflow must keep contents: write for release publication");
  return job.steps ?? [];
}

function named(name: string) {
  const step = steps().find((entry: any) => entry?.name === name);
  if (!step) fail(`missing step: ${name}`);
  return step;
}

function text(value: unknown) {
  return String(value ?? "");
}

const checkout = named("Checkout merged main");
const checkoutRun = text(checkout.run);
if (!checkoutRun.includes("git fetch origin main --tags")) fail("merged-main checkout must fetch main and tags");
if (!checkoutRun.includes("git checkout origin/main")) fail("merged-main checkout must check out origin/main");
if (!checkoutRun.includes('release_sha="$(git rev-parse HEAD)"')) {
  fail("merged-main checkout must capture the release target SHA");
}
if (!checkoutRun.includes("skyagent-automerge-push-event.json")) fail("merged-main checkout must write a synthetic push event");
if (!checkoutRun.includes('"ref":"refs/heads/main"')) fail("synthetic push event must target refs/heads/main");
if (!checkoutRun.includes('"after":"$release_sha"')) fail("synthetic push event must target the captured release SHA");
if (!checkoutRun.includes("SKYAGENT_GITHUB_EVENT_PATH=$event_path")) {
  fail("synthetic push event path must be exported through a SkyAgent-owned variable");
}
if (/(^|\n)\s*echo\s+"GITHUB_EVENT_PATH=\$event_path"/.test(checkoutRun)) {
  fail("synthetic push event must not overwrite GITHUB_EVENT_PATH");
}

const plan = named("Plan release for merged main");
if (plan.env?.GITHUB_EVENT_NAME !== "push") fail("release plan must simulate push semantics");
if (plan.env?.GITHUB_REF !== "refs/heads/main") fail("release plan must target refs/heads/main");
if (plan.env?.GITHUB_SHA !== "${{ env.SKYAGENT_AUTOMERGE_RELEASE_SHA }}") {
  fail("release plan must use the captured merged-main SHA");
}
if (plan.env?.GITHUB_EVENT_PATH) fail("release plan must not overwrite the reserved GITHUB_EVENT_PATH variable");
if (plan.env?.SKYAGENT_GITHUB_EVENT_PATH !== "${{ env.SKYAGENT_GITHUB_EVENT_PATH }}") {
  fail("release plan must use the exported SkyAgent synthetic event path");
}
if (!text(plan.run).includes("bun ./scripts/plan-release.ts")) fail("release plan must use the shared planner");

const requiredReleaseSteps = [
  ["Build release artifacts", "bun run build:release -- --version"],
  ["Smoke current release artifact", "bun ./scripts/smoke-release.ts"],
  ["Write release metadata", "bun ./scripts/write-release-metadata.ts"],
] as const;

for (const [name, command] of requiredReleaseSteps) {
  const step = named(name);
  if (!text(step.run).includes(command)) fail(`${name} must run ${command}`);
}

const publish = named("Publish GitHub Release");
const publishRun = text(publish.run);
if (!publishRun.includes("gh release create")) fail("publish step must create a GitHub Release");
if (publish.env?.RELEASE_TARGET !== "${{ env.SKYAGENT_AUTOMERGE_RELEASE_SHA }}") {
  fail("publish step must receive the captured merged-main SHA");
}
if (!publishRun.includes('--target "$RELEASE_TARGET"')) {
  fail("publish step must target the captured merged-main SHA");
}
if (!publishRun.includes("gh release view")) fail("publish step must check for an existing release before creating one");
if (!publishRun.includes("already exists for $RELEASE_TARGET; skipping duplicate publish")) {
  fail("publish step must be idempotent when the same release already exists");
}
if (!publishRun.includes("not $RELEASE_TARGET")) fail("publish step must fail on conflicting existing releases");
if (!publishRun.includes("dist/release/update.json")) fail("publish step must include update metadata");
if (publish.env?.GH_TOKEN !== "${{ github.token }}") fail("publish step must use the workflow token");

console.log("Automerge release validation passed");
