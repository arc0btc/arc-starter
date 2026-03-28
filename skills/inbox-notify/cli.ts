#!/usr/bin/env bun
// skills/inbox-notify/cli.ts
// Batch x402 inbox messaging with local nonce management.
// Usage: arc skills run --name inbox-notify -- <command> [flags]

import { resolve } from "node:path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { getContactByAddress, insertContactInteraction } from "../contact-registry/schema.ts";
import { acquireNonce, releaseNonce, syncNonce } from "../nonce-manager/nonce-store.js";

const ROOT = resolve(import.meta.dir, "../..");
const STATE_DIR = resolve(ROOT, "db/inbox-notify");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const SENDER_STX = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
const MAX_RETRIES = 3;
const POST_SEND_DELAY_MS = 5_000; // 5s between sends (Stacks blocks are 3-5s post-Nakamoto)
const NONCE_RETRY_DELAY_MS = 5_000;

mkdirSync(STATE_DIR, { recursive: true });

// ---- Types ----

interface BatchMessage {
  btc_address: string;
  stx_address: string;
  content: string;
  label: string;
}

interface BatchState {
  id: string;
  created_at: string;
  updated_at: string;
  messages: Array<BatchMessage & {
    status: "pending" | "sent" | "failed";
    txid?: string;
    error?: string;
    sent_at?: string;
  }>;
}

// ---- Logging ----

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [inbox-notify] ${msg}`);
}

// ---- Helpers ----

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

function stateFilePath(id: string): string {
  return resolve(STATE_DIR, `${id}.json`);
}

function readState(id: string): BatchState | null {
  const path = stateFilePath(id);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as BatchState;
  } catch {
    return null;
  }
}

function writeState(state: BatchState): void {
  state.updated_at = new Date().toISOString();
  writeFileSync(stateFilePath(state.id), JSON.stringify(state, null, 2));
}

// ---- Nonce Management (via nonce-manager) ----

async function fetchSeedNonce(): Promise<bigint> {
  // Sync from Hiro via nonce-manager (atomic, cross-skill safe)
  const result = await syncNonce(SENDER_STX);
  const nonce = BigInt(result.nonce);
  log(`Seed nonce from nonce-manager: ${nonce} (last executed: ${result.lastExecuted}, mempool pending: ${result.mempoolPending})`);

  if (result.mempoolPending > 0) {
    log(`Warning: ${result.mempoolPending} pending mempool tx(es) — may cause initial conflict`);
  }
  if (result.detectedMissing.length > 0) {
    log(`Warning: ${result.detectedMissing.length} missing nonce gap(s): [${result.detectedMissing.join(", ")}]`);
  }

  return nonce;
}

async function acquireManagedNonce(): Promise<bigint> {
  const result = await acquireNonce(SENDER_STX);
  log(`Acquired nonce ${result.nonce} from nonce-manager (source: ${result.source})`);
  return BigInt(result.nonce);
}

async function releaseManagedNonce(nonce: bigint, success: boolean, rejected?: boolean): Promise<void> {
  try {
    const failureKind = !success ? (rejected ? "rejected" as const : "broadcast" as const) : undefined;
    await releaseNonce(SENDER_STX, Number(nonce), success, failureKind);
  } catch {
    // best effort
  }
}

// ---- x402 Send (with explicit nonce) ----

/**
 * Send an x402 inbox message using the bitcoin-wallet CLI.
 * Passes --nonce to override the default Hiro lookup.
 */
async function sendX402Message(
  btcAddress: string,
  stxAddress: string,
  content: string,
  nonce: bigint,
): Promise<{ success: boolean; error?: string }> {
  const proc = Bun.spawn(
    [
      "bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--",
      "x402", "send-inbox-message",
      "--recipient-btc-address", btcAddress,
      "--recipient-stx-address", stxAddress,
      "--content", content,
      "--nonce", nonce.toString(),
    ],
    { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const output = (stdout + stderr).slice(0, 500);
    return { success: false, error: output };
  }

  return { success: true };
}

function isNonceDuplicate(error: string): boolean {
  return error.includes("SENDER_NONCE_DUPLICATE");
}

function isNonceStale(error: string): boolean {
  return error.includes("SENDER_NONCE_STALE") || error.includes("NONCE_CONFLICT") || error.includes("ConflictingNonceInMempool");
}

function isRelayTransient(error: string): boolean {
  return error.includes("RELAY_ERROR") || error.includes("retryable") || error.includes("TimeoutError");
}

// ---- Send with Retry ----

/**
 * Send a message with retry, returning updated nonce after success or fatal failure.
 * On SENDER_NONCE_DUPLICATE, bumps nonce by 1 (relay has it stuck) and retries.
 * On SENDER_NONCE_STALE, re-seeds nonce from Hiro and retries.
 */
async function sendWithRetry(
  btcAddress: string,
  stxAddress: string,
  content: string,
  label: string,
  nonce: bigint,
): Promise<{ success: boolean; error?: string; nonce: bigint }> {
  let currentNonce = nonce;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const result = await sendX402Message(btcAddress, stxAddress, content, currentNonce);

    if (result.success) return { ...result, nonce: currentNonce };

    const err = result.error ?? "";

    if (isNonceDuplicate(err) && attempt < MAX_RETRIES) {
      // Relay already has a tx with this nonce — nonce consumed, acquire next
      log(`  SENDER_NONCE_DUPLICATE for ${label} (attempt ${attempt}/${MAX_RETRIES}), acquiring next nonce...`);
      await releaseManagedNonce(currentNonce, false, false); // broadcast — nonce consumed
      currentNonce = await acquireManagedNonce();
      await sleep(NONCE_RETRY_DELAY_MS);
      continue;
    }

    if (isNonceStale(err) && attempt < MAX_RETRIES) {
      // Nonce rejected pre-broadcast — release as rejected (reusable) and re-sync
      log(`  Nonce stale for ${label} (attempt ${attempt}/${MAX_RETRIES}), re-syncing via nonce-manager...`);
      await releaseManagedNonce(currentNonce, false, true);
      await sleep(NONCE_RETRY_DELAY_MS);
      currentNonce = await acquireManagedNonce();
      continue;
    }

    if (isRelayTransient(err) && attempt < MAX_RETRIES) {
      log(`  Relay transient error for ${label} (attempt ${attempt}/${MAX_RETRIES}), waiting ${POST_SEND_DELAY_MS / 1000}s...`);
      await sleep(POST_SEND_DELAY_MS);
      continue;
    }

    return { success: false, error: result.error, nonce: currentNonce };
  }

  return { success: false, error: "Max retries exhausted", nonce: currentNonce };
}

// ---- Commands ----

async function cmdSendBatch(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const filePath = flags.file;
  if (!filePath) {
    console.error("Usage: arc skills run --name inbox-notify -- send-batch --file <path>");
    process.exit(1);
  }

  const absPath = resolve(ROOT, filePath);
  const batchData = JSON.parse(readFileSync(absPath, "utf-8")) as { messages: BatchMessage[] };
  const batchId = `batch-${Date.now()}`;

  // Initialize or resume state
  let state: BatchState = {
    id: batchId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    messages: batchData.messages.map(m => ({ ...m, status: "pending" as const })),
  };
  writeState(state);

  await executeBatch(state);
}

async function cmdPayoutConfirmations(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date;
  if (!date) {
    console.error("Usage: arc skills run --name inbox-notify -- payout-confirmations --date YYYY-MM-DD");
    process.exit(1);
  }

  const batchId = `payout-confirm-${date}`;

  // Check for existing state (resume support)
  let state = readState(batchId);
  if (state) {
    const pending = state.messages.filter(m => m.status === "pending").length;
    const sent = state.messages.filter(m => m.status === "sent").length;
    if (pending === 0) {
      log(`All messages already sent for ${date} (${sent} sent)`);
      console.log(JSON.stringify({ date, status: "complete", sent, total: state.messages.length }));
      return;
    }
    log(`Resuming: ${sent} sent, ${pending} pending`);
  } else {
    // Build messages from payout record
    const payoutPath = resolve(PAYOUTS_DIR, `${date}.json`);
    if (!existsSync(payoutPath)) {
      console.error(`No payout record found at ${payoutPath}`);
      process.exit(1);
    }

    const record = JSON.parse(readFileSync(payoutPath, "utf-8")) as {
      transfers: Array<{
        earning_ids: string[];
        btc_address: string;
        stx_address: string;
        amount_sats: number;
        txid: string | null;
        status: string;
        correspondent_name: string;
      }>;
    };

    const sentTransfers = record.transfers.filter(t => t.status === "sent" && t.txid);
    if (sentTransfers.length === 0) {
      log("No sent transfers to notify");
      console.log(JSON.stringify({ date, status: "complete", sent: 0, total: 0 }));
      return;
    }

    state = {
      id: batchId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      messages: sentTransfers.map(t => {
        const satsLabel = t.amount_sats.toLocaleString();
        const signalWord = t.earning_ids.length === 1 ? "signal" : "signals";
        return {
          btc_address: t.btc_address,
          stx_address: t.stx_address,
          label: t.correspondent_name,
          content: [
            `Payout Confirmation | ${date}`,
            ``,
            `You've been paid ${satsLabel} sats (sBTC) for ${t.earning_ids.length} ${signalWord} included in the ${date} daily brief on aibtc.news.`,
            ``,
            `Transaction: ${t.txid}`,
            ``,
            `Thank you for your contributions to the network.`,
          ].join("\n"),
          status: "pending" as const,
        };
      }),
    };
    writeState(state);
  }

  await executeBatch(state);
}

async function cmdSendOne(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const btcAddress = flags["btc-address"];
  const stxAddress = flags["stx-address"];
  const content = flags.content;

  if (!btcAddress || !stxAddress || !content) {
    console.error("Usage: arc skills run --name inbox-notify -- send-one --btc-address <addr> --stx-address <addr> --content <text>");
    process.exit(1);
  }

  log(`Sending single message to ${btcAddress.slice(0, 16)}...`);

  const nonce = await acquireManagedNonce();
  const result = await sendWithRetry(btcAddress, stxAddress, content, btcAddress.slice(0, 16), nonce);

  if (result.success) {
    await releaseManagedNonce(result.nonce, true);
    log("Message sent successfully");

    const contact = getContactByAddress(null, btcAddress);
    if (contact) {
      insertContactInteraction({
        contact_id: contact.id,
        type: "collaboration",
        summary: `Sent x402 inbox message: "${content.slice(0, 80)}..."`,
      });
    }

    console.log(JSON.stringify({ success: true }));
  } else {
    await releaseManagedNonce(result.nonce, false);
    log(`Failed: ${result.error}`);
    console.log(JSON.stringify({ success: false, error: result.error }));
    process.exit(1);
  }
}

// ---- Batch Executor ----

async function executeBatch(state: BatchState): Promise<void> {
  const pending = state.messages.filter(m => m.status === "pending");
  const alreadySent = state.messages.filter(m => m.status === "sent").length;
  const total = state.messages.length;

  log(`Batch ${state.id}: ${pending.length} to send, ${alreadySent} already sent, ${total} total`);
  log(`Delay between messages: ${POST_SEND_DELAY_MS / 1000}s`);

  // Acquire nonce from nonce-manager (atomic, cross-skill safe)
  let currentNonce = await acquireManagedNonce();
  log(`Sender nonce: ${currentNonce} — proceeding with batch`);

  let successCount = alreadySent;
  let failCount = state.messages.filter(m => m.status === "failed").length;
  let pendingSent = 0;

  for (let i = 0; i < state.messages.length; i++) {
    const msg = state.messages[i];
    if (msg.status === "sent") continue;
    if (msg.status === "failed") {
      // Reset failed messages to pending so they can be retried in this run
      msg.status = "pending";
    }

    const idx = successCount + failCount + 1;
    log(`[${idx}/${total}] Sending to ${msg.label} (${msg.btc_address.slice(0, 16)}...) nonce=${currentNonce}`);

    const result = await sendWithRetry(msg.btc_address, msg.stx_address, msg.content, msg.label, currentNonce);
    currentNonce = result.nonce;

    if (result.success) {
      msg.status = "sent";
      msg.sent_at = new Date().toISOString();
      successCount++;
      pendingSent++;
      await releaseManagedNonce(currentNonce, true);
      try {
        currentNonce = await acquireManagedNonce();
      } catch (acqErr) {
        log(`  Failed to acquire next nonce: ${acqErr instanceof Error ? acqErr.message : String(acqErr)} — stopping batch`);
        break;
      }
      log(`  Sent to ${msg.label} (next nonce: ${currentNonce})`);

      // Log contact interaction
      try {
        const contact = getContactByAddress(null, msg.btc_address);
        if (contact) {
          insertContactInteraction({
            contact_id: contact.id,
            type: "collaboration",
            summary: `Sent x402 inbox notification: "${msg.content.slice(0, 80)}..."`,
          });
        }
      } catch {
        // Non-fatal
      }
    } else {
      await releaseManagedNonce(currentNonce, false);
      msg.status = "failed";
      msg.error = result.error?.slice(0, 500);
      failCount++;
      log(`  FAILED for ${msg.label}: ${msg.error?.slice(0, 200)}`);
    }

    writeState(state);

    // Wait between sends to let the sponsored tx confirm
    const remaining = state.messages.slice(i + 1).filter(m => m.status === "pending").length;
    if (remaining > 0 && result.success) {
      log(`  Waiting ${POST_SEND_DELAY_MS / 1000}s before next message...`);
      await sleep(POST_SEND_DELAY_MS);
    }
  }

  // Release the pre-acquired nonce that was never used (loop ended)
  await releaseManagedNonce(currentNonce, false, true);

  const finalSent = state.messages.filter(m => m.status === "sent").length;
  const finalFailed = state.messages.filter(m => m.status === "failed").length;

  log(`Batch complete: ${finalSent} sent, ${finalFailed} failed out of ${total}`);

  console.log(JSON.stringify({
    batch_id: state.id,
    status: finalFailed === 0 ? "complete" : finalSent === 0 ? "failed" : "partial",
    sent: finalSent,
    failed: finalFailed,
    total,
    failures: state.messages
      .filter(m => m.status === "failed")
      .map(m => ({ label: m.label, error: m.error?.slice(0, 200) })),
  }, null, 2));

  if (finalFailed > 0) process.exit(1);
}

// ---- Usage ----

function printUsage(): void {
  console.error(`inbox-notify — batch x402 inbox messaging with local nonce management

USAGE
  arc skills run --name inbox-notify -- <command> [flags]

COMMANDS
  send-batch --file <path>                   Send messages from a JSON batch file
  send-one --btc-address <addr> --stx-address <addr> --content <text>
                                             Send a single x402 inbox message
  payout-confirmations --date YYYY-MM-DD     Send payout confirmation messages for a date

EXAMPLES
  arc skills run --name inbox-notify -- payout-confirmations --date 2026-03-24
  arc skills run --name inbox-notify -- send-one --btc-address bc1q... --stx-address SP... --content "Hello"
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "send-batch": await cmdSendBatch(commandArgs); break;
    case "send-one": await cmdSendOne(commandArgs); break;
    case "payout-confirmations": await cmdPayoutConfirmations(commandArgs); break;
    case "help": case "--help": case "-h": case undefined: printUsage(); break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch(err => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
