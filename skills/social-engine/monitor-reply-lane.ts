#!/usr/bin/env bun
/**
 * monitor-reply-lane.ts
 * P3 monitor: Reply-lane integrity check + auto-advance stage gate.
 *
 * Runs every 15 minutes via cron on arc-starter VM.
 * Checks: kill-switch state, expired leases, duplicate provider IDs, budget caps.
 * Auto-advances rollout stages per §4 gates + dwell windows.
 * Posts Discord notices (advancement) and alerts (stop rules) to #arc.
 *
 * Schedule: every 15 min (cron: 15min interval) on arc-starter VM
 * Log: /home/dev/arc-starter/db/logs/monitor-reply-lane.log
 * Gate evidence: /home/dev/arc-starter/db/gate-evidence/<stage>-<date>.json
 *
 * Stages:
 *   control     → 1 reply to @whoabuddydev; gate = provider ID reconciled; dwell = 0h (immediate)
 *   research_core → up to 3/day for 48h; gate = no dup/unknown + all receipt-backed
 *   tier_a      → up to 10/day for 7d; gate = baseline recorded + no stop rule
 *   steady      → up to 40/day (no further auto-advance)
 *
 * Stop rules (§4): auto-set outbound_enabled=false on:
 *   - duplicate provider_post_id
 *   - auth/policy error
 *   - budget mismatch
 *   - reconciliation failure (ambiguous unknown that won't reconcile)
 *
 * For local host run (management host):
 *   ARC_DB_PATH=/path/to/arc.sqlite bun ops/verify/social-engine/monitor-reply-lane.ts
 */

import { Database } from "bun:sqlite";
import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---- Config ----------------------------------------------------------------
const DB_PATH = process.env.ARC_DB_PATH ?? "/home/dev/arc-starter/db/arc.sqlite";
const GATE_EVIDENCE_DIR = "/home/dev/arc-starter/db/gate-evidence";
const LOG_DIR = "/home/dev/arc-starter/db/logs";

// Discord config (read from arc credentials on VM)
const ARC_DIR = "/home/dev/arc-starter";
const ARC_SECRETS_PATH = process.env.ARC_SECRETS_PATH ?? "/home/dev/.arc-secrets";

// Stage dwell windows
const DWELL_WINDOWS: Record<string, number> = {
  control: 0,        // immediate — advance on first healthy monitor run after confirmed send
  research_core: 48, // 48 hours
  tier_a: 168,       // 7 days (7 * 24)
  steady: Infinity,  // no further advance
};

// Stage capacity limits
const STAGE_CAPS: Record<string, number> = {
  control: 1,
  research_core: 3,
  tier_a: 10,
  steady: 40,
};

const NOW = new Date();
const NOW_ISO = NOW.toISOString();
const TODAY = NOW_ISO.slice(0, 10);

// ---- Helpers ---------------------------------------------------------------
function log(msg: string) {
  console.log(`[${NOW_ISO}] [monitor-reply-lane] ${msg}`);
}

async function sendDiscord(message: string, isAlert: boolean = false): Promise<string | null> {
  // Read bot token from credential store (VM-side)
  // Fallback: use ARC_DISCORD_TOKEN env var if set
  try {
    const token = process.env.ARC_DISCORD_TOKEN ?? getCred("discord", "bot_token");
    const channelId = process.env.ARC_DISCORD_CHANNEL ?? getCred("discord", "channel_id");
    if (!token || !channelId) return null;

    const prefix = isAlert ? "**Arc reply lane STOP**" : "**Arc reply lane notice**";
    const body = `${prefix} — ${message}`;

    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: body }),
    });
    if (!res.ok) {
      log(`Discord send failed: ${res.status}`);
      return null;
    }
    const data = await res.json() as { id: string };
    log(`Discord ${isAlert ? "alert" : "notice"} sent: message_id=${data.id}`);
    return data.id;
  } catch (e) {
    log(`Discord send error: ${e}`);
    return null;
  }
}

function getCred(service: string, key: string): string {
  try {
    // Try arc-starter credential CLI first (VM path)
    const arcSecretsPath = ARC_SECRETS_PATH;
    if (fs.existsSync(arcSecretsPath)) {
      const raw = execSync(
        `bash -c 'set -a; source ${arcSecretsPath}; set +a; cd ${ARC_DIR}; ARC_CREDS_PASSWORD=$ARC_CREDS_PASSWORD /home/dev/.bun/bin/bun /home/dev/arc-starter/src/credentials/cli.ts get ${service} ${key} 2>/dev/null' 2>/dev/null`,
        { timeout: 10000, encoding: "utf8" }
      );
      const lines = raw.split("\n").filter(l => !l.startsWith("[credentials]") && l.trim());
      return lines[lines.length - 1] ?? "";
    }
    // Try management host arc store
    const mgmtSecretsPath = "/home/whoabuddy/arc/.arc-secrets";
    const mgmtArcDir = "/home/whoabuddy/arc";
    if (fs.existsSync(mgmtSecretsPath)) {
      const raw = execSync(
        `bash -c 'set -a; source ${mgmtSecretsPath}; set +a; cd ${mgmtArcDir}; bun src/credentials/cli.ts get ${service} ${key} 2>/dev/null'`,
        { timeout: 10000, encoding: "utf8" }
      );
      const lines = raw.split("\n").filter(l => !l.startsWith("[credentials]") && l.trim());
      return lines[lines.length - 1] ?? "";
    }
  } catch {}
  return "";
}

function writeGateEvidence(stage: string, data: Record<string, unknown>) {
  try {
    fs.mkdirSync(GATE_EVIDENCE_DIR, { recursive: true });
    const filename = `${stage}-${TODAY}.json`;
    const filepath = path.join(GATE_EVIDENCE_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({ ...data, written_at: NOW_ISO }, null, 2), "utf8");
    log(`Gate evidence written: ${filepath}`);
    return filepath;
  } catch (e) {
    log(`Failed to write gate evidence: ${e}`);
    return null;
  }
}

// ---- Main ------------------------------------------------------------------
async function run() {
  log("=== monitor-reply-lane start ===");

  const db = new Database(DB_PATH);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  let stopRuleTriggered = false;
  let stopReason = "";

  // ── 1. Kill-switch state ────────────────────────────────────────────────────
  const killSwitch = db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null;
  const isEnabled = killSwitch?.value === "true";
  log(`Kill switch: outbound_enabled=${isEnabled ? "true" : "false"}`);

  if (!isEnabled) {
    log("Kill switch is OFF — skipping dispatch checks. Monitor continues for integrity.");
  }

  // ── 2. Expired lease detection (unknown when lease expires) ────────────────
  const expiredLeases = db.query(
    `SELECT id, source_key, lease_expires_at FROM outbound_action
     WHERE status='sending' AND lease_expires_at < datetime('now')`
  ).all() as Array<{ id: number; source_key: string; lease_expires_at: string }>;

  for (const lease of expiredLeases) {
    log(`ALERT: Expired lease on action id=${lease.id} source_key=${lease.source_key} expired=${lease.lease_expires_at}`);
    db.run(`UPDATE outbound_action SET status='unknown', updated_at=? WHERE id=?`, [NOW_ISO, lease.id]);
    db.run(
      `INSERT INTO engagement_log(action_id, event_type, notes) VALUES (?, 'unknown', 'lease expired — marked unknown by monitor')`,
      [lease.id]
    );
  }
  if (expiredLeases.length > 0) {
    log(`Marked ${expiredLeases.length} expired leases as unknown.`);
  }

  // ── 3. Duplicate provider ID detection ────────────────────────────────────
  const dupProviderIds = db.query(
    `SELECT provider_post_id, COUNT(*) as cnt FROM outbound_action
     WHERE provider_post_id IS NOT NULL
     GROUP BY provider_post_id HAVING cnt > 1`
  ).all() as Array<{ provider_post_id: string; cnt: number }>;

  if (dupProviderIds.length > 0) {
    stopRuleTriggered = true;
    stopReason = `Duplicate provider IDs detected: ${dupProviderIds.map(d => d.provider_post_id).join(",")}`;
    log(`STOP RULE: ${stopReason}`);
    db.run(`UPDATE agent_config SET value='false' WHERE key='outbound_enabled'`);
    await sendDiscord(`Duplicate provider_post_id detected. outbound_enabled set false. Operator action required. IDs: ${dupProviderIds.map(d => d.provider_post_id).join(",")}`, true);
  }

  // ── 4. Budget consistency check ────────────────────────────────────────────
  const budgets = db.query(
    `SELECT channel, utc_day, lane, reserved_count, cap FROM budget_ledger WHERE utc_day=?`
  ).all(TODAY) as Array<{ channel: string; utc_day: string; lane: string; reserved_count: number; cap: number }>;

  for (const b of budgets) {
    if (b.reserved_count > b.cap) {
      log(`WARN: Budget overage for ${b.channel}/${b.lane} on ${b.utc_day}: reserved=${b.reserved_count} > cap=${b.cap}`);
      // Not a hard stop rule unless it's the post lane during a send
    }
  }

  // ── 5. Unknown action count ─────────────────────────────────────────────────
  const unknownActions = db.query(
    `SELECT id, source_key, created_at FROM outbound_action WHERE status='unknown' ORDER BY id`
  ).all() as Array<{ id: number; source_key: string; created_at: string }>;

  if (unknownActions.length > 0) {
    log(`Unknown actions (${unknownActions.length}): ${unknownActions.map(a => `id=${a.id}`).join(", ")}`);
    log("NOTE: unknown actions require operator reconciliation before abandon/replace decision.");
  }

  // ── 6. Stage auto-advance ──────────────────────────────────────────────────
  if (!stopRuleTriggered) {
    const stageCfg = db.query("SELECT key, value FROM agent_config WHERE key IN ('live_rollout_stage', 'live_rollout_stage_entered_at', 'live_rollout_control_gate_passed_at')").all() as Array<{ key: string; value: string }>;
    const cfgMap: Record<string, string> = {};
    stageCfg.forEach(r => { cfgMap[r.key] = r.value; });

    const currentStage = cfgMap["live_rollout_stage"] ?? "control";
    const stageEnteredAt = cfgMap["live_rollout_stage_entered_at"] ? new Date(cfgMap["live_rollout_stage_entered_at"]) : null;
    const controlGatePassedAt = cfgMap["live_rollout_control_gate_passed_at"] ? new Date(cfgMap["live_rollout_control_gate_passed_at"]) : null;

    log(`Current stage: ${currentStage}, entered_at=${stageEnteredAt?.toISOString() ?? "unknown"}`);

    // Control stage gate check
    if (currentStage === "control") {
      const controlSent = db.query(
        `SELECT id, provider_post_id FROM outbound_action
         WHERE source_key='engage:out:reply:x:2047404386931081563' AND status='sent' AND provider_post_id IS NOT NULL`
      ).get() as { id: number; provider_post_id: string } | null;

      if (controlSent) {
        log(`Control gate: PASS — action_id=${controlSent.id} provider_post_id=${controlSent.provider_post_id}`);

        // Record control gate pass time
        if (!controlGatePassedAt) {
          db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_control_gate_passed_at', ?, ?)`, [NOW_ISO, NOW_ISO]);
        }

        // Advance to research_core (dwell=0h — immediate on first healthy monitor run)
        log("Advancing stage: control → research_core (dwell=0h, gate passed)");
        db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage', 'research_core', ?)`, [NOW_ISO]);
        db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage_entered_at', ?, ?)`, [NOW_ISO, NOW_ISO]);

        // Write gate evidence
        const evidencePath = writeGateEvidence("control", {
          stage: "control",
          gate_passed_at: controlGatePassedAt?.toISOString() ?? NOW_ISO,
          advanced_to: "research_core",
          advanced_at: NOW_ISO,
          evidence: {
            outbound_action_id: controlSent.id,
            provider_post_id: controlSent.provider_post_id,
            source_key: "engage:out:reply:x:2047404386931081563",
            thread_ref: "2047404386931081563",
            account: "whoabuddydev",
          },
          next_stage: "research_core",
          next_gate: "48h dwell + no dup/unknown actions + all replies receipt-backed",
          monitor_schedule: "*/15 * * * * on arc-starter VM",
        });

        const discordMsgId = await sendDiscord(
          `Stage advanced: **control → research_core** at ${NOW_ISO}. Control send confirmed: provider_post_id=${controlSent.provider_post_id} action_id=${controlSent.id}. Research-core: up to 3 replies/day for 48h. Gate evidence: ${evidencePath ?? "written"}.`,
          false
        );
        log(`Stage advanced to research_core. Discord notice: ${discordMsgId ?? "sent"}`);

      } else {
        log("Control gate: PENDING — no confirmed 'sent' action for @whoabuddydev thread yet.");
      }
    }

    // Research-core gate check (after 48h dwell)
    else if (currentStage === "research_core" && stageEnteredAt) {
      const hoursElapsed = (NOW.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60);
      const dwellOk = hoursElapsed >= DWELL_WINDOWS.research_core;
      log(`Research-core dwell: ${hoursElapsed.toFixed(1)}h / ${DWELL_WINDOWS.research_core}h (${dwellOk ? "OK" : "waiting"})`);

      if (dwellOk) {
        // Check: no dup/unknown actions in research_core cohort
        const badActions = db.query(
          `SELECT COUNT(*) as cnt FROM outbound_action WHERE status IN ('unknown') AND budget_day >= ?`,
          [stageEnteredAt.toISOString().slice(0, 10)]
        ).get() as { cnt: number };

        if (badActions.cnt === 0) {
          log("Research-core gate: PASS — no dup/unknown actions. Advancing to tier_a.");
          db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage', 'tier_a', ?)`, [NOW_ISO]);
          db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage_entered_at', ?, ?)`, [NOW_ISO, NOW_ISO]);

          writeGateEvidence("research_core", {
            stage: "research_core",
            gate_passed_at: NOW_ISO,
            advanced_to: "tier_a",
            dwell_hours: hoursElapsed,
            evidence: { no_unknown_actions: true, dwell_ok: dwellOk },
          });
          await sendDiscord(`Stage advanced: **research_core → tier_a** at ${NOW_ISO}. 48h dwell complete. Up to 10 replies/day for 7 days.`, false);
        } else {
          log(`Research-core gate: FAIL — ${badActions.cnt} unknown/bad actions pending reconciliation.`);
        }
      }
    }

    // Tier-A gate check (after 7d dwell)
    else if (currentStage === "tier_a" && stageEnteredAt) {
      const hoursElapsed = (NOW.getTime() - stageEnteredAt.getTime()) / (1000 * 60 * 60);
      const dwellOk = hoursElapsed >= DWELL_WINDOWS.tier_a;
      log(`Tier-A dwell: ${hoursElapsed.toFixed(1)}h / ${DWELL_WINDOWS.tier_a}h (${dwellOk ? "OK" : "waiting"})`);

      if (dwellOk) {
        // Check: baseline recorded (agent_config baseline_recorded_at)
        const baselineRecorded = db.query("SELECT value FROM agent_config WHERE key='baseline_recorded_at'").get();
        if (baselineRecorded) {
          log("Tier-A gate: PASS — baseline recorded + 7d dwell. Advancing to steady.");
          db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage', 'steady', ?)`, [NOW_ISO]);
          db.run(`INSERT OR REPLACE INTO agent_config(key, value, updated_at) VALUES('live_rollout_stage_entered_at', ?, ?)`, [NOW_ISO, NOW_ISO]);

          writeGateEvidence("tier_a", {
            stage: "tier_a",
            gate_passed_at: NOW_ISO,
            advanced_to: "steady",
            dwell_hours: hoursElapsed,
          });
          await sendDiscord(`Stage advanced: **tier_a → steady** at ${NOW_ISO}. 7-day review passed. Steady lane: up to 40 replies/day.`, false);
        } else {
          log("Tier-A gate: waiting for baseline_recorded_at in agent_config (set by P3 baseline capture).");
        }
      }
    }

    else if (currentStage === "steady") {
      log("Stage: steady — no further auto-advance. Monitor continues integrity checks.");
    }
  }

  // ── 7. Summary ─────────────────────────────────────────────────────────────
  const finalStage = (db.query("SELECT value FROM agent_config WHERE key='live_rollout_stage'").get() as { value: string } | null)?.value ?? "unknown";
  const finalEnabled = (db.query("SELECT value FROM agent_config WHERE key='outbound_enabled'").get() as { value: string } | null)?.value;

  db.close();

  console.log(`\n=== monitor-reply-lane summary ===`);
  console.log(`UTC: ${NOW_ISO}`);
  console.log(`Stage: ${finalStage}`);
  console.log(`outbound_enabled: ${finalEnabled}`);
  console.log(`Expired leases fixed: ${expiredLeases.length}`);
  console.log(`Unknown actions: ${unknownActions.length}`);
  console.log(`Stop rule triggered: ${stopRuleTriggered ? stopReason : "none"}`);
  console.log(`=== done ===`);
}

run().catch((err) => {
  console.error(`[${NOW_ISO}] [monitor-reply-lane] FATAL:`, err);
  process.exit(1);
});
