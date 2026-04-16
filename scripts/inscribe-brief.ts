#!/usr/bin/env bun
// scripts/inscribe-brief.ts
// Daily brief inscription as a child ordinal + editor notification.
// Runs ONE phase per invocation, then queues a --script continuation task.
// Dispatch retries failures (max_retries=3). The task queue IS the state machine.
//
// Usage:
//   bun run scripts/inscribe-brief.ts run --date 2026-04-14
//   bun run scripts/inscribe-brief.ts status --date 2026-04-14

import { resolve, join } from "node:path";
import { mkdirSync } from "fs";
import { ARC_BTC_ADDRESS } from "../src/identity.ts";
import { initDatabase, getDatabase } from "../src/db.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = "https://aibtc.news/api";
const MEMPOOL_API = "https://mempool.space/api";
const PARENT_INSCRIPTION_ID = "fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0";

const ROOT = resolve(import.meta.dir, "..");
const INSCRIPTIONS_DIR = resolve(ROOT, "db/inscriptions");
const BRIEFS_DIR = resolve(ROOT, "db/briefs");
const BATCH_DIR = resolve(ROOT, "db/inbox-notify");
const CHILD_INSCRIPTION_CLI = resolve(ROOT, "skills/child-inscription/child-inscription.ts");

const MAX_POLL_ATTEMPTS = 30; // 30 × 2min defer = 1 hour max wait
const TASK_PRIORITY = 3;
const TASK_SOURCE = "script:inscribe-brief";

mkdirSync(INSCRIPTIONS_DIR, { recursive: true });
mkdirSync(BRIEFS_DIR, { recursive: true });
mkdirSync(BATCH_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const STATUS_ORDER = ["fetched", "estimated", "committed", "confirmed", "revealed", "recorded", "completed"] as const;
type InscriptionStatus = (typeof STATUS_ORDER)[number];

interface InscriptionRecord {
  date: string;
  status: InscriptionStatus;
  brief_content_file: string;
  signal_count: number;
  estimated_cost_sats?: number;
  fee_rate?: number;
  commit_txid?: string;
  reveal_amount?: number;
  inscription_id?: string;
  editors_notified?: string[];
  poll_attempts?: number;
  created_at: string;
  updated_at: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [inscribe-brief] ${msg}`);
}

function stateFilePath(date: string): string {
  return join(INSCRIPTIONS_DIR, `${date}.json`);
}

async function readState(date: string): Promise<InscriptionRecord | null> {
  const file = Bun.file(stateFilePath(date));
  if (!(await file.exists())) return null;
  return JSON.parse(await file.text()) as InscriptionRecord;
}

async function writeState(record: InscriptionRecord): Promise<void> {
  record.updated_at = new Date().toISOString();
  await Bun.write(stateFilePath(record.date), JSON.stringify(record, null, 2));
}

async function runChild(
  args: string[],
  opts?: { cwd?: string; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(args, {
    cwd: opts?.cwd ?? ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: opts?.env ? { ...process.env, ...opts.env } : undefined,
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function parseJson(combined: string): Record<string, unknown> | null {
  const jsonStart = combined.indexOf("{");
  if (jsonStart === -1) return null;
  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      return JSON.parse(combined.substring(jsonStart, endIdx)) as Record<string, unknown>;
    } catch { /* keep trying */ }
  }
  return null;
}

/** Queue a continuation task for the next phase via arc CLI. Throws on failure. */
function queueContinuation(date: string, nextPhase: string, defer?: string): void {
  const script = `bun run scripts/inscribe-brief.ts run --date ${date}`;
  const subject = `Inscribe brief ${date} (phase: ${nextPhase})`;
  const args = [
    "bash", "bin/arc", "tasks", "add",
    "--script", script,
    "--priority", String(TASK_PRIORITY),
    "--subject", subject,
    "--source", TASK_SOURCE,
  ];
  if (defer) {
    args.push("--defer", defer);
  }
  const proc = Bun.spawnSync(args, { cwd: ROOT });
  const out = new TextDecoder().decode(proc.stdout).trim();
  const err = new TextDecoder().decode(proc.stderr).trim();
  if (proc.exitCode !== 0) {
    throw new Error(`Failed to queue continuation (${nextPhase}): ${err || out || `exit ${proc.exitCode}`}`);
  }
  log(`Queued continuation (${nextPhase}${defer ? `, defer ${defer}` : ""}): ${out || "ok"}`);
}

// ---------------------------------------------------------------------------
// Phase: Fetch brief
// ---------------------------------------------------------------------------

async function phaseFetch(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== FETCH BRIEF for ${record.date} ===`);
  const resp = await fetch(`${API_BASE}/brief/${record.date}`);
  if (!resp.ok) {
    throw new Error(`Brief API returned ${resp.status} for ${record.date}`);
  }

  const data = (await resp.json()) as {
    compiledAt?: string | null;
    text?: string;
    summary?: { signals?: number; correspondents?: number; beats?: number };
  };

  if (!data.compiledAt) {
    throw new Error(`Brief for ${record.date} is not compiled yet`);
  }

  if (!data.text) {
    throw new Error(`Brief for ${record.date} has no text content — may require x402`);
  }

  const contentFile = join(BRIEFS_DIR, `brief-${record.date}.txt`);
  await Bun.write(contentFile, data.text);

  record.brief_content_file = contentFile;
  record.signal_count = data.summary?.signals ?? 0;
  record.status = "fetched";
  await writeState(record);

  log(`Brief fetched: ${data.text.length} chars, ${record.signal_count} signals`);
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Estimate fees
// ---------------------------------------------------------------------------

async function phaseEstimate(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== ESTIMATE FEES ===`);
  const { stdout, stderr, exitCode } = await runChild([
    "bun", "run", CHILD_INSCRIPTION_CLI, "estimate",
    "--parent-id", PARENT_INSCRIPTION_ID,
    "--content-type", "text/plain",
    "--content-file", record.brief_content_file,
  ]);

  if (exitCode !== 0) {
    throw new Error(`child-inscription estimate failed (exit ${exitCode}): ${stderr}`);
  }

  const result = parseJson(stdout + stderr);
  if (!result?.fees) {
    throw new Error(`Could not parse estimate output: ${stdout.slice(0, 300)}`);
  }

  const fees = result.fees as { totalCost: number };
  record.estimated_cost_sats = fees.totalCost;
  record.fee_rate = (result as { feeRate?: number }).feeRate;
  record.status = "estimated";
  await writeState(record);

  log(`Estimated cost: ${fees.totalCost} sats at ${record.fee_rate} sat/vB`);
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Check balance + commit (merged — balance is a gate, not a status)
// ---------------------------------------------------------------------------

async function phaseCommit(record: InscriptionRecord): Promise<InscriptionRecord> {
  // Balance gate
  log(`=== CHECK BALANCE ===`);
  const balResp = await fetch(`${MEMPOOL_API}/address/${ARC_BTC_ADDRESS}`);
  if (!balResp.ok) {
    throw new Error(`Mempool API returned ${balResp.status}`);
  }

  const balData = (await balResp.json()) as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number };
  };
  const confirmed = balData.chain_stats.funded_txo_sum - balData.chain_stats.spent_txo_sum;
  const pending = balData.mempool_stats.funded_txo_sum - balData.mempool_stats.spent_txo_sum;
  const balance = confirmed + pending;
  const needed = record.estimated_cost_sats ?? 0;

  if (balance < needed) {
    throw new Error(
      `Insufficient balance: ${balance} sats available, need ${needed} sats. ` +
      `Fund ${ARC_BTC_ADDRESS} before retrying.`
    );
  }

  log(`Balance: ${balance} sats (need ${needed}) — sufficient`);

  // Commit
  log(`=== COMMIT TRANSACTION ===`);
  const { stdout, stderr, exitCode } = await runChild([
    "bun", "run", CHILD_INSCRIPTION_CLI, "inscribe",
    "--parent-id", PARENT_INSCRIPTION_ID,
    "--content-type", "text/plain",
    "--content-file", record.brief_content_file,
    "--fee-rate", "slow",
  ]);

  if (exitCode !== 0) {
    throw new Error(`child-inscription inscribe failed (exit ${exitCode}): ${stderr}`);
  }

  const result = parseJson(stdout + stderr);
  if (!result?.commitTxid) {
    throw new Error(`Could not parse inscribe output: ${(stdout + stderr).slice(0, 300)}`);
  }

  record.commit_txid = result.commitTxid as string;
  record.reveal_amount = result.revealAmount as number;
  record.fee_rate = result.feeRate as number;
  record.poll_attempts = 0;
  record.status = "committed";
  await writeState(record);

  log(`Commit broadcast: ${record.commit_txid} (reveal amount: ${record.reveal_amount} sats)`);
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Check confirmation (single check, not a loop)
// ---------------------------------------------------------------------------

async function phaseConfirm(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== CHECK CONFIRMATION for ${record.commit_txid} ===`);

  const attempts = (record.poll_attempts ?? 0) + 1;
  record.poll_attempts = attempts;

  const resp = await fetch(`${MEMPOOL_API}/tx/${record.commit_txid}`);
  if (resp.ok) {
    const data = (await resp.json()) as { status?: { confirmed?: boolean; block_height?: number } };
    if (data.status?.confirmed) {
      log(`Confirmed at block ${data.status.block_height} (poll attempt ${attempts})`);
      record.status = "confirmed";
      await writeState(record);
      return record;
    }
  }

  // Not confirmed yet
  await writeState(record);

  if (attempts >= MAX_POLL_ATTEMPTS) {
    // Reset poll_attempts so dispatch retries get a fresh budget
    record.poll_attempts = 0;
    await writeState(record);
    throw new Error(
      `Commit tx ${record.commit_txid} unconfirmed after ${attempts} attempts (~${attempts * 2} minutes). ` +
      `May need RBF or manual intervention.`
    );
  }

  log(`Not confirmed (attempt ${attempts}/${MAX_POLL_ATTEMPTS}) — queuing deferred retry`);
  queueContinuation(record.date, "confirm-poll", "2m");
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Reveal transaction
// ---------------------------------------------------------------------------

async function phaseReveal(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== REVEAL TRANSACTION ===`);
  const { stdout, stderr, exitCode } = await runChild([
    "bun", "run", CHILD_INSCRIPTION_CLI, "reveal",
    "--commit-txid", record.commit_txid!,
    "--vout", "0",
  ]);

  if (exitCode !== 0) {
    throw new Error(`child-inscription reveal failed (exit ${exitCode}): ${stderr}`);
  }

  const result = parseJson(stdout + stderr);
  if (!result?.inscriptionId) {
    throw new Error(`Could not parse reveal output: ${(stdout + stderr).slice(0, 300)}`);
  }

  record.inscription_id = result.inscriptionId as string;
  record.status = "revealed";
  await writeState(record);

  log(`Inscription revealed: ${record.inscription_id}`);
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Record on aibtc.news API
// ---------------------------------------------------------------------------

async function phaseRecord(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== RECORD ON API ===`);
  const { stdout, stderr, exitCode } = await runChild([
    "bash", "bin/arc", "skills", "run", "--name", "aibtc-news-classifieds", "--",
    "inscribe-brief", "--date", record.date, "--inscription-id", record.inscription_id!,
  ]);

  if (exitCode !== 0) {
    // 409 = already recorded (idempotent duplicate) — treat as success
    const combined = stderr + stdout;
    if (combined.includes("409")) {
      log(`API returned 409 (already recorded) — treating as success`);
    } else {
      throw new Error(`API recording failed (exit ${exitCode}): ${stderr.slice(0, 300)}`);
    }
  }

  record.status = "recorded";
  await writeState(record);

  log(`Inscription recorded on aibtc.news for ${record.date}`);
  return record;
}

// ---------------------------------------------------------------------------
// Phase: Notify editors
// ---------------------------------------------------------------------------

async function phaseNotify(record: InscriptionRecord): Promise<InscriptionRecord> {
  log(`=== NOTIFY EDITORS ===`);
  initDatabase();
  const db = getDatabase();

  const editors = db.query<
    { beat_slug: string; editor_name: string; btc_address: string; stx_address: string | null },
    []
  >("SELECT beat_slug, editor_name, btc_address, stx_address FROM editor_registry").all();

  // Filter to editors with stx_address (required for x402)
  const notifiable = editors.filter((e) => e.stx_address);
  if (notifiable.length === 0) {
    log("No editors with STX addresses — skipping notification");
    record.status = "completed";
    await writeState(record);
    return record;
  }

  const ordExplorerUrl = `https://ordinals.com/inscription/${record.inscription_id}`;
  const message = [
    `Daily Brief Inscribed | ${record.date}`,
    ``,
    `The ${record.date} daily brief (${record.signal_count} signals) has been permanently inscribed on Bitcoin.`,
    ``,
    `Inscription: ${record.inscription_id}`,
    `Explorer: ${ordExplorerUrl}`,
    ``,
    `Thank you for your editorial work.`,
  ].join("\n");

  const batchId = `brief-inscribed-${record.date}`;
  const batchFile = join(BATCH_DIR, `${batchId}.json`);
  const batchData = {
    messages: notifiable.map((e) => ({
      btc_address: e.btc_address,
      stx_address: e.stx_address!,
      content: message,
      label: e.editor_name.slice(0, 30),
    })),
  };

  await Bun.write(batchFile, JSON.stringify(batchData, null, 2));
  log(`Batch file written: ${batchFile} (${notifiable.length} editors)`);

  // Queue script task for the actual send — dispatch runs it directly
  const names = notifiable.map((e) => e.editor_name).join(", ");
  const subject = `Notify editors of ${record.date} brief inscription: ${names}`;
  const script = `arc skills run --name inbox-notify -- send-batch --file db/inbox-notify/${batchId}.json`;

  const proc = Bun.spawnSync(
    ["bash", "bin/arc", "tasks", "add",
      "--subject", subject,
      "--script", script,
      "--priority", String(TASK_PRIORITY),
      "--source", TASK_SOURCE],
    { cwd: ROOT }
  );
  const taskOut = new TextDecoder().decode(proc.stdout).trim();
  log(`Notification task created: ${taskOut || "ok"}`);

  record.editors_notified = notifiable.map((e) => e.editor_name);
  record.status = "completed";
  await writeState(record);

  log(`Inscription pipeline complete for ${record.date}`);
  return record;
}

// ---------------------------------------------------------------------------
// Step dispatcher — runs exactly one phase per invocation
// ---------------------------------------------------------------------------

async function cmdRun(date: string): Promise<void> {
  let record = await readState(date);

  if (record?.status === "completed") {
    log(`Inscription for ${date} already completed: ${record.inscription_id}`);
    console.log(JSON.stringify({ status: "completed", inscription_id: record.inscription_id }));
    return;
  }

  if (!record) {
    record = {
      date,
      brief_content_file: "",
      signal_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as InscriptionRecord;
  }

  // Determine and execute the next phase
  const status = record.status;
  if (!status) {
    record = await phaseFetch(record);
  } else if (status === "fetched") {
    record = await phaseEstimate(record);
  } else if (status === "estimated") {
    record = await phaseCommit(record);
  } else if (status === "committed") {
    record = await phaseConfirm(record);
  } else if (status === "confirmed") {
    record = await phaseReveal(record);
  } else if (status === "revealed") {
    record = await phaseRecord(record);
  } else if (status === "recorded") {
    record = await phaseNotify(record);
  }

  // Queue continuation if not completed.
  // Skip only when phaseConfirm queued its own deferred retry (status stayed "committed").
  const needsContinuation = record.status !== "completed" && record.status !== "committed";
  if (needsContinuation) {
    const nextPhase = STATUS_ORDER[STATUS_ORDER.indexOf(record.status) + 1] ?? "next";
    queueContinuation(date, nextPhase);
  }

  console.log(JSON.stringify({ status: record.status, phase_completed: record.status }));
}

async function cmdStatus(date: string): Promise<void> {
  const record = await readState(date);
  if (!record) {
    console.log(`No inscription in progress for ${date}`);
    return;
  }

  console.log(JSON.stringify(record, null, 2));

  if (record.commit_txid && record.status === "committed") {
    console.log(`\nCommit tx: https://mempool.space/tx/${record.commit_txid}`);
    console.log(`Poll attempts: ${record.poll_attempts ?? 0}/${MAX_POLL_ATTEMPTS}`);
    console.log("Re-run to check confirmation.");
  }
  if (record.inscription_id) {
    console.log(`\nInscription: https://ordinals.com/inscription/${record.inscription_id}`);
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const command = process.argv[2];
const args = process.argv.slice(3);

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function requireDate(): string {
  const date = getFlag("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("--date YYYY-MM-DD is required");
    process.exit(1);
  }
  return date;
}

switch (command) {
  case "run": {
    const date = requireDate();
    try {
      await cmdRun(date);
    } catch (err) {
      log(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    break;
  }
  case "status": {
    const date = requireDate();
    await cmdStatus(date);
    break;
  }
  default:
    console.log(`inscribe-brief — Daily brief inscription pipeline (step-per-invocation)

Usage:
  bun run scripts/inscribe-brief.ts run --date YYYY-MM-DD      Execute next phase
  bun run scripts/inscribe-brief.ts status --date YYYY-MM-DD   Check inscription state

Each invocation runs one phase, then queues a continuation task for the next.
State is persisted to db/inscriptions/{date}.json after each step.
Dispatch handles retries (max 3 attempts per phase).`);
    break;
}
