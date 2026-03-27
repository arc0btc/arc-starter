// skills/stacks-stackspot/sensor.ts
// Autonomous stacking lottery participation — detect joinable pots, auto-join, monitor rewards

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "stacks-stackspot";
const INTERVAL_MINUTES = 7; // ~5-10 min range: sensor runs every 7 minutes
const JOIN_AMOUNT_USTX = 20000000; // 20 STX in micro-STX (1 STX = 1,000,000 micro-STX)
const SKILLS_ROOT = "../../github/aibtcdev/skills";

// Epoch 3.4 activation guard: block 943,333 (~2026-04-02 20:00 UTC)
// Prepare phase for cycle 132 starts at 943,150; reward phase at 943,250.
// Any pot started in the prepare window locks STX through the epoch transition.
// Pause auto-join 100 blocks before prepare phase and resume 167 blocks after activation.
const EPOCH_34_GUARD_START = 943050;
const EPOCH_34_GUARD_END = 943500;

interface ClarityValue<T> {
  value: T;
  [key: string]: unknown;
}

interface PotInfo {
  name: string;
  contract: string;
  maxParticipants: number | ClarityValue<number>;
  minAmountStx: number | ClarityValue<number>;
  currentValueUstx: string | ClarityValue<string>;
  isLocked: boolean | ClarityValue<boolean>;
}

function clarityUnwrap<T>(v: T | ClarityValue<T>): T {
  if (v !== null && typeof v === "object" && "value" in (v as object)) {
    return (v as ClarityValue<T>).value;
  }
  return v as T;
}

interface PotListResponse {
  network: string;
  potCount: number;
  pots: PotInfo[];
}

const log = createSensorLogger(SENSOR_NAME);

async function getCurrentBurnBlockHeight(): Promise<number | null> {
  try {
    const resp = await fetch("https://api.hiro.so/v2/pox");
    const data = (await resp.json()) as { current_burnchain_block_height?: number };
    return data.current_burnchain_block_height ?? null;
  } catch {
    return null;
  }
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
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      NETWORK: "mainnet",
    },
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
    const error = e as Error;
    log(`warn: list-pots error: ${error.message}`);
    return null;
  }
}

async function autoJoinPot(potName: string, contractId: string): Promise<boolean> {
  try {
    // Create a task for the dispatch layer to actually join the pot
    // (wallet unlock is required, which needs to happen in a separate task)
    const joinTaskSource = `sensor:${SENSOR_NAME}:joined:${contractId}`;
    const taskExists = pendingTaskExistsForSource(joinTaskSource);

    if (!taskExists) {
      log(`queuing auto-join task for pot ${potName} (${contractId})`);
      insertTask({
        subject: `Auto-join stackspot pot: ${potName} with 20 STX`,
        description: `Arc detected joinable pot '${potName}' (${contractId}). Auto-joining with 20 STX. Command: bun run github/aibtcdev/skills/stacks-stackspot/stackspot.ts join-pot --contract-name ${potName} --amount ${JOIN_AMOUNT_USTX}`,
        skills: JSON.stringify(["stacks-stackspot", "bitcoin-wallet"]),
        priority: 8,
        model: "haiku",
        status: "pending",
        source: joinTaskSource,
      });
      return true;
    }
    return false;
  } catch (e) {
    const error = e as Error;
    log(`warn: auto-join task creation failed: ${error.message}`);
    return false;
  }
}

export default async function stackspotSensor(): Promise<string> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Epoch 3.4 guard: pause auto-join during prepare phase + early reward phase
    const burnHeight = await getCurrentBurnBlockHeight();
    if (
      burnHeight !== null &&
      burnHeight >= EPOCH_34_GUARD_START &&
      burnHeight <= EPOCH_34_GUARD_END
    ) {
      log(
        `epoch-3.4-guard: burn block ${burnHeight} in guard window [${EPOCH_34_GUARD_START}-${EPOCH_34_GUARD_END}]; pausing auto-join until post-activation`
      );
      return "skip";
    }

    // List all pots
    log("fetching stackspot pots...");
    const potList = await listPots();
    if (!potList) {
      log("could not fetch pot list; skipping");
      return "skip";
    }

    log(`found ${potList.potCount} pots`);

    // Analyze each pot
    for (const pot of potList.pots) {
      log(`analyzing pot: ${pot.name} (${pot.contract})`);

      // Skip locked pots (unwrap Clarity value object if present)
      const isLocked = clarityUnwrap(pot.isLocked);
      if (isLocked) {
        log(`  skip: pot is locked`);
        continue;
      }

      const currentValueUstx = clarityUnwrap(pot.currentValueUstx);
      const minAmountStx = clarityUnwrap(pot.minAmountStx);
      const currentValue = BigInt(currentValueUstx);
      const minRequired = BigInt(Number(minAmountStx) * 1000000); // Convert to micro-STX

      log(
        `  pot status: value=${Number(currentValue) / 1000000} STX, min=${minAmountStx} STX, locked=${isLocked}`
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
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
