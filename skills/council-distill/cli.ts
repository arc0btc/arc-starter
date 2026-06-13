// Manual ticks + status for council-distill.

import { initDatabase } from "../../src/db.ts";
import { pollCouncilDistill, SENSOR_NAME } from "./sensor.ts";
import { readHookState } from "../../src/sensors.ts";

function fail(msg: string): never {
  process.stderr.write(`council-distill: ${msg}\n`);
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(
    [
      "council-distill CLI",
      "",
      "  tick     Run pollCouncilDistill() once, bypassing the 24h self-gate.",
      "           Set ARC_DISTILL_FORCE=1 to also bypass COUNCIL_DISTILL_ENABLED.",
      "  status   Print hookState (lastSeenHeadSha, lastDistillAt, failure counter, etc.).",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "help" || cmd === "--help") {
    printHelp();
    return;
  }
  initDatabase();
  switch (cmd) {
    case "tick": {
      const result = await pollCouncilDistill();
      process.stdout.write(`result: ${result}\n`);
      break;
    }
    case "status": {
      const state = await readHookState(SENSOR_NAME);
      process.stdout.write(JSON.stringify(state, null, 2) + "\n");
      break;
    }
    default:
      fail(`unknown command: ${cmd}. Run with no args for help.`);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
