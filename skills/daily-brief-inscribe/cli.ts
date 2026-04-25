#!/usr/bin/env bun
// skills/daily-brief-inscribe/cli.ts
// Script-dispatch state handlers for the daily brief inscription workflow.
// Each handler advances exactly ONE workflow state, then exits.
// Usage: arc skills run --name daily-brief-inscribe -- <handler> [flags]

import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";

const ROOT = resolve(import.meta.dir, "../..");
const ORDINALS_SCRIPT = resolve(ROOT, "github/aibtcdev/skills/ordinals/ordinals.ts");
const SKILLS_ROOT = resolve(ROOT, "github/aibtcdev/skills");
const BRIEF_CACHE_DIR = resolve(ROOT, "db");

// ---- Helpers ----

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

function log(msg: string): void {
  console.error(`[daily-brief-inscribe] ${msg}`);
}

function succeed(message: string): never {
  console.log(JSON.stringify({ status: "completed", message }));
  process.exit(0);
}

function fail(message: string): never {
  console.log(JSON.stringify({ status: "failed", message }));
  process.exit(1);
}

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function spawnSync(cmd: string[], cwd?: string): SpawnResult {
  const result = Bun.spawnSync(cmd, {
    cwd: cwd ?? ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  return {
    stdout: result.stdout?.toString().trim() ?? "",
    stderr: result.stderr?.toString().trim() ?? "",
    exitCode: result.exitCode ?? 1,
  };
}

function workflowTransition(
  workflowId: string,
  newState: string,
  contextUpdate?: Record<string, unknown>,
): void {
  const args = [
    "arc", "skills", "run", "--name", "arc-workflows", "--",
    "transition", workflowId, newState,
  ];
  if (contextUpdate) {
    args.push("--context", JSON.stringify(contextUpdate));
  }
  const result = spawnSync(args);
  if (result.exitCode !== 0) {
    throw new Error(`Workflow transition to ${newState} failed: ${result.stderr || result.stdout}`);
  }
  log(`Workflow ${workflowId} → ${newState}`);
}

/** Path for brief content cache — persists between commit and reveal steps. */
function briefCachePath(date: string): string {
  return resolve(BRIEF_CACHE_DIR, `brief-inscription-${date}.b64`);
}

/** Check current workflow state — used to guard stale follow-up tasks. */
function getWorkflowState(workflowId: string): string | null {
  const result = spawnSync([
    "arc", "skills", "run", "--name", "arc-workflows", "--", "show", workflowId,
  ]);
  if (result.exitCode !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout) as { data?: { current_state?: string } };
    return parsed.data?.current_state ?? null;
  } catch {
    return null;
  }
}

// ---- State handlers ----

/**
 * pending → brief_fetched
 * Fetches the daily brief, computes SHA-256, saves content to cache file.
 */
async function cmdFetchAndHash(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const date = flags["date"];
  if (!workflowId || !date) fail("--workflow-id and --date are required");

  log(`Fetching brief for ${date}`);
  const fetchResult = spawnSync([
    "arc", "skills", "run", "--name", "aibtc-news-classifieds",
    "--", "get-brief", "--date", date,
  ]);
  if (fetchResult.exitCode !== 0) {
    fail(`get-brief failed: ${fetchResult.stderr || fetchResult.stdout}`);
  }

  let briefJson: Record<string, unknown>;
  try {
    briefJson = JSON.parse(fetchResult.stdout) as Record<string, unknown>;
  } catch {
    fail(`get-brief returned non-JSON: ${fetchResult.stdout.slice(0, 300)}`);
  }

  // Extract text content — handles various response shapes
  const briefText =
    (briefJson.content as string) ||
    (briefJson.text as string) ||
    (briefJson.body as string) ||
    (briefJson.summary as string) ||
    JSON.stringify(briefJson);

  const contentBytes = Buffer.from(briefText, "utf-8");
  const dataHash = createHash("sha256").update(contentBytes).digest("hex");
  const dataSize = contentBytes.length;
  const briefSummary = briefText.replace(/\s+/g, " ").trim().slice(0, 200);

  // Cache content as base64 for commit-tx and reveal-tx (avoids re-fetching)
  const cachePath = briefCachePath(date);
  await Bun.write(cachePath, contentBytes.toString("base64"));
  log(`Cached ${dataSize} bytes → ${cachePath}`);

  workflowTransition(workflowId, "brief_fetched", { dataHash, dataSize, briefSummary });
  succeed(`Brief hashed: SHA-256=${dataHash.slice(0, 16)}... (${dataSize} bytes)`);
}

/**
 * brief_fetched → balance_ok
 * Checks BTC balance via mempool.space to ensure sufficient funds.
 */
async function cmdCheckBalance(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const dataSize = parseInt(flags["data-size"] || "0", 10);
  const network = flags["network"] || "mainnet";
  if (!workflowId) fail("--workflow-id is required");

  // Get wallet BTC address
  const infoResult = spawnSync(["arc", "skills", "run", "--name", "bitcoin-wallet", "--", "info"]);
  if (infoResult.exitCode !== 0) {
    fail(`wallet info failed: ${infoResult.stderr || infoResult.stdout}`);
  }

  let walletInfo: Record<string, unknown>;
  try {
    walletInfo = JSON.parse(infoResult.stdout) as Record<string, unknown>;
  } catch {
    fail("wallet info returned non-JSON");
  }

  // Handle nested response shapes
  const data = (walletInfo.data as Record<string, unknown>) ?? walletInfo;
  const btcAddress =
    (data.btcAddress as string) ||
    (data.address as string) ||
    (data.Bitcoin as string) ||
    (walletInfo.btcAddress as string);

  if (!btcAddress || !btcAddress.startsWith("bc1")) {
    fail(`No valid BTC address in wallet info. Got: ${JSON.stringify(data).slice(0, 200)}`);
  }

  const mempoolBase =
    network === "testnet" ? "https://mempool.space/testnet/api" : "https://mempool.space/api";

  const resp = await fetch(`${mempoolBase}/address/${btcAddress}`);
  if (!resp.ok) fail(`mempool.space ${resp.status} for address ${btcAddress}`);

  type MempoolAddr = {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const addrInfo = (await resp.json()) as MempoolAddr;
  const confirmed =
    addrInfo.chain_stats.funded_txo_sum - addrInfo.chain_stats.spent_txo_sum;
  const mempool =
    addrInfo.mempool_stats.funded_txo_sum - addrInfo.mempool_stats.spent_txo_sum;
  const totalSats = confirmed + mempool;

  // Rough minimum: 5 sat/vB × (base overhead + content) + 10 000 buffer
  const minRequired = Math.ceil(5 * (400 + dataSize)) + 10_000;
  log(`BTC balance: ${totalSats} sats (need ≥${minRequired})`);

  if (totalSats < minRequired) {
    fail(`Insufficient BTC: ${totalSats} sats < ${minRequired} sats required`);
  }

  workflowTransition(workflowId, "balance_ok");
  succeed(`Balance OK: ${totalSats} sats available`);
}

/**
 * balance_ok → committed
 * Broadcasts commit transaction using cached brief content.
 */
async function cmdCommitTx(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const date = flags["date"];
  const network = flags["network"] || "mainnet";
  if (!workflowId || !date) fail("--workflow-id and --date are required");

  const cachePath = briefCachePath(date);
  const cacheFile = Bun.file(cachePath);
  if (!(await cacheFile.exists())) {
    fail(`Brief cache missing at ${cachePath}. Re-run fetch-and-hash.`);
  }
  const contentBase64 = (await cacheFile.text()).trim();
  log(`Broadcasting commit tx for ${date} (${ORDINALS_SCRIPT})`);

  const result = spawnSync(
    [
      "bun", "run", ORDINALS_SCRIPT,
      "inscribe",
      "--content-type", "text/plain",
      "--content-base64", contentBase64,
      "--fee-rate", "medium",
    ],
    SKILLS_ROOT,
  );

  if (result.exitCode !== 0) {
    fail(`ordinals inscribe failed: ${result.stderr || result.stdout}`);
  }

  let out: Record<string, unknown>;
  try {
    out = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    fail(`ordinals inscribe non-JSON: ${result.stdout.slice(0, 300)}`);
  }

  const commitTxid = out.commitTxid as string;
  const commitFee = out.commitFee as number;
  const revealAmount = out.revealAmount as number;
  const feeRate = out.feeRate as number;

  if (!commitTxid) {
    fail(`No commitTxid in ordinals output: ${JSON.stringify(out).slice(0, 300)}`);
  }

  workflowTransition(workflowId, "committed", { commitTxid, commitFee, revealAmount, feeRate });
  succeed(`Commit tx broadcast: ${commitTxid}`);
}

/**
 * committed → commit_confirmed
 * Checks mempool for commit tx confirmation. If unconfirmed, schedules a follow-up.
 */
async function cmdCheckCommit(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const commitTxid = flags["commit-txid"];
  const network = flags["network"] || "mainnet";
  if (!workflowId || !commitTxid) fail("--workflow-id and --commit-txid are required");

  // Guard: if workflow already advanced past committed, stale follow-up can exit cleanly
  const currentState = getWorkflowState(workflowId);
  if (currentState && currentState !== "committed") {
    succeed(`Workflow already at ${currentState} — stale check-commit task`);
  }

  const mempoolBase =
    network === "testnet" ? "https://mempool.space/testnet/api" : "https://mempool.space/api";

  const txResp = await fetch(`${mempoolBase}/tx/${commitTxid}`);
  if (!txResp.ok) {
    if (txResp.status === 404) {
      await scheduleRecheck(workflowId, "committed", commitTxid, "check-commit", network);
      succeed("Commit tx not yet in mempool — follow-up scheduled");
    }
    fail(`mempool.space ${txResp.status} for tx ${commitTxid}`);
  }

  type MempoolTx = { status: { confirmed: boolean; block_height?: number } };
  const tx = (await txResp.json()) as MempoolTx;

  if (!tx.status.confirmed) {
    await scheduleRecheck(workflowId, "committed", commitTxid, "check-commit", network);
    succeed("Commit tx unconfirmed — follow-up scheduled in 15 min");
  }

  workflowTransition(workflowId, "commit_confirmed");
  succeed(`Commit tx confirmed at block ${tx.status.block_height}`);
}

/**
 * commit_confirmed → revealed
 * Broadcasts reveal transaction using cached brief content and stored commit data.
 */
async function cmdRevealTx(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const date = flags["date"];
  const commitTxid = flags["commit-txid"];
  const revealAmount = parseInt(flags["reveal-amount"] || "0", 10);
  const feeRate = flags["fee-rate"] || "medium";
  const network = flags["network"] || "mainnet";
  if (!workflowId || !date || !commitTxid) {
    fail("--workflow-id, --date, and --commit-txid are required");
  }
  if (revealAmount <= 0) fail("--reveal-amount must be positive");

  const cachePath = briefCachePath(date);
  const cacheFile = Bun.file(cachePath);
  if (!(await cacheFile.exists())) {
    fail(`Brief cache missing at ${cachePath}. Re-run fetch-and-hash.`);
  }
  const contentBase64 = (await cacheFile.text()).trim();
  log(`Broadcasting reveal tx for ${date}`);

  const result = spawnSync(
    [
      "bun", "run", ORDINALS_SCRIPT,
      "inscribe-reveal",
      "--commit-txid", commitTxid,
      "--reveal-amount", String(revealAmount),
      "--content-type", "text/plain",
      "--content-base64", contentBase64,
      "--fee-rate", feeRate,
    ],
    SKILLS_ROOT,
  );

  if (result.exitCode !== 0) {
    fail(`ordinals inscribe-reveal failed: ${result.stderr || result.stdout}`);
  }

  let out: Record<string, unknown>;
  try {
    out = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    fail(`ordinals inscribe-reveal non-JSON: ${result.stdout.slice(0, 300)}`);
  }

  const revealSection = (out.reveal as Record<string, unknown>) ?? out;
  const revealTxid = (revealSection.txid as string) || (out.revealTxid as string);
  const revealFee = (revealSection.fee as number) || (out.revealFee as number);
  const inscriptionId = (out.inscriptionId as string) || undefined;

  if (!revealTxid) {
    fail(`No revealTxid in ordinals output: ${JSON.stringify(out).slice(0, 300)}`);
  }

  workflowTransition(workflowId, "revealed", {
    revealTxid,
    revealFee,
    ...(inscriptionId ? { inscriptionId } : {}),
  });
  succeed(`Reveal tx broadcast: ${revealTxid}`);
}

/**
 * revealed → confirmed
 * Checks mempool for reveal tx confirmation. If unconfirmed, schedules a follow-up.
 */
async function cmdCheckReveal(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const revealTxid = flags["reveal-txid"];
  const network = flags["network"] || "mainnet";
  if (!workflowId || !revealTxid) fail("--workflow-id and --reveal-txid are required");

  // Guard: if workflow already advanced past revealed, stale follow-up can exit cleanly
  const currentState = getWorkflowState(workflowId);
  if (currentState && currentState !== "revealed") {
    succeed(`Workflow already at ${currentState} — stale check-reveal task`);
  }

  const mempoolBase =
    network === "testnet" ? "https://mempool.space/testnet/api" : "https://mempool.space/api";

  const txResp = await fetch(`${mempoolBase}/tx/${revealTxid}`);
  if (!txResp.ok) {
    if (txResp.status === 404) {
      await scheduleRecheck(workflowId, "revealed", revealTxid, "check-reveal", network);
      succeed("Reveal tx not yet in mempool — follow-up scheduled");
    }
    fail(`mempool.space ${txResp.status} for tx ${revealTxid}`);
  }

  type MempoolTx = { status: { confirmed: boolean; block_height?: number } };
  const tx = (await txResp.json()) as MempoolTx;

  if (!tx.status.confirmed) {
    await scheduleRecheck(workflowId, "revealed", revealTxid, "check-reveal", network);
    succeed("Reveal tx unconfirmed — follow-up scheduled in 15 min");
  }

  const inscriptionId = `${revealTxid}i0`;
  workflowTransition(workflowId, "confirmed", { inscriptionId });
  succeed(`Reveal confirmed — inscription: ${inscriptionId}`);
}

/**
 * confirmed → completed
 * Records the inscription on aibtc.news and cleans up cache.
 */
async function cmdRecordInscription(flags: Record<string, string>): Promise<void> {
  const workflowId = flags["workflow-id"];
  const date = flags["date"];
  if (!workflowId || !date) fail("--workflow-id and --date are required");

  log(`Recording inscription for ${date}`);
  const result = spawnSync([
    "arc", "skills", "run", "--name", "aibtc-news-classifieds",
    "--", "inscribe-brief", "--date", date,
  ]);
  if (result.exitCode !== 0) {
    fail(`inscribe-brief failed: ${result.stderr || result.stdout}`);
  }

  workflowTransition(workflowId, "completed");

  // Clean up cached brief content
  const cachePath = briefCachePath(date);
  try {
    await unlink(cachePath);
    log(`Cleaned up brief cache: ${cachePath}`);
  } catch {
    // Non-fatal
  }

  succeed(`Brief inscription recorded on aibtc.news`);
}

/** Schedule a follow-up recheck task in 15 minutes via arc tasks add. */
async function scheduleRecheck(
  workflowId: string,
  currentState: string,
  txid: string,
  handler: "check-commit" | "check-reveal",
  network: string,
): Promise<void> {
  const scheduledFor = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const txFlag = handler === "check-commit" ? "--commit-txid" : "--reveal-txid";
  const script = `arc skills run --name daily-brief-inscribe -- ${handler} --workflow-id ${workflowId} ${txFlag} ${txid} --network ${network}`;
  const source = `workflow:${workflowId}:${currentState}:recheck`;

  const addResult = spawnSync([
    "arc", "tasks", "add",
    "--subject", `Brief inscription: recheck ${handler} tx ${txid.slice(0, 8)}... (wf ${workflowId})`,
    "--script", script,
    "--priority", "6",
    "--skills", "daily-brief-inscribe",
    "--source", source,
    "--scheduled-for", scheduledFor,
  ]);

  if (addResult.exitCode !== 0) {
    log(`Warning: failed to schedule follow-up: ${addResult.stderr || addResult.stdout}`);
  } else {
    log(`Follow-up scheduled for ${scheduledFor}: ${source}`);
  }
}

// ---- Dispatch ----

const args = process.argv.slice(2);
const handler = args[0];
const flags = parseFlags(args.slice(1));

switch (handler) {
  case "fetch-and-hash":
    await cmdFetchAndHash(flags);
    break;
  case "check-balance":
    await cmdCheckBalance(flags);
    break;
  case "commit-tx":
    await cmdCommitTx(flags);
    break;
  case "check-commit":
    await cmdCheckCommit(flags);
    break;
  case "reveal-tx":
    await cmdRevealTx(flags);
    break;
  case "check-reveal":
    await cmdCheckReveal(flags);
    break;
  case "record-inscription":
    await cmdRecordInscription(flags);
    break;
  default:
    console.error(
      "Usage: arc skills run --name daily-brief-inscribe -- <handler> [flags]\n" +
      "Handlers: fetch-and-hash | check-balance | commit-tx | check-commit | reveal-tx | check-reveal | record-inscription",
    );
    process.exit(1);
}
