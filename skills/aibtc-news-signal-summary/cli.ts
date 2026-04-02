#!/usr/bin/env bun
// skills/aibtc-news-signal-summary/cli.ts
// Outputs a daily signal activity summary table for aibtc.news.

import { initDatabase } from "../../src/db.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const PAYOUTS_DIR = resolve(ROOT, "db/payouts");
const BRIEFS_DIR = resolve(ROOT, "db/briefs");

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

function todayPST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ---- Review Counts ----

interface DayCounts {
  reviewed: number;
  approved: number;
  rejected: number;
}

function parseReviewSummary(s: string): DayCounts {
  let approved = 0, rejected = 0, reviewed = 0;

  const revMatch = s.match(/[Rr]eviewed (\d+) signal/);
  if (revMatch) reviewed = parseInt(revMatch[1]);

  const revAppr = s.match(/[Rr]eviewed and approved (\d+)/);

  const na = s.match(/(\d+) approved/i);
  if (na) approved = parseInt(na[1]);

  const anm = s.match(/[Aa]pproved (\d+)\/(\d+)/);
  if (anm) { approved = parseInt(anm[1]); reviewed = parseInt(anm[2]); }

  const ans = s.match(/[Aa]pproved (\d+) signal/);
  if (ans && !na) approved = parseInt(ans[1]);

  if (!na && !ans && !anm && s.match(/[Aa]pproved (signal )?[a-f0-9]{7,}/i)) approved = 1;

  if (revAppr) { approved = parseInt(revAppr[1]); reviewed = parseInt(revAppr[1]); }

  const nr = s.match(/(\d+) rejected/i);
  if (nr) rejected = parseInt(nr[1]);
  if (!nr && s.match(/rejected both/i)) rejected = 2;
  const ra = s.match(/rejected all (\d+)/i);
  if (ra) rejected = parseInt(ra[1]);

  if (reviewed > 0 && approved === 0 && rejected === 0) {
    if (s.match(/[Rr]ejected/)) rejected = reviewed;
    else if (s.match(/[Aa]pproved/) && !s.match(/[Rr]ejected/)) approved = reviewed;
  }

  if (reviewed === 0) reviewed = approved + rejected;
  if (s.match(/returned 404/)) { reviewed = 1; rejected = 1; }

  return { reviewed, approved, rejected };
}

function getReviewCounts(db: ReturnType<typeof initDatabase>, startDate: string): Map<string, DayCounts> {
  const rows = db.query(
    `SELECT date(created_at) as day, result_summary FROM tasks
     WHERE subject LIKE 'Review%signal%'
       AND created_at >= ?
       AND status = 'completed'
     ORDER BY created_at`
  ).all(startDate) as Array<{ day: string; result_summary: string | null }>;

  const days = new Map<string, DayCounts>();

  for (const row of rows) {
    if (!row.result_summary) continue;
    const counts = parseReviewSummary(row.result_summary);
    const existing = days.get(row.day) ?? { reviewed: 0, approved: 0, rejected: 0 };
    existing.reviewed += counts.reviewed;
    existing.approved += counts.approved;
    existing.rejected += counts.rejected;
    days.set(row.day, existing);
  }

  return days;
}

// ---- Brief Counts ----

function getBriefCounts(db: ReturnType<typeof initDatabase>, startDate: string): Map<string, number | null> {
  const counts = new Map<string, number | null>();

  // Compile tasks: "Compile daily brief for YYYY-MM-DD" — has signal count in summary
  const compiles = db.query(
    `SELECT subject, result_summary FROM tasks
     WHERE subject LIKE 'Compile daily brief%'
       AND created_at >= ?
       AND status = 'completed'`
  ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

  for (const c of compiles) {
    const dateMatch = c.subject.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const sigMatch = c.result_summary?.match(/(\d+) signals/);
    if (sigMatch) counts.set(dateMatch[1], parseInt(sigMatch[1]));
  }

  // Fetch tasks: "Fetch compiled brief for YYYY-MM-DD" — also has signal count
  const fetches = db.query(
    `SELECT subject, result_summary FROM tasks
     WHERE subject LIKE 'Fetch compiled brief%'
       AND created_at >= ?
       AND status = 'completed'`
  ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

  for (const f of fetches) {
    const dateMatch = f.subject.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || counts.has(dateMatch[1])) continue;
    const sigMatch = f.result_summary?.match(/(\d+) signals/);
    if (sigMatch) counts.set(dateMatch[1], parseInt(sigMatch[1]));
  }

  // Inscribe tasks: signal counts in subject or result_summary
  const inscribes = db.query(
    `SELECT subject, result_summary FROM tasks
     WHERE subject LIKE 'Inscribe daily brief%'
       AND created_at >= ?
       AND status = 'completed'`
  ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

  for (const i of inscribes) {
    const dateMatch = i.subject.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch || counts.has(dateMatch[1])) continue;
    // Check subject first (e.g. "curated to 35 signals")
    const subjectSigMatch = i.subject.match(/(\d+) signals?\b/);
    if (subjectSigMatch) { counts.set(dateMatch[1], parseInt(subjectSigMatch[1])); continue; }
    // Then result_summary
    const sigMatch = i.result_summary?.match(/(\d+) signals/);
    if (sigMatch) counts.set(dateMatch[1], parseInt(sigMatch[1]));
  }

  // Daily report anomaly tasks: "brief was compiled (38 signals"
  const anomalies = db.query(
    `SELECT subject, result_summary FROM tasks
     WHERE subject LIKE 'Daily report anomaly%'
       AND created_at >= ?
       AND status = 'completed'`
  ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

  for (const a of anomalies) {
    if (!a.result_summary) continue;
    // Match "YYYY-MM-DD brief was compiled (N signals" or "compiled...N signals"
    const match = a.result_summary.match(/(\d{4}-\d{2}-\d{2}).*?compiled.*?(\d+) signals/);
    if (match && !counts.has(match[1])) {
      counts.set(match[1], parseInt(match[2]));
    }
    // Also match "brief was compiled (N signals" preceded by date in subject
    const subjectDate = a.subject.match(/(\d{4}-\d{2}-\d{2})/);
    if (subjectDate && !counts.has(subjectDate[1])) {
      const sigMatch = a.result_summary.match(/compiled \((\d+) signals/);
      if (sigMatch) counts.set(subjectDate[1], parseInt(sigMatch[1]));
    }
  }

  // Check db/briefs/ for amended and regular brief files
  // File-based counts override task-derived counts (files are source of truth)
  // Amended briefs take priority over regular briefs for the same date
  if (existsSync(BRIEFS_DIR)) {
    for (const file of readdirSync(BRIEFS_DIR)) {
      const amendedMatch = file.match(/^amended-(\d{4}-\d{2}-\d{2})\.html$/);
      const briefMatch = file.match(/^brief-(\d{4}-\d{2}-\d{2})\.txt$/);
      const date = amendedMatch?.[1] ?? briefMatch?.[1];
      if (!date) continue;

      const content = readFileSync(resolve(BRIEFS_DIR, file), "utf-8");
      const signalCount = (content.match(/^▸ /gm) ?? []).length;
      if (signalCount > 0) counts.set(date, signalCount);
    }
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

// ---- Inscription Status ----

function getInscriptionStatus(db: ReturnType<typeof initDatabase>, startDate: string): Map<string, boolean> {
  const status = new Map<string, boolean>();

  // Only count inscriptions that have a confirmed reveal or platform record.
  // A completed "Inscribe" task alone doesn't mean on-chain finalization.
  const tasks = db.query(
    `SELECT subject, result_summary FROM tasks
     WHERE (subject LIKE '%Record%brief%inscription%'
            OR subject LIKE '%Reveal%inscription%brief%'
            OR subject LIKE '%Reveal%brief%inscription%')
       AND created_at >= ?
       AND status = 'completed'`
  ).all(startDate) as Array<{ subject: string; result_summary: string | null }>;

  for (const t of tasks) {
    const dateMatch = t.subject.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;
    const s = t.result_summary ?? "";
    if (s.match(/recorded|revealed|confirm/i)) {
      status.set(dateMatch[1], true);
    }
  }

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

// ---- Live Roster Count ----

async function getLiveRosterCount(date: string): Promise<number | null> {
  try {
    const url = `https://aibtc.news/api/signals?status=approved&date=${date}&limit=200`;
    const response = await fetch(url, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { signals?: unknown[]; total?: number };
    if (typeof data.total === "number") return data.total;
    if (Array.isArray(data.signals)) return data.signals.length;
    return null;
  } catch {
    return null;
  }
}

// ---- Main ----

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const numDays = parseInt(flags.days ?? "7", 10);

  const db = initDatabase();
  const startDate = daysAgo(numDays);

  const reviewCounts = getReviewCounts(db, startDate);
  const briefCounts = getBriefCounts(db, startDate);
  const inscriptionStatus = getInscriptionStatus(db, startDate);
  const amendedDates = getAmendedDates();

  // Build date range
  const dates: string[] = [];
  for (let i = numDays; i >= 0; i--) {
    dates.push(daysAgo(i));
  }

  // For today, fetch live roster count from the API
  const today = daysAgo(0);
  const liveRoster = await getLiveRosterCount(today);

  // Header
  console.log("| Date | Reviewed | Approved | Rejected | Roster | In Brief | Inscribed | Payout |");
  console.log("|------|----------|----------|----------|--------|----------|-----------|--------|");

  for (const date of dates) {
    const review = reviewCounts.get(date) ?? { reviewed: 0, approved: 0, rejected: 0 };
    const brief = briefCounts.get(date);
    const inscribed = inscriptionStatus.get(date) ? "Yes" : "No";
    const payout = getPayoutStatus(date);

    // Skip days with zero activity
    if (review.reviewed === 0 && !brief && !inscriptionStatus.get(date) && !payout) continue;

    let briefStr = brief !== null && brief !== undefined ? String(brief) : "\u2014";
    if (amendedDates.has(date)) briefStr += " *amended*";

    // Roster: live count for today, brief count for past days
    const rosterStr = date === today && liveRoster !== null ? String(liveRoster) : "\u2014";

    let payoutStr = "No";
    if (payout) {
      payoutStr = `${payout.status} (${payout.transfers} transfers, ${payout.sats.toLocaleString()} sats)`;
      if (payout.curated) payoutStr += " *curated*";
    }

    const shortDate = date.slice(5); // MM-DD
    console.log(`| ${shortDate} | ${review.reviewed} | ${review.approved} | ${review.rejected} | ${rosterStr} | ${briefStr} | ${inscribed} | ${payoutStr} |`);
  }
}

main().catch(console.error);
