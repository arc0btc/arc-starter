#!/usr/bin/env bun
// skills/eic-payout/cli.ts
// CLI for EIC payout: calculate, execute, status, balance-check.
// Flat 400K/day to the single registered editor when any of the 3 active beats
// have signals in the inscribed brief. Supersedes editor-payout (v2, retired).

import { getCredential } from "../../src/credentials.ts";
import { initDatabase, getDatabase, insertTask } from "../../src/db.ts";
import { resolve } from "node:path";
import { acquireNonce, releaseNonce } from "../nonce-manager/nonce-store.js";

const API_BASE = "https://aibtc.news/api";
const SBTC_SEND_RUNNER = resolve(import.meta.dir, "../brief-payout/sbtc-send-runner.ts");
const EIC_RATE_SATS = 400_000;
const ACTIVE_BEATS = ["aibtc-network", "bitcoin-macro", "quantum"];
const PUBLISHER_STX = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
const SBTC_CONTRACT = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";

function log(msg: string): void {
  console.error(`[${new Date().toISOString()}] [eic-payout/cli] ${msg}`);
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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

// ---- Editor resolution ----

interface EditorEntry {
  beat_slug: string;
  editor_name: string;
  btc_address: string;
  stx_address: string | null;
}

function resolveEic(): { editor: EditorEntry; perBeat: EditorEntry[] } {
  const db = getDatabase();
  const rows = db.query<EditorEntry, []>(
    `SELECT beat_slug, editor_name, btc_address, stx_address
     FROM editor_registry WHERE beat_slug IN ('aibtc-network','bitcoin-macro','quantum')
     ORDER BY beat_slug`
  ).all();

  if (rows.length === 0) {
    throw new Error("editor_registry empty for the 3 active beats. Populate via: arc skills run --name editor-payout -- registry set ...");
  }

  const uniqueBtc = new Set(rows.map((r) => r.btc_address));
  if (uniqueBtc.size > 1) {
    throw new Error(`editor_registry inconsistent — ${uniqueBtc.size} distinct editors across active beats. Expected single EIC across all 3 beats.`);
  }

  return { editor: rows[0], perBeat: rows };
}

// ---- Brief signal counts ----

async function getBriefSignalsByBeat(date: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const resp = await fetch(`${API_BASE}/signals?status=brief_included&date=${date}&limit=200`);
  if (!resp.ok) {
    const briefResp = await fetch(`${API_BASE}/brief/${date}`);
    if (!briefResp.ok) throw new Error(`Cannot fetch brief data for ${date} (${briefResp.status})`);
    const briefData = (await briefResp.json()) as { sections?: Array<{ beatSlug?: string; beat?: string }> };
    for (const s of briefData.sections ?? []) {
      const slug = s.beatSlug ?? s.beat?.toLowerCase() ?? "unknown";
      counts[slug] = (counts[slug] ?? 0) + 1;
    }
    return counts;
  }
  const data = (await resp.json()) as { signals?: Array<{ beat: string; beatSlug?: string }> };
  for (const s of data.signals ?? []) {
    const slug = s.beatSlug ?? s.beat.toLowerCase();
    counts[slug] = (counts[slug] ?? 0) + 1;
  }
  return counts;
}

// ---- Audit table (eic_payouts) ----

interface EicPayoutRow {
  id: number;
  date: string;
  editor_name: string;
  editor_btc_address: string;
  editor_stx_address: string | null;
  amount_sats: number;
  beats_with_signals: string;
  signals_total: number;
  txid: string | null;
  status: string;
  spot_check_task_id: number | null;
  created_at: string;
  sent_at: string | null;
  error: string | null;
}

function getPayoutRow(date: string): EicPayoutRow | null {
  return getDatabase().query<EicPayoutRow, [string]>("SELECT * FROM eic_payouts WHERE date = ?").get(date) ?? null;
}

function upsertPayout(row: {
  date: string;
  editor_name: string;
  editor_btc_address: string;
  editor_stx_address: string | null;
  beats_with_signals: string[];
  signals_total: number;
  spot_check_task_id: number | null;
}): void {
  getDatabase().run(
    `INSERT INTO eic_payouts (date, editor_name, editor_btc_address, editor_stx_address,
       amount_sats, beats_with_signals, signals_total, spot_check_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       editor_name = excluded.editor_name,
       editor_btc_address = excluded.editor_btc_address,
       editor_stx_address = COALESCE(excluded.editor_stx_address, eic_payouts.editor_stx_address),
       beats_with_signals = excluded.beats_with_signals,
       signals_total = excluded.signals_total,
       spot_check_task_id = excluded.spot_check_task_id`,
    [row.date, row.editor_name, row.editor_btc_address, row.editor_stx_address,
     EIC_RATE_SATS, JSON.stringify(row.beats_with_signals), row.signals_total, row.spot_check_task_id]
  );
}

function markSent(date: string, txid: string): void {
  getDatabase().run("UPDATE eic_payouts SET txid = ?, status = 'sent', sent_at = datetime('now') WHERE date = ?", [txid, date]);
}

function markFailed(date: string, error: string): void {
  getDatabase().run("UPDATE eic_payouts SET status = 'failed', error = ? WHERE date = ?", [error, date]);
}

// ---- Spot check (informational) ----

function getSpotCheckTaskId(date: string): number | null {
  const row = getDatabase().query<{ id: number }, [string]>(
    `SELECT id FROM tasks WHERE source LIKE 'sensor:editor-spot-check%'
       AND status = 'completed' AND created_at >= ? ORDER BY completed_at DESC LIMIT 1`
  ).get(date);
  return row?.id ?? null;
}

// ---- sBTC balance + send ----

async function getSbtcBalanceSats(): Promise<number> {
  try {
    const resp = await fetch(`https://api.hiro.so/extended/v1/address/${PUBLISHER_STX}/balances`);
    if (!resp.ok) return 0;
    const data = (await resp.json()) as { fungible_tokens?: Record<string, { balance: string }> };
    return parseInt(data.fungible_tokens?.[SBTC_CONTRACT]?.balance ?? "0", 10);
  } catch {
    return 0;
  }
}

async function sendSbtc(
  walletId: string, walletPassword: string,
  recipient: string, amountSats: number, memo: string, nonce?: bigint,
): Promise<{ success: boolean; txid?: string; error?: string; detail?: string }> {
  const args = ["--recipient", recipient, "--amount-sats", String(amountSats), "--memo", memo];
  if (nonce !== undefined) args.push("--nonce", String(nonce));

  const proc = Bun.spawn(["bun", "run", SBTC_SEND_RUNNER, ...args], {
    cwd: resolve(import.meta.dir, "../.."),
    stdin: "ignore", stdout: "pipe", stderr: "pipe",
    env: { ...process.env, WALLET_ID: walletId, WALLET_PASSWORD: walletPassword, NETWORK: "mainnet" },
  });

  let stdout = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  const result = await new Promise<string>(async (res, rej) => {
    const timer = setTimeout(() => { proc.kill(); rej(new Error("Timeout (90s)")); }, 90000);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stdout += decoder.decode(value, { stream: true });
        const trimmed = stdout.trim();
        if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
          try { JSON.parse(trimmed); clearTimeout(timer); proc.kill(); res(trimmed); return; } catch { /* partial */ }
        }
      }
      clearTimeout(timer);
      res(stdout.trim());
    } catch (err) { clearTimeout(timer); rej(err); }
  });
  await new Response(proc.stderr).text().catch(() => {});
  try { return JSON.parse(result); } catch { return { success: false, error: "Failed to parse runner output", detail: result }; }
}

async function getWalletCreds(): Promise<{ walletId: string; walletPassword: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) throw new Error("Wallet credentials not found");
  return { walletId, walletPassword };
}

// ---- Commands ----

async function cmdCalculate(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayUTC();
  log(`Calculating EIC payout for ${date}`);

  const { editor, perBeat } = resolveEic();
  const beatCounts = await getBriefSignalsByBeat(date);
  const beatsWithSignals = ACTIVE_BEATS.filter((b) => (beatCounts[b] ?? 0) > 0);
  const signalsTotal = ACTIVE_BEATS.reduce((sum, b) => sum + (beatCounts[b] ?? 0), 0);
  const spotCheckId = getSpotCheckTaskId(date);
  const balanceSats = await getSbtcBalanceSats();
  const existing = getPayoutRow(date);

  const willPay = beatsWithSignals.length > 0 && editor.stx_address !== null;

  console.log(JSON.stringify({
    date,
    editor: {
      name: editor.editor_name,
      btc_address: editor.btc_address,
      stx_address: editor.stx_address,
    },
    amount_sats: EIC_RATE_SATS,
    beats_with_signals: beatsWithSignals,
    signals_total: signalsTotal,
    beat_signal_counts: beatCounts,
    balance_sats: balanceSats,
    can_pay: willPay && balanceSats >= EIC_RATE_SATS,
    spot_check_task_id: spotCheckId,
    spot_check_gate: spotCheckId ? "passed" : "not completed (informational)",
    already_sent: existing?.status === "sent",
    existing_txid: existing?.txid ?? null,
    per_beat_registry: perBeat.map((r) => ({ beat: r.beat_slug, btc: r.btc_address })),
  }, null, 2));
}

async function cmdExecute(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayUTC();
  log(`Executing EIC payout for ${date}`);

  const existing = getPayoutRow(date);
  if (existing?.status === "sent") {
    log(`EIC payout already sent for ${date}: ${existing.txid}`);
    console.log(JSON.stringify({ date, status: "complete", txid: existing.txid, amount_sats: existing.amount_sats }));
    return;
  }

  const { editor } = resolveEic();
  if (!editor.stx_address) {
    console.log(JSON.stringify({ error: "Editor STX address unresolved", btc_address: editor.btc_address }));
    process.exit(1);
  }

  const beatCounts = await getBriefSignalsByBeat(date);
  const beatsWithSignals = ACTIVE_BEATS.filter((b) => (beatCounts[b] ?? 0) > 0);
  const signalsTotal = ACTIVE_BEATS.reduce((sum, b) => sum + (beatCounts[b] ?? 0), 0);

  if (beatsWithSignals.length === 0) {
    log(`No beats with signals in brief ${date} — nothing to pay`);
    console.log(JSON.stringify({ date, status: "skipped", reason: "no signals in brief" }));
    return;
  }

  const balanceSats = await getSbtcBalanceSats();
  if (balanceSats < EIC_RATE_SATS) {
    log(`Insufficient sBTC: have ${balanceSats}, need ${EIC_RATE_SATS}`);
    console.log(JSON.stringify({ error: "Insufficient sBTC balance", balance_sats: balanceSats, required_sats: EIC_RATE_SATS }));
    process.exit(1);
  }

  const spotCheckId = getSpotCheckTaskId(date);
  upsertPayout({
    date,
    editor_name: editor.editor_name,
    editor_btc_address: editor.btc_address,
    editor_stx_address: editor.stx_address,
    beats_with_signals: beatsWithSignals,
    signals_total: signalsTotal,
    spot_check_task_id: spotCheckId,
  });

  const { walletId, walletPassword } = await getWalletCreds();
  let nonce: number;
  try {
    nonce = (await acquireNonce(PUBLISHER_STX)).nonce;
  } catch (err) {
    log(`Nonce acquisition failed: ${err instanceof Error ? err.message : String(err)}`);
    markFailed(date, "nonce acquisition failed");
    process.exit(1);
  }

  log(`Sending ${EIC_RATE_SATS} sBTC to ${editor.editor_name} at ${editor.stx_address} (nonce=${nonce})`);
  const memo = `eic-payout ${date}`;
  const result = await sendSbtc(walletId, walletPassword, editor.stx_address, EIC_RATE_SATS, memo, BigInt(nonce));

  if (result.success && result.txid) {
    markSent(date, result.txid);
    await releaseNonce(PUBLISHER_STX, nonce, true);
    log(`Sent: ${result.txid}`);

    // Create balance-check follow-on (script-only, no LLM)
    const nextDate = (() => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const followOnId = insertTask({
      subject: `eic-payout balance check for ${nextDate} funding`,
      description: `Verifies Publisher sBTC balance is >= ${EIC_RATE_SATS} before the next EIC payout.\nFollow-on from eic-payout execute for ${date}.`,
      priority: 8,
      skills: JSON.stringify([]),
      script: `arc skills run --name eic-payout -- balance-check --next-date ${nextDate}`,
      source: `skill:eic-payout:follow-on:${date}`,
      scheduled_for: new Date(Date.now() + 5 * 60_000).toISOString(),
    });
    log(`Balance-check follow-on task #${followOnId} created for next-date=${nextDate}`);

    console.log(JSON.stringify({ date, status: "sent", txid: result.txid, amount_sats: EIC_RATE_SATS, editor: editor.editor_name }));
  } else {
    const errorMsg = result.error ?? result.detail ?? "Unknown error";
    markFailed(date, errorMsg);
    await releaseNonce(PUBLISHER_STX, nonce, false, errorMsg.toLowerCase().includes("nonce") ? "rejected" : "broadcast");
    log(`Failed: ${errorMsg}`);
    console.log(JSON.stringify({ date, status: "failed", error: errorMsg }));
    process.exit(1);
  }
}

function cmdStatus(args: string[]): void {
  const flags = parseFlags(args);
  const date = flags.date || todayUTC();
  const row = getPayoutRow(date);
  if (!row) {
    console.log(JSON.stringify({ date, status: "none" }));
    return;
  }
  console.log(JSON.stringify({
    ...row,
    beats_with_signals: JSON.parse(row.beats_with_signals) as string[],
  }, null, 2));
}

async function cmdBalanceCheck(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const nextDate = flags["next-date"] || tomorrowUTC();
  const balanceSats = await getSbtcBalanceSats();
  const ok = balanceSats >= EIC_RATE_SATS;
  const out = { next_date: nextDate, balance_sats: balanceSats, required_sats: EIC_RATE_SATS, ok };
  console.log(JSON.stringify(out, null, 2));
  if (!ok) {
    log(`SHORT: balance ${balanceSats} < required ${EIC_RATE_SATS} for ${nextDate}. Top up Publisher sBTC wallet.`);
    process.exit(1);
  }
}

function printUsage(): void {
  console.error(`eic-payout CLI — flat 400K sBTC/day to the EIC

USAGE
  arc skills run --name eic-payout -- <command> [flags]

COMMANDS
  calculate --date YYYY-MM-DD        Dry-run: resolve editor, count signals, check balance
  execute --date YYYY-MM-DD          Send 400K sBTC + create balance-check follow-on task
  status --date YYYY-MM-DD           Read eic_payouts row
  balance-check --next-date YYYY-MM-DD   Script-only: exit 1 if balance < 400K

FLAGS
  --date YYYY-MM-DD        Target date (defaults to today UTC)
  --next-date YYYY-MM-DD   For balance-check only (defaults to tomorrow UTC)
`);
}

async function main(): Promise<void> {
  initDatabase();
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rest = args.slice(1);

  switch (cmd) {
    case "calculate": await cmdCalculate(rest); break;
    case "execute": await cmdExecute(rest); break;
    case "status": cmdStatus(rest); break;
    case "balance-check": await cmdBalanceCheck(rest); break;
    case "help": case "--help": case "-h": case undefined: printUsage(); break;
    default:
      console.error(`Unknown command: ${cmd}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
