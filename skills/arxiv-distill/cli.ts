// Manual ticks + status for arxiv-distill.

import { initDatabase } from "../../src/db.ts";
import { pollArxivDistill, SENSOR_NAME } from "./sensor.ts";
import { readHookState } from "../../src/sensors.ts";

function fail(message: string): never {
  process.stderr.write(`arxiv-distill: ${message}\n`);
  process.exit(1);
}

function printHelp(): void {
  process.stdout.write(
    [
      "arxiv-distill CLI",
      "",
      "  tick     Run pollArxivDistill() once, bypassing the 12h self-gate.",
      "           Set ARC_DISTILL_FORCE=1 to also bypass ARXIV_DISTILL_ENABLED.",
      "  status   Print last_ran + lastDistilledDigest from hook state.",
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  initDatabase();
  switch (command) {
    case "tick": {
      const result = await pollArxivDistill();
      process.stdout.write(`result: ${result}\n`);
      break;
    }
    case "status": {
      const state = await readHookState(SENSOR_NAME);
      process.stdout.write(JSON.stringify(state, null, 2) + "\n");
      break;
    }
    default:
      fail(`unknown command: ${command}. Run with no args for help.`);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
