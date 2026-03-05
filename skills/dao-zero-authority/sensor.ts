// skills/dao-zero-authority/sensor.ts
//
// Polls tracked Stacks DAO contracts for active proposals every 30 minutes.
// Creates tasks when new proposals need review/voting.
// Uses Hiro API read-only contract calls — no STX spent.

import { join } from "node:path";
import {
  claimSensorRun,
  createSensorLogger,
  fetchWithRetry,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";
import { ARC_STX_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "dao-zero-authority";
const INTERVAL_MINUTES = 30;
const HIRO_API = "https://api.mainnet.hiro.so";
const DAOS_PATH = join(import.meta.dir, "daos.json");
const FETCH_TIMEOUT_MS = 15_000;

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface DaoFunctions {
  getProposalCount: string;
  getProposal: string;
  vote: string;
  getVotingPower: string;
}

interface TrackedDao {
  contract: string; // "SP...address.contract-name"
  label: string;
  addedAt: string;
  functions?: Partial<DaoFunctions>;
  lastKnownCount?: number;
}

interface DaosConfig {
  daos: TrackedDao[];
  defaults: {
    functions: DaoFunctions;
  };
}

interface ProposalData {
  id: number;
  title: string;
  status: string;
  votesFor: number;
  votesAgainst: number;
  endBlock: number;
  proposer: string;
}

// ---- Config I/O ----

async function readDaosConfig(): Promise<DaosConfig> {
  try {
    return (await Bun.file(DAOS_PATH).json()) as DaosConfig;
  } catch {
    return { daos: [], defaults: { functions: { getProposalCount: "get-proposal-count", getProposal: "get-proposal", vote: "vote", getVotingPower: "get-voting-power" } } };
  }
}

async function writeDaosConfig(config: DaosConfig): Promise<void> {
  await Bun.write(DAOS_PATH, JSON.stringify(config, null, 2) + "\n");
}

// ---- Hiro API helpers ----

function splitContract(contract: string): { address: string; name: string } {
  const dot = contract.indexOf(".");
  if (dot === -1) throw new Error(`Invalid contract ID: ${contract} (expected ADDRESS.NAME)`);
  return { address: contract.slice(0, dot), name: contract.slice(dot + 1) };
}

/**
 * Call a read-only Clarity function via Hiro API.
 * Returns the raw Clarity value response or null on failure.
 */
async function callReadOnly(
  contract: string,
  functionName: string,
  args: string[] = [],
): Promise<Record<string, unknown> | null> {
  const { address, name } = splitContract(contract);
  const url = `${HIRO_API}/v2/contracts/call-read/${address}/${name}/${functionName}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetchWithRetry(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: ARC_STX_ADDRESS,
          arguments: args,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        log(`read-only call failed: ${functionName} on ${contract} → HTTP ${response.status}`);
        return null;
      }
      return (await response.json()) as Record<string, unknown>;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    log(`read-only call error: ${functionName} on ${contract} → ${error}`);
    return null;
  }
}

/**
 * Parse a Clarity uint response value.
 * Hiro returns hex-encoded Clarity values. For simple uint responses,
 * the result field contains a hex string we can decode.
 */
function parseClarityUint(result: Record<string, unknown>): number | null {
  if (!result.okay || result.okay !== true) return null;
  const hex = result.result as string | undefined;
  if (!hex || typeof hex !== "string") return null;
  // Clarity uint encoding: 01 prefix + 16 bytes big-endian
  // For small numbers, we can parse the last 8 bytes
  try {
    // Remove 0x prefix if present
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    // Clarity uint: type byte (01) + 16 bytes (128-bit big-endian)
    if (clean.startsWith("01") && clean.length === 34) {
      // Parse last 8 hex chars (last 4 bytes) for reasonable-sized numbers
      const numHex = clean.slice(clean.length - 8);
      return parseInt(numHex, 16);
    }
    // Fallback: try parsing the whole thing
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse a Clarity tuple response into a proposal-like object.
 * This handles the common DAO proposal tuple pattern.
 */
function parseClarityTuple(result: Record<string, unknown>): Record<string, unknown> | null {
  if (!result.okay || result.okay !== true) return null;
  // The result contains a hex-encoded Clarity value
  // For tuples, full decoding requires a Clarity value parser
  // We return the raw result for now — the CLI can do full parsing
  return result;
}

// ---- Proposal polling ----

async function pollDao(dao: TrackedDao, defaults: DaoFunctions): Promise<number> {
  const fns = { ...defaults, ...dao.functions };
  let tasksCreated = 0;

  // 1. Get proposal count
  const countResult = await callReadOnly(dao.contract, fns.getProposalCount);
  if (!countResult) {
    log(`${dao.label}: could not read proposal count`);
    return 0;
  }

  const count = parseClarityUint(countResult);
  if (count === null) {
    log(`${dao.label}: could not parse proposal count from response`);
    return 0;
  }

  log(`${dao.label}: ${count} total proposals (last known: ${dao.lastKnownCount ?? "none"})`);

  // 2. Check for new proposals since last known count
  const startFrom = dao.lastKnownCount ?? 0;
  if (count <= startFrom) {
    log(`${dao.label}: no new proposals`);
    return 0;
  }

  // 3. Query each new proposal
  for (let proposalId = startFrom + 1; proposalId <= count; proposalId++) {
    const source = `sensor:dao-zero-authority:proposal:${dao.contract}:${proposalId}`;
    if (pendingTaskExistsForSource(source)) {
      log(`${dao.label}: proposal #${proposalId} task already pending`);
      continue;
    }

    // Fetch proposal details (best-effort — task will re-query)
    const proposalResult = await callReadOnly(
      dao.contract,
      fns.getProposal,
      [encodeUint(proposalId)],
    );

    const description = [
      `New DAO proposal detected on ${dao.label}.`,
      ``,
      `Contract: ${dao.contract}`,
      `Proposal ID: ${proposalId}`,
      proposalResult ? `Raw response: ${JSON.stringify(proposalResult).slice(0, 500)}` : `(Could not fetch proposal details — query manually)`,
      ``,
      `Steps:`,
      `1. Review proposal: arc skills run --name zero-authority -- proposal --contract ${dao.contract} --id ${proposalId}`,
      `2. Check voting power: arc skills run --name zero-authority -- status`,
      `3. Vote: arc skills run --name zero-authority -- vote --contract ${dao.contract} --id ${proposalId} --direction for|against`,
      ``,
      `Evaluate: Does this proposal align with Arc's mission and values?`,
      `Consider: impact on ecosystem, technical merit, alignment with AIBTC goals.`,
    ].join("\n");

    insertTask({
      subject: `Review + vote on ${dao.label} proposal #${proposalId}`,
      description,
      skills: '["dao-zero-authority", "bitcoin-wallet"]',
      priority: 3,
      model: "opus",
      source,
    });

    log(`${dao.label}: created task for proposal #${proposalId}`);
    tasksCreated++;
  }

  // 4. Update last known count
  dao.lastKnownCount = count;

  return tasksCreated;
}

/**
 * Encode a uint as a Clarity argument hex string.
 * Clarity uint encoding: 0x01 + 16 bytes big-endian.
 */
function encodeUint(value: number): string {
  const hex = value.toString(16).padStart(32, "0");
  return "0x01" + hex;
}

// ---- Sensor entry ----

export default async function zeroAuthoritySensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const config = await readDaosConfig();

  if (config.daos.length === 0) {
    log("no DAOs tracked — skipping");
    return "ok";
  }

  log(`checking ${config.daos.length} DAO(s)`);

  let totalTasks = 0;

  for (const dao of config.daos) {
    try {
      const created = await pollDao(dao, config.defaults.functions);
      totalTasks += created;
    } catch (error) {
      log(`${dao.label}: error — ${error}`);
    }
  }

  // Persist updated lastKnownCount values
  await writeDaosConfig(config);

  if (totalTasks > 0) {
    log(`created ${totalTasks} proposal task(s)`);
  }

  return "ok";
}
