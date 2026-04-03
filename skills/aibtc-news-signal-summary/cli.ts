#!/usr/bin/env bun
// skills/aibtc-news-signal-summary/cli.ts
// Outputs a daily signal activity summary table for aibtc.news.
// Sources: aibtc.news API (signal counts, inscriptions), db/briefs/ (brief files), db/payouts/ (payout records).

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const BRIEFS_DIR = resolve(ROOT, "db/briefs");
const API_BASE = "https://aibtc.news/api";

// ---- Helpers ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

async function apiGetCount(endpoint: string): Promise<number> {
  // The API caps `total` at `limit` (max 200), so we must paginate to get true counts.
  let count = 0;
  let offset = 0;
  const pageSize = 200;
  try {
    while (true) {
      const sep = endpoint.includes("?") ? "&" : "?";
      const url = `${API_BASE}${endpoint}${sep}limit=${pageSize}&offset=${offset}`;

      let response: Response | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch(url, {
          headers: { "Content-Type": "application/json" },
        });
        if (response.status === 429) {
          // Rate limited — wait and retry
          const retryAfter = parseInt(response.headers.get("retry-after") ?? "2", 10);
          await new Promise((r) => setTimeout(r, retryAfter * 1000));
          continue;
        }
        break;
      }

      if (!response || !response.ok) return count;
      const data = (await response.json()) as { signals?: unknown[] };
      const page = data.signals?.length ?? 0;
      count += page;
      if (page < pageSize) break;
      offset += pageSize;
    }
    return count;
  } catch {
    return count;
  }
}

// ---- Signal Counts (from API) ----

interface DayCounts {
  total: number;
  approved: number;
  rejected: number;
  briefIncluded: number;
  replaced: number;
}

async function getSignalCounts(date: string): Promise<DayCounts> {
  // Fetch each status sequentially to avoid API rate limiting
  const approved = await apiGetCount(`/signals?status=approved&date=${date}`);
  const rejected = await apiGetCount(`/signals?status=rejected&date=${date}`);
  const briefIncluded = await apiGetCount(`/signals?status=brief_included&date=${date}`);
  const replaced = await apiGetCount(`/signals?status=replaced&date=${date}`);
  // Derive total from known statuses (pending signals are excluded — they haven't been reviewed)
  const total = approved + rejected + briefIncluded + replaced;
  return { total, approved, rejected, briefIncluded, replaced };
}

// ---- Brief Counts (from files) ----

function getBriefCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  if (!existsSync(BRIEFS_DIR)) return counts;

  for (const file of readdirSync(BRIEFS_DIR)) {
    const amendedMatch = file.match(/^amended-(\d{4}-\d{2}-\d{2})\.html$/);
    const briefMatch = file.match(/^brief-(\d{4}-\d{2}-\d{2})\.txt$/);
    const date = amendedMatch?.[1] ?? briefMatch?.[1];
    if (!date) continue;

    const content = readFileSync(resolve(BRIEFS_DIR, file), "utf-8");
    const signalCount = (content.match(/^▸ /gm) ?? []).length;
    if (signalCount > 0) counts.set(date, signalCount);
  }

  return counts;
}

// ---- Amended Brief Detection ----

function getAmendedDates(): Set<string> {
  const amended = new Set<string>();
  if (!existsSync(BRIEFS_DIR)) return amended;
  for (const file of readdirSync(BRIEFS_DIR)) {
    const match = file.match(/^amended-(\d{4}-\d{2}-\d{2})\.html$/);
    if (match) amended.add(match[1]);
  }
  return amended;
}

// ---- Inscription Status (from API + task DB fallback) ----

async function getInscriptionStatuses(dates: string[]): Promise<Map<string, boolean>> {
  const status = new Map<string, boolean>();

  // 1. Check API first
  await Promise.all(dates.map(async (date) => {
    try {
      const response = await fetch(`${API_BASE}/brief/${date}`, {
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) return;
      const data = (await response.json()) as { inscription?: { inscriptionId?: string | null } | null };
      if (data.inscription?.inscriptionId) status.set(date, true);
    } catch { /* ignore */ }
  }));

  // 2. Fall back to task DB for dates without API confirmation
  try {
    const { initDatabase } = await import("../../src/db.ts");
    const db = initDatabase();
    const startDate = dates[0];
    const tasks = db.query(
      `SELECT subject, result_summary FROM tasks
       WHERE (subject LIKE '%inscri%brief%'
              OR subject LIKE '%brief%inscri%'
              OR subject LIKE '%Record%brief%inscription%'
              OR subject LIKE '%Reveal%inscription%'
              OR subject LIKE '%Reveal%brief%')
         AND created_at >= ?
         AND status = 'completed'`
    ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

    for (const t of tasks) {
      const dateMatch = t.subject.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch || status.has(dateMatch[1])) continue;
      // Skip recovery/verify tasks that aren't actual brief inscriptions
      if (t.subject.match(/recovery|recover|verify.*recovery/i)) continue;
      const s = t.result_summary ?? "";
      // Match confirmed inscriptions: must have inscription ID (64-char hex + i0) or explicit recorded/revealed
      if (s.match(/recorded.*aibtc|[Rr]eveal(?:ed| succeeded)|[a-f0-9]{64}i0/)) {
        status.set(dateMatch[1], true);
      }
    }
  } catch { /* DB unavailable, rely on API only */ }

  return status;
}

// ---- Payout Status ----

interface PayoutInfo {
  status: string;
  transfers: number;
  sats: number;
  curated: boolean;
}

function getPayoutStatus(date: string): PayoutInfo | null {
  const path = resolve(PAYOUTS_DIR, `${date}.json`);
  if (!existsSync(path)) return null;

  try {
    const record = JSON.parse(readFileSync(path, "utf-8"));
    const sent = (record.transfers ?? []).filter((t: { status: string }) => t.status === "sent");
    return {
      status: record.status ?? "unknown",
      transfers: sent.length,
      sats: sent.reduce((s: number, t: { amount_sats: number }) => s + t.amount_sats, 0),
      curated: !!record.curation_note,
    };
  } catch {
    return null;
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const numDays = parseInt(flags.days ?? "7", 10);

  const briefCounts = getBriefCounts();
  const amendedDates = getAmendedDates();

  // Build date range
  const dates: string[] = [];
  for (let i = numDays; i >= 0; i--) {
    dates.push(daysAgo(i));
  }

  // Fetch API data sequentially per date to avoid rate limiting
  // (each date fires 5 status queries; parallel dates would overwhelm the API)
  const signalData: Array<{ date: string; counts: DayCounts }> = [];
  for (const date of dates) {
    const counts = await getSignalCounts(date);
    signalData.push({ date, counts });
  }
  const inscriptionStatus = await getInscriptionStatuses(dates);

  // Header
  console.log("| Date | Filed | Approved | Rejected | Replaced | Roster | In Brief | Inscribed | Payout |");
  console.log("|------|-------|----------|----------|----------|--------|----------|-----------|--------|");

  for (const { date, counts } of signalData) {
    const brief = briefCounts.get(date);
    const inscribed = inscriptionStatus.get(date) ?? false;
    const payout = getPayoutStatus(date);

    // Skip days with zero activity
    if (counts.total === 0 && !brief && !inscribed && !payout) continue;

    // Roster = currently approved (not yet compiled into brief)
    const rosterStr = counts.approved > 0 ? String(counts.approved) : "—";

    // In Brief = file-based count (source of truth), or API brief_included count as fallback
    let briefStr: string;
    if (brief !== undefined) {
      briefStr = String(brief);
    } else if (counts.briefIncluded > 0) {
      briefStr = String(counts.briefIncluded);
    } else {
      briefStr = "—";
    }
    if (amendedDates.has(date)) briefStr += " *amended*";

    const inscribedStr = inscribed ? "Yes" : "No";

    let payoutStr = "No";
    if (payout) {
      payoutStr = `${payout.status} (${payout.transfers} transfers, ${payout.sats.toLocaleString()} sats)`;
      if (payout.curated) payoutStr += " *curated*";
    }

    const replacedStr = counts.replaced > 0 ? String(counts.replaced) : "—";

    const shortDate = date.slice(5); // MM-DD
    console.log(`| ${shortDate} | ${counts.total} | ${counts.approved} | ${counts.rejected} | ${replacedStr} | ${rosterStr} | ${briefStr} | ${inscribedStr} | ${payoutStr} |`);
  }
}

main().catch(console.error);
