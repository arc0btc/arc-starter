// skills/mempool-watch/sensor.ts
//
// Monitors Bitcoin mempool fee rates and Arc's BTC address for unconfirmed
// incoming transactions via the mempool.space public API.
// Cadence: 10 minutes.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/sensors.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "mempool-watch";
const INTERVAL_MINUTES = 10;
const MEMPOOL_API = "https://mempool.space/api";
const FETCH_TIMEOUT_MS = 15_000;

// Create a fee-spike task when fastestFee exceeds this (sat/vB)
const FEE_SPIKE_SAT_VB = 50;

// Minimum minutes between repeated fee-spike tasks (avoid spam)
const FEE_SPIKE_COOLDOWN_MINUTES = 60;

// Max seen_txids to retain in state
const MAX_SEEN_TXIDS = 500;

const log = createSensorLogger(SENSOR_NAME);

interface FeesRecommended {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
}

interface MempoolTx {
  txid: string;
  vout: Array<{ scriptpubkey_address?: string; value: number }>;
  fee: number;
  weight: number;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!resp.ok) {
      log(`HTTP ${resp.status} for ${url}`);
      return null;
    }
    return (await resp.json()) as T;
  } catch (e) {
    clearTimeout(timeout);
    log(`fetch error for ${url}: ${e}`);
    return null;
  }
}

function satsToBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

export default async function mempoolWatchSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("run started");

  const state = await readHookState(SENSOR_NAME);
  const lastFeeSpikeAt: string | null = (state?.last_fee_spike_at as string) ?? null;
  const seenTxids: string[] = (state?.seen_txids as string[]) ?? [];

  let tasksCreated = 0;

  // --- 1. Fee rate check ---
  const fees = await fetchJson<FeesRecommended>(`${MEMPOOL_API}/v1/fees/recommended`);
  if (fees) {
    log(`fees: fastest=${fees.fastestFee} halfHour=${fees.halfHourFee} hour=${fees.hourFee} sat/vB`);

    if (fees.fastestFee >= FEE_SPIKE_SAT_VB) {
      // Enforce cooldown to avoid spam
      let cooldownExpired = true;
      if (lastFeeSpikeAt) {
        const lastMs = new Date(lastFeeSpikeAt).getTime();
        const ageMinutes = (Date.now() - lastMs) / 60_000;
        cooldownExpired = ageMinutes >= FEE_SPIKE_COOLDOWN_MINUTES;
      }

      if (cooldownExpired) {
        const source = `sensor:${SENSOR_NAME}:fee-spike:${fees.fastestFee}sat`;
        if (!pendingTaskExistsForSource(source)) {
          const subject = `Bitcoin fee spike: ${fees.fastestFee} sat/vB (fastest)`;
          const description = [
            `The Bitcoin mempool fastest fee rate has spiked above ${FEE_SPIKE_SAT_VB} sat/vB.`,
            ``,
            `Fee rates (sat/vB):`,
            `  fastest:   ${fees.fastestFee}`,
            `  half-hour: ${fees.halfHourFee}`,
            `  hour:      ${fees.hourFee}`,
            `  economy:   ${fees.economyFee}`,
            `  minimum:   ${fees.minimumFee}`,
            ``,
            `Recommendation for QuorumClaw create-proposal: use at least ${fees.hourFee} sat/vB`,
            `for hour-confirmation or ${fees.halfHourFee} sat/vB for faster inclusion.`,
            ``,
            `Consider deferring non-urgent Bitcoin transactions until fees normalise.`,
          ].join("\n");

          const taskId = insertTask({
            subject,
            description,
            priority: 7,
            model: "sonnet",
            source,
          });
          log(`created fee-spike task ${taskId}: ${subject}`);
          tasksCreated++;
        } else {
          log("fee-spike task already pending, skipping");
        }
      } else {
        log(`fee spike detected but cooldown active (last: ${lastFeeSpikeAt})`);
      }
    }
  }

  // --- 2. Arc BTC address unconfirmed incoming tx watch ---
  const mempoolTxs = await fetchJson<MempoolTx[]>(
    `${MEMPOOL_API}/address/${ARC_BTC_ADDRESS}/txs/mempool`,
  );

  const newSeenTxids = [...seenTxids];
  const newFeeSpikeAt = fees && fees.fastestFee >= FEE_SPIKE_SAT_VB ? new Date().toISOString() : lastFeeSpikeAt;

  if (mempoolTxs && mempoolTxs.length > 0) {
    log(`${mempoolTxs.length} unconfirmed tx(s) in mempool for ${ARC_BTC_ADDRESS}`);

    for (const tx of mempoolTxs) {
      if (seenTxids.includes(tx.txid)) {
        log(`  skip (seen): ${tx.txid}`);
        continue;
      }

      // Calculate amount received to Arc's address in this tx
      const receivedSats = tx.vout
        .filter((v) => v.scriptpubkey_address === ARC_BTC_ADDRESS)
        .reduce((sum, v) => sum + v.value, 0);

      if (receivedSats === 0) {
        // Tx is in mempool for this address but no output to us (spending tx)
        newSeenTxids.push(tx.txid);
        continue;
      }

      const source = `sensor:${SENSOR_NAME}:btc-incoming:${tx.txid}`;
      if (!pendingTaskExistsForSource(source)) {
        const btcAmount = satsToBtc(receivedSats);
        const feeRate = fees ? ` (current fastest fee: ${fees.fastestFee} sat/vB)` : "";
        const subject = `Unconfirmed BTC incoming: ${btcAmount} BTC to Arc`;
        const description = [
          `Unconfirmed Bitcoin transaction detected in mempool for Arc's address.`,
          ``,
          `Address: ${ARC_BTC_ADDRESS}`,
          `Txid: ${tx.txid}`,
          `Amount received: ${btcAmount} BTC (${receivedSats} sats)`,
          `Tx fee: ${tx.fee} sats${feeRate}`,
          ``,
          `This is an unconfirmed transaction — not yet final. Monitor for confirmation.`,
          ``,
          `View on mempool.space: https://mempool.space/tx/${tx.txid}`,
        ].join("\n");

        const taskId = insertTask({
          subject,
          description,
          priority: 6,
          model: "sonnet",
          source,
        });
        log(`  created incoming-btc task ${taskId}: ${subject}`);
        tasksCreated++;
      } else {
        log(`  skip (task exists): ${tx.txid}`);
      }

      newSeenTxids.push(tx.txid);
    }
  } else {
    log(`no unconfirmed txs for ${ARC_BTC_ADDRESS}`);
  }

  // Cap seen_txids at MAX_SEEN_TXIDS
  const trimmedSeenTxids = newSeenTxids.slice(-MAX_SEEN_TXIDS);

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    last_fee_fastest: fees?.fastestFee ?? null,
    last_fee_spike_at: newFeeSpikeAt,
    seen_txids: trimmedSeenTxids,
    version: state ? (state.version as number) + 1 : 1,
  });

  log(`run complete — ${tasksCreated} tasks created`);
  return "ok";
}
