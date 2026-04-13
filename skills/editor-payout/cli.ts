#!/usr/bin/env bun
// skills/editor-payout/cli.ts
// CLI for editor payout management: calculate, execute, status, registry.
// Usage: arc skills run --name editor-payout -- <command> [flags]
//
// Data flow:
//   1. Check spot-check gate (completed task or window expired)
//   2. Fetch brief signals grouped by beat — only beats with signals get paid
//   3. Look up editor per beat from local editor_registry table
//   4. Resolve editor BTC→STX via aibtc.com agent registry / contact-registry
//   5. Send sBTC (175K sats per editor per beat)
//   6. Record to editor_payouts table (full audit trail)

import { ARC_BTC_ADDRESS } from "../../src/identity.ts";
import { getCredential } from "../../src/credentials.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";
import { resolve } from "node:path";
import { acquireNonce, releaseNonce, syncNonce } from "../nonce-manager/nonce-store.js";

const API_BASE = "https://aibtc.news/api";
const SBTC_SEND_RUNNER = resolve(import.meta.dir, "../brief-payout/sbtc-send-runner.ts");
const EDITOR_RATE_SATS = 175_000;

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [editor-payout/cli] ${message}`);
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

function todayPST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

// ---- Editor Registry ----

interface EditorEntry {
  beat_slug: string;
  editor_name: string;
  btc_address: string;
  stx_address: string | null;
  cached_at: string;
  source: string;
}

function getEditorRegistry(): EditorEntry[] {
  const db = getDatabase();
  return db.query<EditorEntry, []>("SELECT * FROM editor_registry ORDER BY beat_slug").all();
}

function setEditorEntry(entry: { beat_slug: string; editor_name: string; btc_address: string; stx_address?: string; source?: string }): void {
  const db = getDatabase();
  db.run(
    `INSERT INTO editor_registry (beat_slug, editor_name, btc_address, stx_address, cached_at, source)
     VALUES (?, ?, ?, ?, datetime('now'), ?)
     ON CONFLICT(beat_slug) DO UPDATE SET
       editor_name = excluded.editor_name,
       btc_address = excluded.btc_address,
       stx_address = COALESCE(excluded.stx_address, editor_registry.stx_address),
       cached_at = excluded.cached_at,
       source = excluded.source`,
    [entry.beat_slug, entry.editor_name, entry.btc_address, entry.stx_address ?? null, entry.source ?? "manual"]
  );
}

async function refreshRegistryFromAPI(): Promise<void> {
  log("Refreshing editor registry from aibtc.news API...");

  const resp = await fetch(`${API_BASE}/beats`);
  if (!resp.ok) throw new Error(`Beats API returned ${resp.status}`);
  const data = (await resp.json()) as {
    beats?: Array<{
      slug: string;
      status?: string;
      editor?: string;
      members?: Array<{ address: string; role?: string }>;
    }>;
  };

  const beats = (data.beats ?? []).filter((b) => b.status === "active");
  let updated = 0;

  for (const beat of beats) {
    // Try editor field first (when API supports it)
    if (beat.editor) {
      const name = await resolveAgentName(beat.editor);
      setEditorEntry({ beat_slug: beat.slug, editor_name: name, btc_address: beat.editor, source: "api" });
      updated++;
      continue;
    }

    // Fallback: check members for editor role
    const editorMember = beat.members?.find((m) => m.role === "editor");
    if (editorMember) {
      const name = await resolveAgentName(editorMember.address);
      setEditorEntry({ beat_slug: beat.slug, editor_name: name, btc_address: editorMember.address, source: "api" });
      updated++;
    }
  }

  log(`Updated ${updated} editor(s) from API. ${beats.length - updated} beat(s) have no editor exposed — use 'registry set' for those.`);

  // Resolve STX addresses for any entries missing them
  await resolveRegistryStxAddresses();
}

async function resolveAgentName(btcAddress: string): Promise<string> {
  try {
    const resp = await fetch(`${API_BASE}/status/${btcAddress}`);
    if (resp.ok) {
      const data = (await resp.json()) as { agent?: { displayName?: string; name?: string } };
      return data.agent?.displayName ?? data.agent?.name ?? btcAddress.slice(0, 12);
    }
  } catch { /* fallback */ }
  return btcAddress.slice(0, 12);
}

async function resolveRegistryStxAddresses(): Promise<void> {
  const editors = getEditorRegistry().filter((e) => !e.stx_address);
  if (editors.length === 0) return;

  log(`Resolving STX addresses for ${editors.length} editor(s)...`);
  const db = getDatabase();

  // Try aibtc.com agent registry
  try {
    let offset = 0;
    let hasMore = true;
    const unresolved = new Map(editors.map((e) => [e.btc_address, e.beat_slug]));

    while (hasMore && unresolved.size > 0) {
      const resp = await fetch(`https://aibtc.com/api/agents?limit=100&offset=${offset}`);
      if (!resp.ok) break;
      const data = (await resp.json()) as {
        agents?: Array<{ btcAddress?: string; stxAddress?: string }>;
        pagination?: { hasMore?: boolean };
      };
      for (const agent of data.agents ?? []) {
        if (agent.btcAddress && agent.stxAddress && unresolved.has(agent.btcAddress)) {
          db.run("UPDATE editor_registry SET stx_address = ?, cached_at = datetime('now') WHERE btc_address = ?",
            [agent.stxAddress, agent.btcAddress]);
          log(`Resolved ${agent.btcAddress.slice(0, 12)}... → ${agent.stxAddress}`);
          unresolved.delete(agent.btcAddress);
        }
      }
      hasMore = data.pagination?.hasMore ?? false;
      offset += 100;
    }
  } catch (err) {
    log(`aibtc.com API error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Fallback: contact-registry for still-unresolved
  const stillMissing = getEditorRegistry().filter((e) => !e.stx_address);
  for (const editor of stillMissing) {
    try {
      const proc = Bun.spawn(
        ["bash", "bin/arc", "skills", "run", "--name", "contact-registry", "--", "search", "--term", editor.btc_address],
        { cwd: resolve(import.meta.dir, "../.."), stdin: "ignore", stdout: "pipe", stderr: "pipe" }
      );
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const stxMatch = stdout.match(/STX:\s*(S[PT][A-Z0-9]+)/);
      if (stxMatch) {
        db.run("UPDATE editor_registry SET stx_address = ?, cached_at = datetime('now') WHERE btc_address = ?",
          [stxMatch[1], editor.btc_address]);
        log(`Resolved via contact-registry: ${editor.btc_address.slice(0, 12)}... → ${stxMatch[1]}`);
      }
    } catch { /* will be flagged as unresolvable */ }
  }
}

// ---- Audit Trail (editor_payouts table) ----

interface EditorPayoutRow {
  id: number;
  date: string;
  beat_slug: string;
  editor_name: string;
  editor_btc_address: string;
  editor_stx_address: string | null;
  amount_sats: number;
  signals_included: number;
  txid: string | null;
  status: string;
  spot_check_task_id: number | null;
  created_at: string;
  sent_at: string | null;
  error: string | null;
}

function getPayoutsForDate(date: string): EditorPayoutRow[] {
  const db = getDatabase();
  return db.query<EditorPayoutRow, [string]>(
    "SELECT * FROM editor_payouts WHERE date = ? ORDER BY beat_slug"
  ).all(date);
}

function upsertPayout(payout: {
  date: string;
  beat_slug: string;
  editor_name: string;
  editor_btc_address: string;
  editor_stx_address: string | null;
  amount_sats: number;
  signals_included: number;
  spot_check_task_id: number | null;
}): void {
  const db = getDatabase();
  db.run(
    `INSERT INTO editor_payouts (date, beat_slug, editor_name, editor_btc_address, editor_stx_address, amount_sats, signals_included, spot_check_task_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(date, beat_slug) DO UPDATE SET
       editor_name = excluded.editor_name,
       editor_btc_address = excluded.editor_btc_address,
       editor_stx_address = COALESCE(excluded.editor_stx_address, editor_payouts.editor_stx_address),
       amount_sats = excluded.amount_sats,
       signals_included = excluded.signals_included,
       spot_check_task_id = excluded.spot_check_task_id`,
    [payout.date, payout.beat_slug, payout.editor_name, payout.editor_btc_address,
     payout.editor_stx_address, payout.amount_sats, payout.signals_included, payout.spot_check_task_id]
  );
}

function markPayoutSent(date: string, beatSlug: string, txid: string): void {
  const db = getDatabase();
  db.run(
    "UPDATE editor_payouts SET txid = ?, status = 'sent', sent_at = datetime('now') WHERE date = ? AND beat_slug = ?",
    [txid, date, beatSlug]
  );
}

function markPayoutFailed(date: string, beatSlug: string, error: string): void {
  const db = getDatabase();
  db.run(
    "UPDATE editor_payouts SET status = 'failed', error = ? WHERE date = ? AND beat_slug = ?",
    [error, date, beatSlug]
  );
}

// ---- Brief Signal Data ----

async function getBriefSignalsByBeat(date: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // Try brief_included signals for this date
  const resp = await fetch(`${API_BASE}/signals?status=brief_included&date=${date}&limit=200`);
  if (!resp.ok) {
    // Fallback: try the brief endpoint directly
    const briefResp = await fetch(`${API_BASE}/brief/${date}`);
    if (!briefResp.ok) throw new Error(`Cannot fetch brief data for ${date}`);
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

// ---- Spot Check Gate ----

function getSpotCheckTaskId(date: string): number | null {
  const db = getDatabase();
  const row = db.query<{ id: number }, [string]>(
    `SELECT id FROM tasks
     WHERE source LIKE 'sensor:editor-spot-check%'
       AND status = 'completed'
       AND created_at >= ?
     ORDER BY completed_at DESC LIMIT 1`
  ).get(date);
  return row?.id ?? null;
}

// ---- sBTC Send ----

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
          try { JSON.parse(trimmed); clearTimeout(timer); proc.kill(); res(trimmed); return; } catch { /* incomplete */ }
        }
      }
      clearTimeout(timer);
      res(stdout.trim());
    } catch (error) { clearTimeout(timer); rej(error); }
  });

  await new Response(proc.stderr).text().catch(() => {});
  try { return JSON.parse(result); } catch { return { success: false, error: "Failed to parse runner output", detail: result }; }
}

// ---- Commands ----

async function cmdCalculate(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Calculating editor payouts for ${date}`);

  const editors = getEditorRegistry();
  if (editors.length === 0) {
    console.log(JSON.stringify({ error: "Editor registry empty. Run: arc skills run --name editor-payout -- registry refresh" }));
    return;
  }

  const beatCounts = await getBriefSignalsByBeat(date);
  const spotCheckId = getSpotCheckTaskId(date);

  const plan: Array<{
    beat: string;
    editor: string;
    btcAddress: string;
    stxAddress: string | null;
    signals: number;
    amountSats: number;
    spotCheckTaskId: number | null;
  }> = [];

  for (const editor of editors) {
    const signals = beatCounts[editor.beat_slug] ?? 0;
    if (signals === 0) {
      log(`${editor.beat_slug}: no signals in brief — skipping`);
      continue;
    }
    plan.push({
      beat: editor.beat_slug,
      editor: editor.editor_name,
      btcAddress: editor.btc_address,
      stxAddress: editor.stx_address,
      signals,
      amountSats: EDITOR_RATE_SATS,
      spotCheckTaskId: spotCheckId,
    });
  }

  const totalSats = plan.length * EDITOR_RATE_SATS;
  const unresolvedStx = plan.filter((p) => !p.stxAddress);

  // Check sBTC balance
  let balanceSats = 0;
  try {
    const stxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
    const sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
    const resp = await fetch(`https://api.hiro.so/extended/v1/address/${stxAddress}/balances`);
    if (resp.ok) {
      const data = (await resp.json()) as { fungible_tokens?: Record<string, { balance: string }> };
      balanceSats = parseInt(data.fungible_tokens?.[sbtcContract]?.balance ?? "0", 10);
    }
  } catch { /* will show 0 */ }

  console.log(JSON.stringify({
    date,
    editors: plan,
    totalSats,
    balanceSats,
    canPay: balanceSats >= totalSats && unresolvedStx.length === 0,
    unresolvedStxAddresses: unresolvedStx.map((p) => p.btcAddress),
    spotCheckTaskId: spotCheckId,
    spotCheckGate: spotCheckId ? "passed" : "not completed",
    beatSignalCounts: beatCounts,
  }, null, 2));
}

async function cmdExecute(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  log(`Executing editor payouts for ${date}`);

  const editors = getEditorRegistry();
  if (editors.length === 0) {
    console.log(JSON.stringify({ error: "Editor registry empty" }));
    process.exit(1);
  }

  // Check for already-completed payouts
  const existing = getPayoutsForDate(date);
  const allSent = existing.length > 0 && existing.every((p) => p.status === "sent");
  if (allSent) {
    log("All editor payouts already sent for this date");
    console.log(JSON.stringify({ date, status: "complete", payouts: existing }));
    return;
  }

  const beatCounts = await getBriefSignalsByBeat(date);
  const spotCheckId = getSpotCheckTaskId(date);

  // Create payout records for beats with signals
  const payable: Array<{ editor: EditorEntry; signals: number }> = [];
  for (const editor of editors) {
    const signals = beatCounts[editor.beat_slug] ?? 0;
    if (signals === 0) continue;
    if (!editor.stx_address) {
      log(`${editor.beat_slug}: editor STX address not resolved — skipping`);
      continue;
    }

    // Check if already sent
    const existingPayout = existing.find((p) => p.beat_slug === editor.beat_slug);
    if (existingPayout?.status === "sent") {
      log(`${editor.beat_slug}: already paid (txid: ${existingPayout.txid})`);
      continue;
    }

    upsertPayout({
      date,
      beat_slug: editor.beat_slug,
      editor_name: editor.editor_name,
      editor_btc_address: editor.btc_address,
      editor_stx_address: editor.stx_address,
      amount_sats: EDITOR_RATE_SATS,
      signals_included: signals,
      spot_check_task_id: spotCheckId,
    });

    payable.push({ editor, signals });
  }

  if (payable.length === 0) {
    log("No payable editors (all sent or no signals)");
    console.log(JSON.stringify({ date, status: "complete", message: "Nothing to pay" }));
    return;
  }

  // Check balance
  const totalNeeded = payable.length * EDITOR_RATE_SATS;
  const stxAddress = "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM";
  const sbtcContract = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token";
  let balanceSats = 0;
  try {
    const resp = await fetch(`https://api.hiro.so/extended/v1/address/${stxAddress}/balances`);
    if (resp.ok) {
      const data = (await resp.json()) as { fungible_tokens?: Record<string, { balance: string }> };
      balanceSats = parseInt(data.fungible_tokens?.[sbtcContract]?.balance ?? "0", 10);
    }
  } catch { /* */ }

  if (balanceSats < totalNeeded) {
    log(`Insufficient sBTC: have ${balanceSats}, need ${totalNeeded}`);
    console.log(JSON.stringify({ error: "Insufficient sBTC balance", balanceSats, requiredSats: totalNeeded }));
    process.exit(1);
  }

  const { walletId, walletPassword } = await getWalletCreds();

  // Acquire initial nonce
  let currentNonce: number;
  try {
    currentNonce = (await acquireNonce(stxAddress)).nonce;
    log(`Initial nonce: ${currentNonce}`);
  } catch (err) {
    log(`Nonce acquisition failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let successCount = 0;
  let failCount = 0;

  for (const { editor, signals } of payable) {
    log(`Paying ${editor.editor_name} (${editor.beat_slug}): ${EDITOR_RATE_SATS} sats for ${signals} signal(s) → ${editor.stx_address} (nonce=${currentNonce})`);

    try {
      const result = await sendSbtc(
        walletId, walletPassword,
        editor.stx_address!,
        EDITOR_RATE_SATS,
        `editor-payout ${date} ${editor.beat_slug}`,
        BigInt(currentNonce),
      );

      if (result.success && result.txid) {
        markPayoutSent(date, editor.beat_slug, result.txid);
        successCount++;
        await releaseNonce(stxAddress, currentNonce, true);
        try {
          currentNonce = (await acquireNonce(stxAddress)).nonce;
        } catch {
          log("Failed to acquire next nonce — stopping batch");
          break;
        }
        log(`Sent: ${result.txid}`);
      } else {
        const errorMsg = result.error ?? result.detail ?? "Unknown error";
        markPayoutFailed(date, editor.beat_slug, errorMsg);
        await releaseNonce(stxAddress, currentNonce, false, errorMsg.toLowerCase().includes("nonce") ? "rejected" : "broadcast");
        failCount++;
        log(`Failed: ${errorMsg}`);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      markPayoutFailed(date, editor.beat_slug, errorMsg);
      await releaseNonce(stxAddress, currentNonce, false);
      failCount++;
      log(`Error: ${errorMsg}`);
    }
  }

  // Release unused nonce
  await releaseNonce(stxAddress, currentNonce, false, "rejected").catch(() => {});

  const finalPayouts = getPayoutsForDate(date);
  console.log(JSON.stringify({
    date,
    status: failCount === 0 ? "complete" : successCount === 0 ? "failed" : "partial",
    sent: successCount,
    failed: failCount,
    totalSats: successCount * EDITOR_RATE_SATS,
    payouts: finalPayouts,
  }, null, 2));
}

async function getWalletCreds(): Promise<{ walletId: string; walletPassword: string }> {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const walletPassword = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !walletPassword) throw new Error("Wallet credentials not found");
  return { walletId, walletPassword };
}

function cmdStatus(args: string[]): void {
  const flags = parseFlags(args);
  const date = flags.date || todayPST();

  const payouts = getPayoutsForDate(date);
  if (payouts.length === 0) {
    console.log(JSON.stringify({ date, status: "none", message: "No editor payouts for this date" }));
    return;
  }

  const sent = payouts.filter((p) => p.status === "sent").length;
  const failed = payouts.filter((p) => p.status === "failed").length;
  const pending = payouts.filter((p) => p.status === "pending").length;

  console.log(JSON.stringify({
    date,
    status: failed === 0 && pending === 0 ? "complete" : pending > 0 ? "pending" : "partial",
    sent, failed, pending,
    totalSats: sent * EDITOR_RATE_SATS,
    payouts,
  }, null, 2));
}

async function cmdRegistry(args: string[]): Promise<void> {
  const subcommand = args[0];
  const flags = parseFlags(args.slice(1));

  switch (subcommand) {
    case "list": {
      const editors = getEditorRegistry();
      if (editors.length === 0) {
        console.log(JSON.stringify({ message: "Registry empty. Run 'registry refresh' or 'registry set'." }));
        return;
      }
      console.log(JSON.stringify({ editors }, null, 2));
      break;
    }
    case "refresh": {
      await refreshRegistryFromAPI();
      const editors = getEditorRegistry();
      console.log(JSON.stringify({ message: "Registry refreshed", editors }, null, 2));
      break;
    }
    case "set": {
      const beat = flags["beat"];
      const btcAddress = flags["btc-address"];
      const name = flags["name"] ?? btcAddress?.slice(0, 12) ?? "unknown";
      const stxAddress = flags["stx-address"];
      if (!beat || !btcAddress) {
        console.error("Usage: registry set --beat SLUG --btc-address ADDR [--stx-address ADDR] [--name NAME]");
        process.exit(1);
      }
      setEditorEntry({ beat_slug: beat, editor_name: name, btc_address: btcAddress, stx_address: stxAddress, source: "manual" });
      log(`Set editor for ${beat}: ${name} (${btcAddress})`);
      // Auto-resolve STX if not provided
      if (!stxAddress) await resolveRegistryStxAddresses();
      const editors = getEditorRegistry();
      console.log(JSON.stringify({ message: `Editor set for ${beat}`, editors }, null, 2));
      break;
    }
    default:
      console.error("Usage: registry <list|refresh|set> [flags]");
      process.exit(1);
  }
}

function printUsage(): void {
  console.error(`editor-payout CLI — pay editors for daily brief beat coverage

USAGE
  arc skills run --name editor-payout -- <command> [flags]

COMMANDS
  calculate --date YYYY-MM-DD         Dry run: check gates, list payable editors, verify balance
  execute --date YYYY-MM-DD           Send sBTC to editors, record in audit table
  status --date YYYY-MM-DD            Check payout status for a date
  registry list                       Show cached editor registry
  registry refresh                    Refresh from aibtc.news API
  registry set --beat SLUG --btc-address ADDR [--stx-address ADDR] [--name NAME]

FLAGS
  --date YYYY-MM-DD   Target date (defaults to today PST)

ECONOMICS
  Each editor receives ${EDITOR_RATE_SATS.toLocaleString()} sats per beat per day (if beat has signals in brief).
  Editors are responsible for paying their own correspondents.
`);
}

async function main(): Promise<void> {
  initDatabase();
  const args = process.argv.slice(2);
  const command = args[0];
  const commandArgs = args.slice(1);

  switch (command) {
    case "calculate": await cmdCalculate(commandArgs); break;
    case "execute": await cmdExecute(commandArgs); break;
    case "status": cmdStatus(commandArgs); break;
    case "registry": await cmdRegistry(commandArgs); break;
    case "help": case "--help": case "-h": case undefined: printUsage(); break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
