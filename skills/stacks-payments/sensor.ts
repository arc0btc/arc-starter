// skills/stacks-payments/sensor.ts
//
// Watches the Stacks blockchain for STX transfers to Arc's address.
// Detects payments with arc: memo prefixes and creates service dispatch tasks.
// Runs every 3 minutes via sensor cadence gating.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/sensors.ts";
import { ARC_STX_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "stacks-payments";
const INTERVAL_MINUTES = 3;
const HIRO_API = "https://api.hiro.so";
const FETCH_TIMEOUT_MS = 15_000;

// Service routing: memo prefix → { subject, skills, priority, model }
const SERVICE_MAP: Record<
  string,
  { subject: (amount: number, sender: string) => string; skills: string[]; priority: number; model: string }
> = {
  "arc:arxiv-latest": {
    subject: (_, sender) => `Deliver arXiv digest to ${sender}`,
    skills: ["arxiv-research"],
    priority: 6,
    model: "sonnet",
  },
  "arc:ask-quick": {
    subject: (_, sender) => `Ask Arc (Quick) from ${sender} — check X DMs for question`,
    skills: [],
    priority: 8,
    model: "haiku",
  },
  "arc:ask-informed": {
    subject: (_, sender) => `Ask Arc (Informed) from ${sender} — check X DMs for question`,
    skills: [],
    priority: 6,
    model: "sonnet",
  },
  "arc:pr-standard": {
    subject: (_, sender) => `PR Review ordered by ${sender} — check X DMs for PR URL`,
    skills: ["aibtc-repo-maintenance"],
    priority: 5,
    model: "sonnet",
  },
};

// Expected minimum amounts in microSTX to prevent dust attacks
const MIN_AMOUNTS: Record<string, number> = {
  "arc:arxiv-latest": 5_000_000,   // 5 STX
  "arc:ask-quick": 1_000_000,      // 1 STX
  "arc:ask-informed": 5_000_000,   // 5 STX
  "arc:pr-standard": 40_000_000,   // 40 STX
};

interface StacksTx {
  tx_id: string;
  tx_type: string;
  sender_address: string;
  block_height: number;
  burn_block_time: number;
  tx_status: string;
  token_transfer?: {
    recipient_address: string;
    amount: string;
    memo: string;
  };
}

interface StacksTxListResponse {
  total: number;
  limit: number;
  offset: number;
  results: StacksTx[];
}

const log = createSensorLogger(SENSOR_NAME);

function hexMemoToString(hexMemo: string): string {
  // Stacks memos are hex-encoded, zero-padded to 34 bytes
  const hex = hexMemo.startsWith("0x") ? hexMemo.slice(2) : hexMemo;
  try {
    const bytes = Buffer.from(hex, "hex");
    // Trim trailing null bytes
    const trimmed = bytes.toString("utf8").replace(/\0+$/, "");
    return trimmed;
  } catch {
    return "";
  }
}

function matchService(memo: string): string | null {
  for (const prefix of Object.keys(SERVICE_MAP)) {
    if (memo === prefix || memo.startsWith(prefix + ":") || memo.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

async function fetchRecentTransfers(afterBlockHeight: number): Promise<StacksTx[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/transactions?limit=25&type=token_transfer`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      log(`API error: HTTP ${resp.status}`);
      return [];
    }

    const data = (await resp.json()) as StacksTxListResponse;
    const transfers = data.results ?? [];

    // Filter to confirmed transfers (not mempool) after our last processed block
    return transfers.filter(
      (tx) =>
        tx.tx_type === "token_transfer" &&
        tx.tx_status === "success" &&
        tx.block_height > afterBlockHeight &&
        tx.token_transfer?.recipient_address === ARC_STX_ADDRESS,
    );
  } catch (e) {
    clearTimeout(timeout);
    log(`fetch error: ${e}`);
    return [];
  }
}

export default async function stacksPaymentsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("run started");

  const state = await readHookState(SENSOR_NAME);
  const lastBlockHeight: number = (state?.last_block_height as number) ?? 0;
  let maxBlockHeight = lastBlockHeight;

  const newTransfers = await fetchRecentTransfers(lastBlockHeight);
  log(`found ${newTransfers.length} new confirmed transfers since block ${lastBlockHeight}`);

  let tasksCreated = 0;
  for (const tx of newTransfers) {
    if (tx.block_height > maxBlockHeight) {
      maxBlockHeight = tx.block_height;
    }

    const memo = hexMemoToString(tx.token_transfer?.memo ?? "");
    const amount = parseInt(tx.token_transfer?.amount ?? "0", 10);
    const sender = tx.sender_address;
    const txid = tx.tx_id;

    log(`tx ${txid}: memo="${memo}" amount=${amount} from ${sender}`);

    const serviceKey = matchService(memo);
    if (!serviceKey) {
      log(`  skip: no arc: service prefix in memo`);
      continue;
    }

    const minAmount = MIN_AMOUNTS[serviceKey] ?? 0;
    if (amount < minAmount) {
      log(`  skip: underpayment (got ${amount}, min ${minAmount} for ${serviceKey})`);
      continue;
    }

    const source = `sensor:${SENSOR_NAME}:${txid}`;
    if (pendingTaskExistsForSource(source)) {
      log(`  skip: task already queued for ${txid}`);
      continue;
    }

    const svc = SERVICE_MAP[serviceKey];
    const subject = svc.subject(amount, sender);
    const description = [
      `Payment received via Stacks blockchain.`,
      ``,
      `Service: ${serviceKey}`,
      `Amount: ${amount / 1_000_000} STX (${amount} microSTX)`,
      `Sender: ${sender}`,
      `Txid: ${txid}`,
      `Block: ${tx.block_height}`,
      `Memo: ${memo}`,
      ``,
      `For ask/review services: check X DMs from this sender address or cross-reference @arc0btc DMs where sender quotes this txid.`,
      ``,
      `Deliver result to sender's Stacks address: ${sender}`,
      `Reference txid in all responses so sender can verify.`,
    ].join("\n");

    const taskId = insertTask({
      subject,
      description,
      skills: svc.skills.length > 0 ? JSON.stringify(svc.skills) : null,
      priority: svc.priority,
      model: svc.model,
      source,
    });
    log(`  created task ${taskId}: ${subject}`);
    tasksCreated++;
  }

  // Persist the highest block we've seen
  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: state ? (state.version as number) + 1 : 1,
    last_block_height: maxBlockHeight,
  });

  log(`run completed — ${tasksCreated} tasks created, max block now ${maxBlockHeight}`);
  return tasksCreated > 0 ? "ok" : "ok";
}
