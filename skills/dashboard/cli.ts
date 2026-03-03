#!/usr/bin/env bun

import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const WEB_TS = join(ROOT, "src/web.ts");

function bunPath(): string {
  const path = Bun.which("bun");
  if (!path) {
    throw new Error("bun not found on PATH");
  }
  return path;
}

function start(args: string[]): void {
  // Parse --port flag
  let port = process.env.ARC_WEB_PORT || "3000";
  const portIdx = args.indexOf("--port");
  if (portIdx >= 0 && args[portIdx + 1]) {
    port = args[portIdx + 1];
  }

  const bun = bunPath();
  const result = Bun.spawnSync([bun, WEB_TS], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
    env: { ...process.env, ARC_WEB_PORT: port },
  });

  process.exit(result.exitCode);
}

function stop(): void {
  // Find and kill the bun src/web.ts process
  const result = Bun.spawnSync(["pkill", "-f", "bun.*src/web.ts"]);
  if (result.exitCode === 0) {
    process.stdout.write("Stopped arc web dashboard\n");
  } else {
    process.stdout.write("No running dashboard process found\n");
  }
}

function printUsage(): void {
  process.stdout.write(
    `dashboard CLI

USAGE
  arc skills run --name dashboard -- <subcommand>

SUBCOMMANDS
  start [--port 3000]   Start the web dashboard server
  stop                  Stop the web dashboard server
`
  );
}

// ---- Entry point ----

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "start":
      start(args.slice(1));
      break;
    case "stop":
      stop();
      break;
    default:
      if (sub) {
        process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      }
      printUsage();
      if (sub) process.exit(1);
      break;
  }
}

main();
