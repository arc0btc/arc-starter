// skills/arc-payments/sensor.ts
//
// Watches the Stacks blockchain for STX transfers and sBTC SIP-010 transfers
// to Arc's address. Detects payments with arc: memo prefixes and creates
// service dispatch tasks. Runs every 3 minutes via sensor cadence gating.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/sensors.ts";
import { ARC_STX_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "arc-payments";
const INTERVAL_MINUTES = 3;
const HIRO_API = "https://api.mainnet.hiro.so";
const FETCH_TIMEOUT_MS = 15_000;

// sBTC SIP-010 contract on mainnet
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// Service routing: memo prefix → { subject, skills, priority, model }
const SERVICE_MAP: Record<
  string,
  { subject: (amount: string, sender: string) => string; skills: string[]; priority: number; model: string }
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
  "arc:monitor-basic": {
    subject: (_, sender) => `Monitoring service (Basic) ordered by ${sender} — check X DMs for endpoint URL`,
    skills: ["arc-monitoring-service"],
    priority: 7,
    model: "haiku",
  },
  "arc:monitor-pro": {
    subject: (_, sender) => `Monitoring service (Pro) ordered by ${sender} — check X DMs for endpoint URL`,
    skills: ["arc-monitoring-service"],
    priority: 7,
    model: "haiku",
  },
  "arc:feed-premium": {
    subject: (_, sender) => `Premium intelligence digest for ${sender}`,
    skills: ["arc-memory"],
    priority: 6,
    model: "sonnet",
  },
};

// Expected minimum amounts in microSTX to prevent dust attacks
const MIN_AMOUNTS_STX: Record<string, number> = {
  "arc:arxiv-latest": 5_000_000,   // 5 STX
  "arc:ask-quick": 1_000_000,      // 1 STX
  "arc:ask-informed": 5_000_000,   // 5 STX
  "arc:pr-standard": 40_000_000,   // 40 STX
  "arc:monitor-basic": 2_000_000,  // 2 STX (~500 sats/month equivalent)
  "arc:monitor-pro": 10_000_000,   // 10 STX (~2500 sats/month equivalent)
  "arc:feed-premium": 1_000_000,   // 1 STX (~$1 at ~$1/STX)
};

// Expected minimum amounts in satoshis for sBTC payments
// sBTC uses 8 decimal places (1 sBTC = 100_000_000 sats)
// Priced ~100x lower than STX equivalents given BTC/STX ratio
const MIN_AMOUNTS_SBTC: Record<string, number> = {
  "arc:arxiv-latest": 5_000,       // 0.00005 sBTC (~$5 at ~$100k BTC)
  "arc:ask-quick": 1_000,          // 0.00001 sBTC (~$1)
  "arc:ask-informed": 5_000,       // 0.00005 sBTC (~$5)
  "arc:pr-standard": 40_000,       // 0.0004 sBTC (~$40)
  "arc:monitor-basic": 500,        // 0.000005 sBTC (~$0.50)
  "arc:monitor-pro": 2_500,        // 0.000025 sBTC (~$2.50)
  "arc:feed-premium": 1_000,       // 0.00001 sBTC (~$1 at ~$100k BTC)
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
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args?: Array<{
      name: string;
      type: string;
      repr: string;
      hex: string;
    }>;
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

/** Decode a Clarity repr string like `"some text"` or `0x...` buffer to UTF-8. */
function clarityReprToString(repr: string): string {
  // String literal: (some u"text") or "text"
  const strMatch = repr.match(/^(?:u)?"(.*)"$/);
  if (strMatch) return strMatch[1];
  // Hex buffer: 0x...
  if (repr.startsWith("0x")) return hexMemoToString(repr);
  return repr;
}

/** Extract uint value from Clarity repr like `u1000` */
function clarityReprToUint(repr: string): number {
  const m = repr.match(/^u(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Extract principal from Clarity repr like `'SP2GH...` or `SP2GH...` */
function clarityReprToAddress(repr: string): string {
  return repr.replace(/^'/, "");
}

function matchService(memo: string): string | null {
  for (const prefix of Object.keys(SERVICE_MAP)) {
    if (memo === prefix || memo.startsWith(prefix + ":") || memo.startsWith(prefix)) {
      return prefix;
    }
  }
  return null;
}

/** Parse an sBTC SIP-010 transfer contract call for payment info. */
function parseSbtcTransfer(tx: StacksTx): {
  recipient: string;
  amount: number;
  memo: string;
} | null {
  const call = tx.contract_call;
  if (!call) return null;
  if (call.contract_id !== SBTC_CONTRACT) return null;
  if (call.function_name !== "transfer") return null;

  const args = call.function_args;
  if (!args || args.length < 3) return null;

  // SIP-010 transfer args: (amount uint) (sender principal) (recipient principal) [(memo (optional (buff 34)))]
  const amountArg = args.find((a) => a.name === "amount");
  const recipientArg = args.find((a) => a.name === "recipient");
  const memoArg = args.find((a) => a.name === "memo");

  if (!amountArg || !recipientArg) return null;

  const recipient = clarityReprToAddress(recipientArg.repr);
  if (recipient !== ARC_STX_ADDRESS) return null;

  const amount = clarityReprToUint(amountArg.repr);
  let memo = "";
  if (memoArg) {
    // Optional memo: (some 0x...) or none
    const someMatch = memoArg.repr.match(/^\(some\s+(.*)\)$/);
    if (someMatch) {
      memo = clarityReprToString(someMatch[1]);
    }
  }

  return { recipient, amount, memo };
}

async function fetchRecentTransfers(afterBlockHeight: number): Promise<StacksTx[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const url = `${HIRO_API}/extended/v1/address/${ARC_STX_ADDRESS}/transactions?limit=25`;
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
    const txs = data.results ?? [];

    // Filter to confirmed txs after our last processed block that are either:
    // 1. STX token_transfer to Arc's address, or
    // 2. contract_call to sBTC transfer with Arc as recipient
    return txs.filter(
      (tx) =>
        tx.tx_status === "success" &&
        tx.block_height > afterBlockHeight &&
        (
          // STX token transfers
          (tx.tx_type === "token_transfer" &&
            tx.token_transfer?.recipient_address === ARC_STX_ADDRESS) ||
          // sBTC SIP-010 contract calls
          (tx.tx_type === "contract_call" &&
            tx.contract_call?.contract_id === SBTC_CONTRACT &&
            tx.contract_call?.function_name === "transfer")
        ),
    );
  } catch (e) {
    clearTimeout(timeout);
    log(`fetch error: ${e}`);
    return [];
  }
}

function processStxTransfer(tx: StacksTx): { memo: string; amount: number; currency: "STX" } | null {
  const memo = hexMemoToString(tx.token_transfer?.memo ?? "");
  const amount = parseInt(tx.token_transfer?.amount ?? "0", 10);
  return { memo, amount, currency: "STX" };
}

function processSbtcTransfer(tx: StacksTx): { memo: string; amount: number; currency: "sBTC" } | null {
  const parsed = parseSbtcTransfer(tx);
  if (!parsed) return null;
  return { memo: parsed.memo, amount: parsed.amount, currency: "sBTC" };
}

function formatAmount(amount: number, currency: "STX" | "sBTC"): string {
  if (currency === "STX") {
    return `${amount / 1_000_000} STX (${amount} microSTX)`;
  }
  return `${amount / 100_000_000} sBTC (${amount} sats)`;
}

export default async function arcPaymentsSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("run started");

  const state = await readHookState(SENSOR_NAME);
  const lastBlockHeight: number = (state?.last_block_height as number) ?? 0;
  let maxBlockHeight = lastBlockHeight;

  const newTxs = await fetchRecentTransfers(lastBlockHeight);
  log(`found ${newTxs.length} new confirmed txs since block ${lastBlockHeight}`);

  let tasksCreated = 0;
  for (const tx of newTxs) {
    if (tx.block_height > maxBlockHeight) {
      maxBlockHeight = tx.block_height;
    }

    const sender = tx.sender_address;
    const txid = tx.tx_id;

    // Determine payment type and extract memo/amount
    let payment: { memo: string; amount: number; currency: "STX" | "sBTC" } | null = null;

    if (tx.tx_type === "token_transfer") {
      payment = processStxTransfer(tx);
    } else if (tx.tx_type === "contract_call") {
      payment = processSbtcTransfer(tx);
    }

    if (!payment) {
      log(`tx ${txid}: could not parse payment info`);
      continue;
    }

    log(`tx ${txid}: memo="${payment.memo}" amount=${payment.amount} ${payment.currency} from ${sender}`);

    const serviceKey = matchService(payment.memo);
    if (!serviceKey) {
      log(`  skip: no arc: service prefix in memo`);
      continue;
    }

    const minAmounts = payment.currency === "STX" ? MIN_AMOUNTS_STX : MIN_AMOUNTS_SBTC;
    const minAmount = minAmounts[serviceKey] ?? 0;
    if (payment.amount < minAmount) {
      log(`  skip: underpayment (got ${payment.amount}, min ${minAmount} for ${serviceKey} in ${payment.currency})`);
      continue;
    }

    const source = `sensor:${SENSOR_NAME}:${txid}`;
    if (pendingTaskExistsForSource(source)) {
      log(`  skip: task already queued for ${txid}`);
      continue;
    }

    const svc = SERVICE_MAP[serviceKey];
    const subject = svc.subject(formatAmount(payment.amount, payment.currency), sender);
    const description = [
      `Payment received via Stacks blockchain.`,
      ``,
      `Service: ${serviceKey}`,
      `Currency: ${payment.currency}`,
      `Amount: ${formatAmount(payment.amount, payment.currency)}`,
      `Sender: ${sender}`,
      `Txid: ${txid}`,
      `Block: ${tx.block_height}`,
      `Memo: ${payment.memo}`,
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
