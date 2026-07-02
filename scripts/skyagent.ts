#!/usr/bin/env bun

export {};

function normalizedArgs(argv: string[]) {
  const raw = argv.slice(1);
  const launcher = raw[0]?.replace(/\\/g, "/").toLowerCase() ?? "";
  const launcherName = launcher.split("/").pop() ?? "";
  return launcher.endsWith("/scripts/skyagent.ts")
    || launcher.endsWith("/scripts/skyagent.js")
    || launcherName === "skyagent.ts"
    || launcherName === "skyagent.js"
    || launcherName === "skyagent.exe"
    || launcherName === "skyagent"
    ? raw.slice(1)
    : raw;
}

const args = normalizedArgs(process.argv);

if (process.env.SKYAGENT_INTERNAL_GATEWAY === "1") {
  process.argv = [process.argv[0] ?? "skyagent", process.argv[1] ?? "skyagent", ...args];
  await import("@skyagent/gateway/bin");
} else if (args[0] === "__gateway") {
  process.argv = [process.argv[0] ?? "skyagent", process.argv[1] ?? "skyagent", ...args.slice(1)];
  await import("@skyagent/gateway/bin");
} else if (args[0] === "tui") {
  if (args.includes("--smoke")) {
    const { tuiSnapshot } = await import("@skyagent/tui");
    process.stdout.write(`${JSON.stringify(tuiSnapshot(), null, 2)}\n`);
  } else {
    const { runTui } = await import("@skyagent/tui");
    await runTui(args.slice(1));
  }
} else {
  const { runCli } = await import("@skyagent/cli");
  await runCli(args);
}
