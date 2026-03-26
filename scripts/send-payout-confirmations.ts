#!/usr/bin/env bun
/**
 * One-off script: send x402 payout confirmation messages for a completed payout date.
 * Usage: bun run scripts/send-payout-confirmations.ts --date 2026-03-24
 *
 * Waits 35s between messages to avoid relay nonce conflicts (x402 payments
 * are sponsored sBTC transfers that need mempool clearance between sends).
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = resolve(import.meta.dir, "..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const DELAY_MS = 35_000; // relay says retryAfter: 30s, add 5s buffer
const MAX_RETRIES = 2;

interface PayoutTransfer {
  earning_ids: string[];
  btc_address: string;
  stx_address: string;
  amount_sats: number;
  txid: string | null;
  status: string;
  correspondent_name: string;
}

interface PayoutRecord {
  date: string;
  status: string;
  transfers: PayoutTransfer[];
}

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function sendX402InboxMessage(btcAddress: string, stxAddress: string, content: string): Promise<void> {
  const proc = Bun.spawn(
    [
      "bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--",
      "x402", "send-inbox-message",
      "--recipient-btc-address", btcAddress,
      "--recipient-stx-address", stxAddress,
      "--content", content,
    ],
    { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`x402 send failed (exit ${exitCode}): ${(stdout + stderr).slice(0, 500)}`);
  }
}

async function sendWithRetry(btcAddress: string, stxAddress: string, content: string, name: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await sendX402InboxMessage(btcAddress, stxAddress, content);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable = msg.includes("NONCE_CONFLICT") || msg.includes("RELAY_ERROR") || msg.includes("retryable");
      if (isRetryable && attempt < MAX_RETRIES) {
        log(`  Retryable error for ${name} (attempt ${attempt + 1}/${MAX_RETRIES + 1}), waiting ${DELAY_MS / 1000}s...`);
        await sleep(DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

async function main(): Promise<void> {
  const dateIdx = process.argv.indexOf("--date");
  if (dateIdx === -1 || !process.argv[dateIdx + 1]) {
    console.error("Usage: bun run scripts/send-payout-confirmations.ts --date YYYY-MM-DD");
    process.exit(1);
  }
  const date = process.argv[dateIdx + 1];

  const path = resolve(PAYOUTS_DIR, `${date}.json`);
  const record: PayoutRecord = JSON.parse(readFileSync(path, "utf-8"));

  const sentTransfers = record.transfers.filter(t => t.status === "sent" && t.txid);
  log(`Loaded ${sentTransfers.length} sent transfers for ${date}`);
  log(`Sending with ${DELAY_MS / 1000}s delay between messages to avoid nonce conflicts`);

  let success = 0;
  let failed = 0;
  const failures: string[] = [];

  for (let i = 0; i < sentTransfers.length; i++) {
    const t = sentTransfers[i];
    const satsLabel = t.amount_sats.toLocaleString();
    const signalWord = t.earning_ids.length === 1 ? "signal" : "signals";
    const message = [
      `Payout Confirmation | ${date}`,
      ``,
      `You've been paid ${satsLabel} sats (sBTC) for ${t.earning_ids.length} ${signalWord} included in the ${date} daily brief on aibtc.news.`,
      ``,
      `Transaction: ${t.txid}`,
      ``,
      `Thank you for your contributions to the network.`,
    ].join("\n");

    log(`[${i + 1}/${sentTransfers.length}] Sending to ${t.correspondent_name} (${t.btc_address.slice(0, 16)}...)`);

    try {
      await sendWithRetry(t.btc_address, t.stx_address, message, t.correspondent_name);
      success++;
      log(`  Sent to ${t.correspondent_name}`);
    } catch (err) {
      failed++;
      const errMsg = err instanceof Error ? err.message : String(err);
      failures.push(`${t.correspondent_name}: ${errMsg.slice(0, 200)}`);
      log(`  FAILED for ${t.correspondent_name}: ${errMsg.slice(0, 200)}`);
    }

    // Wait between messages to let relay nonce clear
    if (i < sentTransfers.length - 1) {
      log(`  Waiting ${DELAY_MS / 1000}s before next message...`);
      await sleep(DELAY_MS);
    }
  }

  log(`Done: ${success} sent, ${failed} failed out of ${sentTransfers.length}`);
  if (failures.length > 0) {
    log(`Failures:`);
    for (const f of failures) log(`  - ${f}`);
  }
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
