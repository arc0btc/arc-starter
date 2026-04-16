#!/usr/bin/env bun
// scripts/restore-rejected-signals.ts
// Phase 1B: Reverse the 2026-04-14 wholesale void of 56 legitimate signals
// across briefs 2026-04-05, 2026-04-06, 2026-04-07.
//
// The platform state machine permits rejected -> approved. Once restored,
// re-running POST /api/brief/compile for each date will transition these
// signals approved -> brief_included and re-link earnings records.
//
// Source of truth for which IDs to restore: the execute-mode log from the
// original void run at db/payouts/1a-void-execute-2026-04-14.log. Parsing
// that log guarantees we invert exactly what we did — no broader query.
//
// Usage:
//   bun run scripts/restore-rejected-signals.ts dry-run             # list targets
//   bun run scripts/restore-rejected-signals.ts dry-run 2026-04-05  # one date
//   bun run scripts/restore-rejected-signals.ts execute             # all 3 dates
//   bun run scripts/restore-rejected-signals.ts execute 2026-04-07  # one date

import { resolve, join } from "node:path";

const ARC_BTC_ADDRESS = "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku";
const API_BASE = "https://aibtc.news/api";
const ROOT = resolve(import.meta.dir, "..");
const VOID_LOG = resolve(ROOT, "db/payouts/1a-void-execute-2026-04-14.log");

const RESTORE_FEEDBACK =
  "Restored 2026-04-16 — voided in error during 2026-04-14 sweep. Signals were legitimate beat content; wholesale void was a cleanup shortcut, not editorial curation. See db/inscriptions/LEDGER.md.";

// ---- Auth ----

async function signMessage(message: string): Promise<string> {
  const proc = Bun.spawn(
    ["bash", "bin/arc", "skills", "run", "--name", "bitcoin-wallet", "--", "btc-sign", "--message", message],
    { cwd: ROOT, stdin: "ignore", stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  if ((await proc.exited) !== 0) throw new Error(`Signing failed: ${stderr}`);
  const combined = stdout + stderr;
  const jsonStart = combined.indexOf("{");
  for (let endIdx = combined.length; endIdx > jsonStart; endIdx--) {
    try {
      const result = JSON.parse(combined.substring(jsonStart, endIdx));
      if (result.signatureBase64) return result.signatureBase64;
      if (result.signature) return result.signature;
    } catch {}
  }
  throw new Error(`No signature in output`);
}

async function buildAuthHeaders(method: string, path: string): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method} /api${path}:${timestamp}`;
  const sig = await signMessage(message);
  return {
    "X-BTC-Address": ARC_BTC_ADDRESS,
    "X-BTC-Signature": sig,
    "X-BTC-Timestamp": String(timestamp),
    "Content-Type": "application/json",
  };
}

async function apiPatch(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const headers = await buildAuthHeaders("PATCH", endpoint);
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API PATCH ${endpoint} ${response.status}: ${await response.text()}`);
  return response.json();
}

// ---- Parse void log ----

interface RestoreTarget {
  date: string;
  signalId: string;
  label: string;
}

async function parseVoidLog(path: string): Promise<RestoreTarget[]> {
  const text = await Bun.file(path).text();
  const lines = text.split("\n");
  const targets: RestoreTarget[] = [];
  let currentDate: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const dateMatch = line.match(/^--- Brief (\d{4}-\d{2}-\d{2}) ---$/);
    if (dateMatch) {
      currentDate = dateMatch[1];
      continue;
    }
    const idMatch = line.match(/^\s*\[OK\] Rejected signal ([a-f0-9-]{36})\s*$/);
    if (idMatch && currentDate) {
      const labelLine = lines[i + 1] ?? "";
      const label = labelLine.trim();
      targets.push({ date: currentDate, signalId: idMatch[1], label });
    }
  }
  return targets;
}

// ---- Core logic ----

async function run(mode: "dry-run" | "execute", dateFilter: string | null): Promise<void> {
  console.log(`\n=== Phase 1B: Restore Wholesale-Voided Signals (${mode}${dateFilter ? ` · ${dateFilter}` : ""}) ===\n`);

  const allTargets = await parseVoidLog(VOID_LOG);
  const targets = dateFilter ? allTargets.filter((t) => t.date === dateFilter) : allTargets;

  if (targets.length === 0) {
    console.log(`No targets found${dateFilter ? ` for ${dateFilter}` : ""}. Aborting.`);
    return;
  }

  const byDate = new Map<string, RestoreTarget[]>();
  for (const t of targets) {
    if (!byDate.has(t.date)) byDate.set(t.date, []);
    byDate.get(t.date)!.push(t);
  }

  let totalRestored = 0;
  let totalErrors = 0;

  for (const [date, dateTargets] of byDate) {
    console.log(`\n--- Brief ${date} ---`);
    console.log(`  ${dateTargets.length} signals to restore (rejected -> approved)`);

    for (const target of dateTargets) {
      if (mode === "dry-run") {
        console.log(`  [DRY-RUN] Would approve signal ${target.signalId}`);
        console.log(`            ${target.label}`);
        totalRestored++;
      } else {
        try {
          await apiPatch(`/signals/${target.signalId}/review`, {
            btc_address: ARC_BTC_ADDRESS,
            status: "approved",
            feedback: RESTORE_FEEDBACK,
          });
          console.log(`  [OK] Approved signal ${target.signalId}`);
          console.log(`       ${target.label}`);
          totalRestored++;
          await Bun.sleep(500);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [ERROR] signal ${target.signalId}: ${msg}`);
          console.error(`          ${target.label}`);
          totalErrors++;
        }
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Dates processed:  ${byDate.size}`);
  console.log(`  Signals eligible: ${targets.length}`);
  console.log(`  ${mode === "dry-run" ? "Would approve" : "Approved"}:    ${totalRestored}`);
  if (totalErrors > 0) console.log(`  Errors:           ${totalErrors}`);
  console.log();
}

// ---- CLI ----

const mode = process.argv[2] as string | undefined;
const dateFilter = process.argv[3] as string | undefined;
if (mode !== "dry-run" && mode !== "execute") {
  console.error("Usage: bun run scripts/restore-rejected-signals.ts <dry-run|execute> [YYYY-MM-DD]");
  process.exit(1);
}
if (dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
  console.error(`Invalid date filter: ${dateFilter}. Expected YYYY-MM-DD.`);
  process.exit(1);
}

run(mode, dateFilter ?? null).catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
