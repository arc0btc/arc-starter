// health/sensor.ts
//
// Monitors agent operational health every 5 minutes.
// Detects stale dispatch cycles and stale dispatch locks.
// Creates high-priority alert tasks when anomalies are found.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger, pendingTaskExistsForSource } from "../../src/sensors.ts";
import { getRecentCycles, getPendingTasks, insertWorkflow, getWorkflowByInstanceKey, getWorkflowsByTemplate, completeWorkflow, updateWorkflowContext } from "../../src/db.ts";
import { isPidAlive } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";
import { DISPATCH_STALE_THRESHOLD_MS } from "../../src/constants.ts";

const SENSOR_NAME = "arc-service-health";
const INTERVAL_MINUTES = 5;
const TASK_SOURCE = "sensor:arc-service-health";
const STALE_LOCK_SOURCE = "sensor:arc-service-health:stale-lock";
const PRIORITY = 2;
// Suppress stale-dispatch alerts for this window after dispatch recovers from a long outage.
// Prevents flooding the queue with ~N/hour FP alert tasks when payment blocks clear.
const RECOVERY_SUPPRESSION_MS = 60 * 60 * 1000;

const log = createSensorLogger(SENSOR_NAME);

// Compute repo root: skills/arc-service-health/sensor.ts → ../../
const ROOT = new URL("../../", import.meta.url).pathname;
const DISPATCH_LOCK_FILE = join(ROOT, "db", "dispatch-lock.json");
const STATE_FILE = join(ROOT, "db", "hook-state", "arc-service-health.json");

// ── OAuth token expiry (proactive, not reactive to a 401) ──────────────────
// #23661: the 2026-07-22/24 42h outage happened because the Claude Code OAuth
// token expired mid-headless-run with zero advance warning — dispatch only ever
// found out via a 401 after the fact. This check reads the token's own expiresAt
// and fires BEFORE it lapses, so an operator can re-auth (interactive-only, Arc
// cannot do this itself) before the queue backs up again.
const OAUTH_CREDENTIALS_FILE = join(homedir(), ".claude", ".credentials.json");
const OAUTH_EXPIRY_ALERT_SOURCE = "sensor:arc-service-health:oauth-expiry";
const OAUTH_EXPIRY_ALERT_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h
const OAUTH_DISCORD_ALERT_FILE = join(ROOT, "db", "hook-state", "oauth-expiry-discord-alert.json");
const OAUTH_DISCORD_ALERT_DEDUP_MS = 4 * 60 * 60 * 1000; // 4h — one alert per expiry window
// Same channel dispatch-gate.ts's reactive auth-outage alert already posts to.
const DISCORD_CHANNEL_ID_DEFAULT = "1472999795361841193";

interface ServiceHealthState {
  wasStaleLastRun?: boolean;
  lastRecoveryAt?: string;
  lastHealthAlertWorkflowAt?: string;
}

// One retrospective per outage incident — gate new health-alert workflows within this window.
const RETRO_DEDUP_MS = 4 * 60 * 60 * 1000;

async function readHealthState(): Promise<ServiceHealthState> {
  try {
    const file = Bun.file(STATE_FILE);
    if (await file.exists()) return (await file.json()) as ServiceHealthState;
  } catch { /* ignore */ }
  return {};
}

async function writeHealthState(state: ServiceHealthState): Promise<void> {
  await Bun.write(STATE_FILE, JSON.stringify(state));
}

/** Returns true if the last dispatch cycle started longer ago than the stale threshold and pending tasks exist. */
async function checkStaleCycle(): Promise<boolean> {
  // If dispatch is currently running (lock file + live PID), it's not stale —
  // cycle_log only records completed cycles, so an in-flight cycle looks old.
  const lockFile = Bun.file(DISPATCH_LOCK_FILE);
  if (await lockFile.exists()) {
    try {
      const lock = (await lockFile.json()) as { pid: number };
      if (isPidAlive(lock.pid)) return false;
    } catch { /* stale/corrupt lock — fall through to cycle_log check */ }
  }

  const cycles = getRecentCycles(1);
  if (cycles.length === 0) return false;

  const last = cycles[0];
  const lastStartedAt = new Date(last.started_at.replace(" ", "T") + "Z");
  const ageMs = Date.now() - lastStartedAt.getTime();

  if (ageMs <= DISPATCH_STALE_THRESHOLD_MS) return false;

  // Only alert if there are pending tasks waiting to be processed
  const pending = getPendingTasks();
  return pending.length > 0;
}

/** Returns true if a dispatch lock file exists but the recorded PID is no longer alive. */
async function checkStaleLock(): Promise<boolean> {
  const file = Bun.file(DISPATCH_LOCK_FILE);
  if (!(await file.exists())) return false;

  try {
    const lock = (await file.json()) as { pid: number };
    return !isPidAlive(lock.pid);
  } catch {
    return true;
  }
}

/** Returns the OAuth token's expiresAt (epoch ms), or null if the credentials file is missing/unparseable. */
function readOAuthExpiresAt(): number | null {
  try {
    const raw = readFileSync(OAUTH_CREDENTIALS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { claudeAiOauth?: { expiresAt?: number } };
    const expiresAt = parsed.claudeAiOauth?.expiresAt;
    return typeof expiresAt === "number" ? expiresAt : null;
  } catch {
    return null;
  }
}

/**
 * Send a deduped Discord alert when the OAuth token is close to expiry.
 * Fire-and-forget — must not block the sensor loop. Mirrors dispatch-gate.ts's
 * sendDiscordAuthAlert (reactive) but fires proactively, before the 401 happens.
 */
function sendOAuthExpiryDiscordAlert(expiresAt: number, msRemaining: number): void {
  try {
    if (existsSync(OAUTH_DISCORD_ALERT_FILE)) {
      const state = JSON.parse(readFileSync(OAUTH_DISCORD_ALERT_FILE, "utf-8")) as { alerted_at: string; expires_at?: number };
      const age = Date.now() - new Date(state.alerted_at).getTime();
      // Re-alert if a NEW token expiry has been observed (operator already re-authed once
      // but the fresh token is also about to lapse) even inside the dedup window.
      if (age < OAUTH_DISCORD_ALERT_DEDUP_MS && state.expires_at === expiresAt) {
        log(`OAuth expiry Discord alert suppressed — sent ${Math.round(age / 60000)}min ago (4h dedup, same token)`);
        return;
      }
    }
  } catch { /* ignore read errors */ }

  void (async () => {
    try {
      const token = process.env.ARC_DISCORD_TOKEN ?? (await getCredential("discord", "bot_token").catch(() => null));
      if (!token) {
        log("OAuth expiry Discord alert skipped — no bot token available");
        return;
      }
      const minutesRemaining = Math.max(0, Math.round(msRemaining / 60000));
      const message = [
        "**Arc dispatch — Claude Code OAuth token expiring soon**",
        `Expires at: ${new Date(expiresAt).toISOString()} (~${minutesRemaining}min remaining)`,
        `Host: ${hostname()}`,
        "",
        "**Operator action required before expiry (dispatch cannot re-auth itself):**",
        "SSH to Arc VM and run interactively:",
        "```",
        "  claude /login",
        "  # or: arc credentials setup-token",
        "```",
        "If the token lapses before this is done, dispatch will self-halt on the next 401",
        "and the queue will back up until someone re-auths (see #23624/#23643).",
      ].join("\n");
      const resp = await fetch(
        `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID_DEFAULT}/messages`,
        {
          method: "POST",
          headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: message }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as { id?: string };
        log(`OAuth expiry Discord alert sent (message_id=${data.id ?? "?"})`);
        try {
          writeFileSync(OAUTH_DISCORD_ALERT_FILE, JSON.stringify({ alerted_at: new Date().toISOString(), expires_at: expiresAt }));
        } catch { /* non-fatal */ }
      } else {
        log(`OAuth expiry Discord alert failed: HTTP ${resp.status}`);
      }
    } catch (e) {
      log(`OAuth expiry Discord alert error: ${e}`);
    }
  })().catch((e: unknown) => log(`OAuth expiry Discord alert unhandled: ${e}`));
}

/**
 * Notify (Discord, best-effort, fire-and-forget) that a health-alert workflow auto-resolved.
 * Exists because the 2026-07-22/24 42h OAuth outage (#23624) produced 9 correct dispatch-stale
 * alerts that were auto-completed here with only a log() line — invisible without journalctl.
 */
function sendResolutionDiscordAlert(alertType: string, triggeredAt: string, resolvedAt: string, durationMs: number): void {
  void (async () => {
    try {
      const token = process.env.ARC_DISCORD_TOKEN ?? (await getCredential("discord", "bot_token").catch(() => null));
      if (!token) {
        log(`resolution Discord alert skipped (${alertType}) — no bot token available`);
        return;
      }
      const durationMin = Math.round(durationMs / 60000);
      const message = [
        `**Arc health alert resolved — ${alertType}**`,
        `Triggered: ${triggeredAt}`,
        `Resolved: ${resolvedAt} (~${durationMin}min later)`,
        `Host: ${hostname()}`,
      ].join("\n");
      const resp = await fetch(
        `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID_DEFAULT}/messages`,
        {
          method: "POST",
          headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: message }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (resp.ok) {
        log(`resolution Discord alert sent (${alertType})`);
      } else {
        log(`resolution Discord alert failed (${alertType}): HTTP ${resp.status}`);
      }
    } catch (e) {
      log(`resolution Discord alert error (${alertType}): ${e}`);
    }
  })();
}

/** Auto-complete any triggered health-alert workflows for a given alertType when the condition is no longer active. */
function clearResolvedAlerts(alertType: string): void {
  const workflows = getWorkflowsByTemplate("health-alert");
  for (const wf of workflows) {
    if (wf.completed_at !== null) continue;
    if (wf.current_state !== "triggered") continue;
    try {
      const ctx = JSON.parse(wf.context ?? "{}") as { alertType?: string };
      if (ctx.alertType === alertType) {
        const resolvedAt = new Date().toISOString();
        const durationMs = Date.now() - new Date(wf.created_at).getTime();
        // Record a durable resolution summary on the workflow before completing it, so the
        // outage is visible from `getAllWorkflows()`/`getWorkflowsByTemplate` history alone —
        // not just journalctl. See #23624/#23643/#23718.
        updateWorkflowContext(wf.id, { resolvedAt, triggeredAt: wf.created_at, durationMs });
        completeWorkflow(wf.id);
        log(`auto-completed resolved ${alertType} workflow id=${wf.id} (triggered=${wf.created_at}, duration=${Math.round(durationMs / 60000)}min)`);
        sendResolutionDiscordAlert(alertType, wf.created_at, resolvedAt, durationMs);
      }
    } catch {
      // skip unparseable context
    }
  }
}

export default async function healthSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const state = await readHealthState();
  const staleCycle = await checkStaleCycle();

  // Detect recovery: dispatch was stale last run but is healthy now
  if (state.wasStaleLastRun && !staleCycle) {
    state.lastRecoveryAt = new Date().toISOString();
    log(`dispatch recovered from stale — recording recovery at ${state.lastRecoveryAt}`);
    clearResolvedAlerts("dispatch-stale");
  }

  // Check if we're within the post-recovery suppression window
  const inSuppressionWindow =
    state.lastRecoveryAt !== undefined &&
    Date.now() - new Date(state.lastRecoveryAt).getTime() < RECOVERY_SUPPRESSION_MS;

  state.wasStaleLastRun = staleCycle;
  await writeHealthState(state);

  const lastWorkflowAge =
    state.lastHealthAlertWorkflowAt !== undefined
      ? Date.now() - new Date(state.lastHealthAlertWorkflowAt).getTime()
      : Infinity;
  const inRetroDedupWindow = lastWorkflowAge < RETRO_DEDUP_MS;

  if (staleCycle && inSuppressionWindow) {
    log(`dispatch-stale alert suppressed — within ${RECOVERY_SUPPRESSION_MS / 60000}min recovery window (since ${state.lastRecoveryAt})`);
  } else if (staleCycle && inRetroDedupWindow) {
    log(`dispatch-stale health-alert workflow skipped — retrospective dedup window active (last created ${Math.round(lastWorkflowAge / 60000)}min ago)`);
  } else if (staleCycle && !pendingTaskExistsForSource(TASK_SOURCE)) {
    const now = new Date().toISOString();
    const wfKey = `health-alert:dispatch-stale:${now.slice(0, 13)}`; // hourly dedup
    if (!getWorkflowByInstanceKey(wfKey)) {
      insertWorkflow({
        template: "health-alert",
        instance_key: wfKey,
        current_state: "triggered",
        context: JSON.stringify({
          alertType: "dispatch-stale",
          alertDate: now.slice(0, 10),
        }),
      });
      state.lastHealthAlertWorkflowAt = now;
      await writeHealthState(state);
    }
  } else if (!staleCycle && !state.wasStaleLastRun) {
    // Condition cleared and was already cleared — auto-complete any open triggered workflows
    clearResolvedAlerts("dispatch-stale");
  }

  const staleLock = await checkStaleLock();
  if (staleLock && inRetroDedupWindow) {
    log(`stale-lock health-alert workflow skipped — retrospective dedup window active (last created ${Math.round(lastWorkflowAge / 60000)}min ago)`);
  } else if (staleLock && !pendingTaskExistsForSource(STALE_LOCK_SOURCE)) {
    const now = new Date().toISOString();
    const wfKey = `health-alert:stale-lock:${now.slice(0, 13)}`;
    if (!getWorkflowByInstanceKey(wfKey)) {
      insertWorkflow({
        template: "health-alert",
        instance_key: wfKey,
        current_state: "triggered",
        context: JSON.stringify({
          alertType: "stale-lock",
          alertDate: now.slice(0, 10),
        }),
      });
      state.lastHealthAlertWorkflowAt = now;
      await writeHealthState(state);
    }
  } else if (!staleLock) {
    // Condition cleared — auto-complete any open triggered workflows for this alert type
    clearResolvedAlerts("stale-lock");
  }

  const expiresAt = readOAuthExpiresAt();
  if (expiresAt !== null) {
    const msRemaining = expiresAt - Date.now();
    const oauthExpiring = msRemaining < OAUTH_EXPIRY_ALERT_THRESHOLD_MS;

    if (oauthExpiring) {
      // Direct, immediate human-facing alert — does NOT wait on a dispatch cycle to run the
      // resulting task, since the whole point is advance warning before dispatch itself
      // loses the ability to authenticate.
      sendOAuthExpiryDiscordAlert(expiresAt, msRemaining);

      if (!pendingTaskExistsForSource(OAUTH_EXPIRY_ALERT_SOURCE)) {
        const now = new Date().toISOString();
        // Dedup key includes expiresAt so a NEW token (operator re-authed, fresh token also
        // expiring soon) still gets its own tracking task instead of being swallowed by the
        // hourly dedup window.
        const wfKey = `health-alert:oauth-expiring:${expiresAt}`;
        if (!getWorkflowByInstanceKey(wfKey)) {
          insertWorkflow({
            template: "health-alert",
            instance_key: wfKey,
            current_state: "triggered",
            context: JSON.stringify({
              alertType: "oauth-expiring",
              alertDate: now.slice(0, 10),
            }),
          });
        }
      }
    } else {
      clearResolvedAlerts("oauth-expiring");
    }
  }

  return "ok";
}
