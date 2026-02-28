// skills/stackspot/sensor.ts
// Autonomous stacking lottery participation — detect joinable pots, auto-join, monitor rewards

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "stackspot";
const INTERVAL_MINUTES = 7; // ~5-10 min range: sensor runs every 7 minutes
const JOIN_AMOUNT_USTX = 20000000; // 20 STX in micro-STX (1 STX = 1,000,000 micro-STX)
const SKILLS_ROOT = "../../github/aibtcdev/skills";

interface PotInfo {
  name: string;
  contract: string;
  maxParticipants: number;
  minAmountStx: number;
  currentValueUstx: string;
  isLocked: boolean;
}

interface PotListResponse {
  network: string;
  potCount: number;
  pots: PotInfo[];
}

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [sensor:stackspot] ${msg}`);
}

async function runUpstreamScript(
  script: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", script, ...args], {
    cwd: import.meta.dir + "/" + SKILLS_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NETWORK: "mainnet" }, // Stackspot is mainnet-only
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function listPots(): Promise<PotListResponse | null> {
  try {
    const script = import.meta.dir + "/" + SKILLS_ROOT + "/stackspot/stackspot.ts";
    const result = await runUpstreamScript(script, ["list-pots"]);

    if (result.exitCode !== 0) {
      log(`warn: list-pots failed: ${result.stderr}`);
      return null;
    }

    return JSON.parse(result.stdout) as PotListResponse;
  } catch (e) {
    const err = e as Error;
    log(`warn: list-pots error: ${err.message}`);
    return null;
  }
}

async function autoJoinPot(potName: string, contractId: string): Promise<boolean> {
  try {
    // Create a task for the dispatch layer to actually join the pot
    // (wallet unlock is required, which needs to happen in a separate task)
    const joinTaskSource = `sensor:${SENSOR_NAME}:auto-join:${contractId}`;
    const taskExists = pendingTaskExistsForSource(joinTaskSource);

    if (!taskExists) {
      log(`queuing auto-join task for pot ${potName} (${contractId})`);
      insertTask({
        subject: `Auto-join stackspot pot: ${potName} with 20 STX`,
        description: `Arc detected joinable pot '${potName}' (${contractId}). Auto-joining with 20 STX. Command: bun run github/aibtcdev/skills/stackspot/stackspot.ts join-pot --contract-name ${potName} --amount ${JOIN_AMOUNT_USTX}`,
        skills: JSON.stringify(["stackspot", "wallet"]),
        priority: 5,
        status: "pending",
        source: joinTaskSource,
      });
      return true;
    }
    return false;
  } catch (e) {
    const err = e as Error;
    log(`warn: auto-join task creation failed: ${err.message}`);
    return false;
  }
}

async function main(): Promise<void> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claim = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (claim.status === "skip") {
      log("skip (interval not ready)");
      return;
    }

    log("run started");

    // Initialize database
    initDatabase();

    // List all pots
    log("fetching stackspot pots...");
    const potList = await listPots();
    if (!potList) {
      log("could not fetch pot list; skipping");
      return;
    }

    log(`found ${potList.potCount} pots`);

    // Analyze each pot
    for (const pot of potList.pots) {
      log(`analyzing pot: ${pot.name} (${pot.contract})`);

      // Skip locked pots
      if (pot.isLocked) {
        log(`  skip: pot is locked`);
        continue;
      }

      const currentValue = BigInt(pot.currentValueUstx);
      const minRequired = BigInt(pot.minAmountStx * 1000000); // Convert to micro-STX

      log(
        `  pot status: value=${Number(currentValue) / 1000000} STX, min=${pot.minAmountStx} STX, locked=${pot.isLocked}`
      );

      // Check if Arc should join this pot
      // Strategy: queue one join task per pot if not locked
      const joinSource = `sensor:${SENSOR_NAME}:joined:${pot.contract}`;
      const alreadyQueued = pendingTaskExistsForSource(joinSource);

      if (!alreadyQueued) {
        log(`  action: queueing auto-join task`);
        await autoJoinPot(pot.name, pot.contract);
      } else {
        log(`  skip: already queued join for this pot`);
      }
    }

    log("run completed");
  } catch (e) {
    const err = e as Error;
    console.error(
      `[${new Date().toISOString()}] [sensor:stackspot] error: ${err.message}`
    );
    process.exit(1);
  }
}

await main();
