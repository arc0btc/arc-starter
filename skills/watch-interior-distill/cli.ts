// Manual ticks + status for watch-interior-distill.

import { initDatabase } from "../../src/db.ts";
import { pollWatchInteriorDistill, SENSOR_NAME } from "./sensor.ts";
import { readHookState } from "../../src/sensors.ts";

function fail(msg: string): never {
  process.stderr.write(`watch-interior-distill: ${msg}\n`);
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(
    [
      "watch-interior-distill CLI",
      "",
      "  tick     Run pollWatchInteriorDistill() once, bypassing the 12h self-gate.",
      "           Set ARC_DISTILL_FORCE=1 to also bypass WATCH_INTERIOR_ENABLED.",
      "  status   Print hookState (lastDistilledReport, etc.).",
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
      const result = await pollWatchInteriorDistill();
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
