#!/usr/bin/env bun
/**
 * monitor-post-lane.ts
 * P4 monitor: Daily post-lane integrity check + anomaly detection.
 *
 * Runs once per UTC day (cron: 0 1 * * * on arc-starter VM).
 * Also runs on-demand for verification.
 *
 * Checks:
 * - Duplicate provider_post_id in post lane (kill switch + alert)
 * - Root cap: today's roots <= root_daily_cap
 * - Budget mismatch: reserved_count vs actual queued/sending/sent count
 * - Expired leases → mark unknown + alert
 * - Stuck deferred actions (defer_count >= max without 'skipped') → alert
 * - Unknown post-lane actions older than 24h → operator attention notice
 *
 * On anomaly: sets outbound_enabled='false', sends Discord alert.
 * On clean: sends Discord informational notice.
 *
 * Discord format:
 *   "Arc post lane: healthy|ANOMALY at <UTC>. roots=N/3 conts=N deferred=N."
 *
 * Schedule: 0 1 * * * on arc-starter VM
 * Log: /home/dev/arc-starter/db/logs/monitor-post-lane.log
 *
 * Usage:
 *   ARC_DB_PATH=/home/dev/arc-starter/db/arc.sqlite bun monitor-post-lane.ts
 */

import { Database } from "bun:sqlite";
import * as fs from "fs";
import * as path from "path";
import { getCredential } from "../../src/credentials";

const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const LOG_DIR = "/home/dev/arc-starter/db/logs";
const DISCORD_CHANNEL_DEFAULT = "1472999795361841193"; // #arc
const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const TODAY = NOW_ISO.slice(0, 10);

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  console.log(`[${NOW_ISO}] [monitor-post-lane] ${msg}`);
}

function getConfigValue(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM agent_config WHERE key=?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

function getConfigInt(db: Database, key: string, fallback: number): number {
  const v = getConfigValue(db, key);
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return isNaN(n) ? fallback : n;
}

async function sendDiscord(message: string, isAlert: boolean = false): Promise<string | null> {
  try {
    const token = process.env.ARC_DISCORD_TOKEN ?? await getCredential("discord", "bot_token");
    const channelId = process.env.ARC_DISCORD_CHANNEL ?? DISCORD_CHANNEL_DEFAULT;
    if (!token) {
      log("Discord: no token available — skipping notification");
      return null;
    }

    const prefix = isAlert ? "**Arc post lane ALERT**" : "**Arc post lane notice**";
    const body = `${prefix} — ${message}`;

    const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: body }),
    });

    if (!response.ok) {
      log(`Discord send failed: ${response.status}`);
      return null;
    }

    const data = await response.json() as { id?: string };
    log(`Discord ${isAlert ? "ALERT" : "notice"} sent: message_id=${data.id ?? "?"}`);
    return data.id ?? null;
  } catch (err) {
    log(`Discord error: ${err}`);
    return null;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  log("Post-lane monitor starting...");

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  const anomalies: string[] = [];
  const notices: string[] = [];

  // ── Read config ────────────────────────────────────────────────────────────
  const rootDailyCap = getConfigInt(db, "root_daily_cap", 3);
  const maxCont = getConfigInt(db, "max_continuations", 2);
  const maxDefer = getConfigInt(db, "max_defer_count", 3);

  // ── Check: Kill-switch state ───────────────────────────────────────────────
  const enabled = getConfigValue(db, "outbound_enabled");
  log(`Kill switch: outbound_enabled=${enabled}`);
  if (enabled !== "true") {
    notices.push(`kill switch off: outbound_enabled=${enabled}`);
  }

  // ── Check: Duplicate provider_post_id in post lane ────────────────────────
  const dupProviders = db.query(
    `SELECT provider_post_id, COUNT(*) as cnt FROM outbound_action
     WHERE lane='post' AND provider_post_id IS NOT NULL
     GROUP BY provider_post_id HAVING COUNT(*) > 1`
  ).all() as { provider_post_id: string; cnt: number }[];

  if (dupProviders.length > 0) {
    const detail = dupProviders.map(d => `${d.provider_post_id} (×${d.cnt})`).join(", ");
    anomalies.push(`DUPLICATE_PROVIDER_ID: ${detail}`);
    log(`ANOMALY: duplicate provider IDs in post lane: ${detail}`);

    // Kill switch on duplicate detection
    db.run("UPDATE agent_config SET value='false', updated_at=? WHERE key='outbound_enabled'", [NOW_ISO]);
    log("KILL SWITCH: set outbound_enabled=false due to duplicate provider ID");
  }

  // ── Check: Root cap today ──────────────────────────────────────────────────
  const rootCount = db.query(
    `SELECT COUNT(*) as cnt FROM outbound_action
     WHERE lane='post' AND is_root=1 AND budget_day=?
       AND status IN ('queued','sending','sent')`
  ).get(TODAY) as { cnt: number };

  log(`Root posts today: ${rootCount.cnt}/${rootDailyCap}`);
  if (rootCount.cnt > rootDailyCap) {
    anomalies.push(`ROOT_CAP_BREACH: ${rootCount.cnt}/${rootDailyCap} today`);
  }

  // ── Check: Budget mismatch ─────────────────────────────────────────────────
  const budgetRow = db.query(
    "SELECT reserved_count, cap FROM budget_ledger WHERE channel='x' AND utc_day=? AND lane='post'"
  ).get(TODAY) as { reserved_count: number; cap: number } | null;

  const actualActiveCount = db.query(
    `SELECT COUNT(*) as cnt FROM outbound_action
     WHERE lane='post' AND budget_day=? AND status IN ('queued','sending','sent')`
  ).get(TODAY) as { cnt: number };

  if (budgetRow) {
    // Invariant: actual_active must never exceed reserved (cap breach).
    // reserved > actual_active is expected when legacy posts consumed budget
    // (seeded from x-budget.json) but those rows are in x_post_log, not outbound_action.
    const capBreach = actualActiveCount.cnt > budgetRow.reserved_count;
    const capExceeded = budgetRow.reserved_count > budgetRow.cap;
    if (capBreach) {
      const detail = `ledger.reserved=${budgetRow.reserved_count} < actual_active=${actualActiveCount.cnt}`;
      anomalies.push(`BUDGET_CAP_BREACH: ${detail}`);
      log(`ANOMALY: active post-lane actions exceed reserved budget: ${detail}`);
    } else if (capExceeded) {
      const detail = `ledger.reserved=${budgetRow.reserved_count} > cap=${budgetRow.cap}`;
      anomalies.push(`BUDGET_OVER_CAP: ${detail}`);
      log(`ANOMALY: reserved count exceeds cap: ${detail}`);
    } else {
      log(`Budget OK: reserved=${budgetRow.reserved_count}/${budgetRow.cap} active=${actualActiveCount.cnt}`);
    }
  } else {
    log(`No budget ledger row for post lane on ${TODAY} (no activity today — expected for new days)`);
  }

  // ── Check: Expired leases → mark unknown ──────────────────────────────────
  const expiredLeases = db.query(
    `SELECT id, source_key, lease_expires_at FROM outbound_action
     WHERE lane='post' AND status='sending'
       AND lease_expires_at IS NOT NULL
       AND lease_expires_at < datetime('now')`
  ).all() as { id: number; source_key: string; lease_expires_at: string }[];

  if (expiredLeases.length > 0) {
    for (const row of expiredLeases) {
      log(`EXPIRED LEASE: action_id=${row.id} expired=${row.lease_expires_at} → marking unknown`);
      db.run(`UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`, [NOW_ISO, row.id]);
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', ?)`,
        [row.id, `lease expired at ${row.lease_expires_at}; marked unknown by monitor`]
      );
    }
    anomalies.push(`EXPIRED_LEASES: ${expiredLeases.length} actions marked unknown`);
  }

  // ── Check: Stuck deferred actions ─────────────────────────────────────────
  const stuckDeferred = db.query(
    `SELECT id, source_key, defer_count, status FROM outbound_action
     WHERE lane='post' AND defer_count >= ? AND status != 'skipped'`
  ).all(maxDefer) as { id: number; source_key: string; defer_count: number; status: string }[];

  if (stuckDeferred.length > 0) {
    for (const row of stuckDeferred) {
      log(`STUCK DEFERRED: action_id=${row.id} defer_count=${row.defer_count} status=${row.status} → skipping`);
      db.run(`UPDATE outbound_action SET status='skipped', updated_at=? WHERE id=?`, [NOW_ISO, row.id]);
      db.run(
        `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'skipped', ?)`,
        [row.id, `monitor: max_defer_count=${maxDefer} reached; terminal skip applied`]
      );
    }
    anomalies.push(`STUCK_DEFERRED: ${stuckDeferred.length} actions given terminal skip`);
  }

  // ── Check: Unknown post-lane actions older than 24h ───────────────────────
  const staleUnknown = db.query(
    `SELECT id, source_key, created_at FROM outbound_action
     WHERE lane='post' AND status='unknown'
       AND created_at < datetime('now', '-24 hours')`
  ).all() as { id: number; source_key: string; created_at: string }[];

  if (staleUnknown.length > 0) {
    const detail = staleUnknown.map(r => `id=${r.id}`).join(", ");
    notices.push(`STALE_UNKNOWN: ${staleUnknown.length} unknown actions older than 24h require operator decision (abandon or replace): ${detail}`);
    log(`NOTICE: ${staleUnknown.length} stale unknown post-lane actions: ${detail}`);
  }

  // ── Count deferred ─────────────────────────────────────────────────────────
  const deferredCount = db.query(
    `SELECT COUNT(*) as cnt FROM outbound_action WHERE lane='post' AND status='queued' AND defer_count > 0`
  ).get() as { cnt: number };

  // ── Build report ──────────────────────────────────────────────────────────
  const isHealthy = anomalies.length === 0;
  const healthLabel = isHealthy ? "healthy" : "ANOMALY";
  const contCount = db.query(
    `SELECT COUNT(*) as cnt FROM outbound_action
     WHERE lane='post' AND is_root=0 AND budget_day=? AND status IN ('queued','sending','sent')`
  ).get(TODAY) as { cnt: number };

  const summary = `${healthLabel} at ${NOW_ISO}. roots=${rootCount.cnt}/${rootDailyCap} conts=${contCount.cnt}/${maxCont} deferred=${deferredCount.cnt} unknown_stale=${staleUnknown.length}.`;

  log(`Report: ${summary}`);
  if (anomalies.length > 0) log(`Anomalies: ${anomalies.join("; ")}`);
  if (notices.length > 0) log(`Notices: ${notices.join("; ")}`);

  // ── Write log file ─────────────────────────────────────────────────────────
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const logLine = `${NOW_ISO} ${summary}${anomalies.length > 0 ? " ANOMALIES: " + anomalies.join("; ") : ""}${notices.length > 0 ? " NOTICES: " + notices.join("; ") : ""}\n`;
    fs.appendFileSync(path.join(LOG_DIR, "monitor-post-lane.log"), logLine, "utf8");
  } catch (err) {
    log(`Log write error: ${err}`);
  }

  db.close();

  // ── Send Discord ───────────────────────────────────────────────────────────
  const discordMsg = `Arc post lane: ${summary}${anomalies.length > 0 ? " Anomalies: " + anomalies.join("; ") : ""}${notices.length > 0 ? " Notices: " + notices.slice(0, 2).join("; ") : ""}`;
  await sendDiscord(discordMsg, !isHealthy);

  if (!isHealthy) {
    log("Monitor exiting with anomaly status.");
    process.exit(1);
  }

  log("Monitor complete — post lane healthy.");
  process.exit(0);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
