// skills/stacks-stackspot/sensor.ts
// Autonomous stacking lottery participation — detect joinable pots, auto-join, monitor rewards

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "stacks-stackspot";
const INTERVAL_MINUTES = 7; // ~5-10 min range: sensor runs every 7 minutes
const JOIN_AMOUNT_USTX = 20000000; // 20 STX in micro-STX (1 STX = 1,000,000 micro-STX)
const SKILLS_ROOT = "../../github/aibtcdev/skills";
const POX_WATCH_STATE_PATH = import.meta.dir + "/../../db/stackspot-pox-watch.json";
const POX5_CYCLE_BLOCKS = 2100; // ~1 PoX reward cycle (prepare + reward phase)
const POX_INFO_URL = "https://api.hiro.so/v2/pox";

// Pot deployer contracts are hardcoded to pox-4.allow-contract-caller (removed in pox-5).
// See memory/shared/entries/stackspot-pox4-hardcoded-pox5-migration-risk.md.
interface Pox5RiskCheck {
  atRisk: boolean;
  detail: string;
  currentBurnHeight?: number;
  epoch40StartHeight?: number;
}

interface PoxWatchState {
  lastCheckedAt: string;
  atRisk: boolean;
  detail: string;
}

async function checkPox5ActivationRisk(): Promise<Pox5RiskCheck> {
  try {
    const response = await fetch(POX_INFO_URL);
    if (!response.ok) {
      return { atRisk: false, detail: `pox info fetch failed: HTTP ${response.status}` };
    }
    const data = (await response.json()) as {
      current_burnchain_block_height: number;
      epochs?: Array<{ epoch_id: string; start_height: number }>;
    };
    const currentHeight = data.current_burnchain_block_height;
    const epoch40 = (data.epochs ?? []).find((e) => {
      const idNum = parseInt(String(e.epoch_id).replace(/\D/g, ""), 10);
      return idNum >= 40 && e.start_height < Number.MAX_SAFE_INTEGER;
    });

    if (!epoch40) {
      return {
        atRisk: false,
        detail: "no Epoch40/pox-5 activation height set on mainnet yet",
        currentBurnHeight: currentHeight,
      };
    }

    const blocksUntil = epoch40.start_height - currentHeight;
    if (blocksUntil <= POX5_CYCLE_BLOCKS) {
      return {
        atRisk: true,
        detail: `Epoch40 activation at height ${epoch40.start_height} is ${blocksUntil} blocks away (current ${currentHeight}) — within 1 PoX cycle`,
        currentBurnHeight: currentHeight,
        epoch40StartHeight: epoch40.start_height,
      };
    }
    return {
      atRisk: false,
      detail: `Epoch40 activation scheduled at height ${epoch40.start_height}, ${blocksUntil} blocks away (current ${currentHeight})`,
      currentBurnHeight: currentHeight,
      epoch40StartHeight: epoch40.start_height,
    };
  } catch (e) {
    const error = e as Error;
    return { atRisk: false, detail: `pox info check errored: ${error.message}` };
  }
}

async function persistPoxWatchState(risk: Pox5RiskCheck): Promise<void> {
  const state: PoxWatchState = {
    lastCheckedAt: new Date().toISOString(),
    atRisk: risk.atRisk,
    detail: risk.detail,
  };
  await Bun.write(POX_WATCH_STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

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

    // Check pox-5 activation risk before considering any auto-join. Deployed pot
    // contracts hardcode pox-4.allow-contract-caller, which pox-5 removes — see
    // memory/shared/entries/stackspot-pox4-hardcoded-pox5-migration-risk.md.
    const pox5Risk = await checkPox5ActivationRisk();
    await persistPoxWatchState(pox5Risk);
    if (pox5Risk.atRisk) {
      log(`PAUSED: ${pox5Risk.detail}`);
      return "paused: pox5-activation-risk";
    }
    log(`pox-5 watch: ${pox5Risk.detail}`);

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
    return `error: ${error.message}`;
  }
}
