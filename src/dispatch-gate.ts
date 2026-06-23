/**
 * Dispatch gate — on/off switch with auto-recovery for rate_limited stops.
 * Rate limit → immediate stop + email notification; auto-resets after quota reset time.
 * When rate_limit_event has no parseable reset, falls back to DEFAULT_RATE_LIMIT_BACKOFF_MS.
 * 3 consecutive other failures → stop, manual `arc dispatch reset` required.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { log } from "./utils.ts";
import { getCredential } from "./credentials.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const DISPATCH_GATE_FILE = join(ROOT, "db", "hook-state", "dispatch-gate.json");
const GATE_FAILURE_THRESHOLD = 3;
// Fallback backoff when rate_limit_event carries no parseable reset timestamp.
// Configurable via ARC_RATE_LIMIT_BACKOFF_MS; default 60 minutes.
const DEFAULT_RATE_LIMIT_BACKOFF_MS = parseInt(
  process.env.ARC_RATE_LIMIT_BACKOFF_MS ?? String(60 * 60 * 1000),
  10,
);

export type ErrorClass = "auth" | "rate_limited" | "subprocess_timeout" | "transient" | "unknown";

interface DispatchGateState {
  status: "running" | "stopped";
  consecutive_failures: number;
  stopped_at: string | null;
  stopped_until: string | null;  // ISO timestamp; when reached, auto-reset for rate_limited stops
  stop_reason: string | null;
  last_error_class: ErrorClass | null;
  last_updated: string;
}

function readGateState(): DispatchGateState {
  try {
    const data = readFileSync(DISPATCH_GATE_FILE, "utf-8");
    const parsed = JSON.parse(data) as DispatchGateState;
    // Backfill stopped_until for state files written before this field existed
    if (!("stopped_until" in parsed)) parsed.stopped_until = null;
    return parsed;
  } catch {
    return {
      status: "running",
      consecutive_failures: 0,
      stopped_at: null,
      stopped_until: null,
      stop_reason: null,
      last_error_class: null,
      last_updated: new Date().toISOString(),
    };
  }
}

function writeGateState(state: DispatchGateState): void {
  state.last_updated = new Date().toISOString();
  mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
  writeFileSync(DISPATCH_GATE_FILE, JSON.stringify(state, null, 2));
}

// ── Discord auth-outage alert ─────────────────────────────────────────────────

const DISCORD_AUTH_ALERT_FILE = join(ROOT, "db", "hook-state", "oauth-discord-alert.json");
const DISCORD_AUTH_ALERT_DEDUP_MS = 4 * 60 * 60 * 1000; // 4h dedup window
const DISCORD_CHANNEL_ID_DEFAULT = "1472999795361841193";

/** Load Discord bot token from ARC_DISCORD_TOKEN env or credentials store. */
async function loadDiscordToken(): Promise<string | null> {
  if (process.env.ARC_DISCORD_TOKEN) return process.env.ARC_DISCORD_TOKEN;
  try {
    return await getCredential("discord", "bot_token");
  } catch {
    return null;
  }
}

/**
 * Send a deduped Discord alert when dispatch stops due to auth/OAuth failure.
 * Carries the literal /login or setup-token remediation.
 * M0-P0a: exactly ONE deduped alert per 4h — not a flood.
 * Fire-and-forget — must not block the gate path.
 */
function sendDiscordAuthAlert(stoppedAt: string): void {
  // Dedup check: skip if alerted within 4h
  try {
    if (existsSync(DISCORD_AUTH_ALERT_FILE)) {
      const state = JSON.parse(readFileSync(DISCORD_AUTH_ALERT_FILE, "utf-8")) as { alerted_at: string };
      const age = Date.now() - new Date(state.alerted_at).getTime();
      if (age < DISCORD_AUTH_ALERT_DEDUP_MS) {
        log(`dispatch: Discord auth alert suppressed — sent ${Math.round(age / 60000)}min ago (4h dedup)`);
        return;
      }
    }
  } catch { /* ignore read errors */ }

  // Fire-and-forget background send; dedup written only on success to avoid missed-alert window
  void (async () => {
    try {
      const token = await loadDiscordToken();
      if (!token) {
        log("dispatch: Discord auth alert skipped — no bot token available");
        return;
      }
      const msg = [
        "**Arc dispatch STOPPED — OAuth/auth failure**",
        `Stopped at: ${stoppedAt}`,
        `Host: ${hostname()}`,
        "",
        "**Operator action required (dispatch will NOT auto-recover):**",
        "SSH to Arc VM and run interactively:",
        "```",
        "  /login",
        "  # or: arc credentials setup-token",
        "```",
        "After fixing the token: `arc dispatch reset`",
      ].join("\n");
      const resp = await fetch(
        `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID_DEFAULT}/messages`,
        {
          method: "POST",
          headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content: msg }),
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as { id?: string };
        log(`dispatch: Discord auth alert sent (message_id=${data.id ?? "?"})`);
        // Write dedup only after successful send — avoids missed-alert window if token fetch fails
        try {
          mkdirSync(join(ROOT, "db", "hook-state"), { recursive: true });
          writeFileSync(DISCORD_AUTH_ALERT_FILE, JSON.stringify({ alerted_at: new Date().toISOString() }));
        } catch { /* non-fatal */ }
      } else {
        log(`dispatch: Discord auth alert failed: HTTP ${resp.status}`);
      }
    } catch (e) {
      log(`dispatch: Discord auth alert error: ${e}`);
    }
  })().catch((e: unknown) => log(`dispatch: Discord auth alert unhandled: ${e}`));
}

/**
 * Send email notification to whoabuddy that dispatch has stopped.
 * Uses arc CLI (fire-and-forget, non-blocking).
 */
function notifyDispatchStopped(reason: string, errorClass: ErrorClass | null, stoppedUntil?: string | null): void {
  const autoRecovery = errorClass === "rate_limited" && stoppedUntil;
  const subject = errorClass === "rate_limited"
    ? `[Arc] Dispatch stopped — rate/plan limit hit`
    : `[Arc] Dispatch stopped — ${GATE_FAILURE_THRESHOLD} consecutive failures`;
  const recoveryLine = autoRecovery
    ? `Auto-recovery scheduled at: ${stoppedUntil}`
    : `Auto-recovery: NOT scheduled — manual restart required.`;
  const body = [
    autoRecovery
      ? `Arc dispatch has stopped and will auto-recover at ${stoppedUntil}.`
      : `Arc dispatch has stopped and will not auto-recover.`,
    ``,
    `Reason: ${reason}`,
    `Error class: ${errorClass ?? "unknown"}`,
    recoveryLine,
    `Time: ${new Date().toISOString()}`,
    `Host: ${hostname()}`,
    ``,
    `To resume early, reply to this email with RESTART in the body.`,
    ``,
    `Or SSH in and run:`,
    `  bash bin/arc dispatch reset`,
  ].join("\n");

  try {
    Bun.spawn(["bash", join(ROOT, "bin/arc"), "skills", "run", "--name", "arc-email-sync", "--",
      "send", "--to", "whoabuddy@gmail.com", "--subject", subject, "--body", body,
      "--from", "arc@arc0btc.com"], { cwd: ROOT, stdout: "ignore", stderr: "ignore" });
    log(`dispatch: notification email queued to whoabuddy`);
  } catch (e) {
    log(`dispatch: failed to send notification email: ${e}`);
  }

  // M0-P0a: auth-class stops also send a Discord alert with literal /login remediation.
  // One deduped alert per 4h — suppresses the flood on outage.
  if (errorClass === "auth") {
    sendDiscordAuthAlert(new Date().toISOString());
  }
}

/**
 * Parse reset time from a stop_reason string. Two formats supported:
 * 1. ISO timestamp from rate_limit_event JSON: "rate_limit_event: resets 2026-05-27T21:00:00Z"
 * 2. Text fallback: "resets HH:MM (Timezone)" or "resets 11am (America/Denver)"
 */
function parseResetTimeUTC(stopReason: string, now: Date = new Date()): Date | null {
  // ISO timestamp from structural rate_limit_event (Layer 2)
  const isoMatch = stopReason.match(/resets\s+(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
  if (isoMatch) {
    const d = new Date(isoMatch[1]);
    return isNaN(d.getTime()) ? null : d;
  }

  // Text fallback (Layer 3): "resets HH:MM (Timezone)"
  const match = stopReason.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([^)]+)\)/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3]?.toLowerCase();
  const tz = match[4].trim();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  try {
    // Get today's date string in the target timezone (YYYY-MM-DD)
    const localDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(now);

    // Get UTC offset for this timezone (e.g. "GMT-6", "GMT+5:30")
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    const offsetMatch = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);

    let offsetMinutes = 0;
    if (offsetMatch) {
      const sign = offsetMatch[1] === "+" ? 1 : -1;
      offsetMinutes = sign * (parseInt(offsetMatch[2], 10) * 60 + (offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0));
    }

    const [year, month, day] = localDateStr.split("-").map(Number);
    // UTC time = local time - offset
    const utcTotalMinutes = hours * 60 + minutes - offsetMinutes;
    const resetUTC = new Date(Date.UTC(year, month - 1, day, 0, utcTotalMinutes, 0));
    return resetUTC;
  } catch {
    return null;
  }
}

/** Check dispatch gate. Returns true if dispatch should proceed. */
export function checkDispatchGate(): boolean {
  const state = readGateState();
  if (state.status === "running") return true;

  // Auto-reset for rate_limited stops: check stopped_until (preferred) or parse from stop_reason (legacy)
  if (state.last_error_class === "rate_limited" && state.stopped_at) {
    const now = new Date();

    // Primary path: stopped_until field (set at record time from 2026-05-29 onward)
    if (state.stopped_until) {
      if (now >= new Date(state.stopped_until)) {
        log(`dispatch: auto-reset — rate limit backoff expired (${state.stopped_until})`);
        resetDispatchGate();
        return true;
      }
      log(`dispatch: STOPPED — rate limit, auto-reset at ${state.stopped_until}`);
      return false;
    }

    // Legacy path: parse reset time from stop_reason string (state files written before stopped_until)
    if (state.stop_reason) {
      const resetTime = parseResetTimeUTC(state.stop_reason);
      if (resetTime) {
        const stoppedAt = new Date(state.stopped_at);
        while (resetTime <= stoppedAt) {
          resetTime.setUTCDate(resetTime.getUTCDate() + 1);
        }
        if (now >= resetTime) {
          log(`dispatch: auto-reset — rate limit quota reset time passed (${resetTime.toISOString()})`);
          resetDispatchGate();
          return true;
        }
        log(`dispatch: STOPPED — rate limit, quota resets at ${resetTime.toISOString()}. Auto-reset pending.`);
        return false;
      }
    }
  }

  log(`dispatch: STOPPED — not dispatching (since ${state.stopped_at}, reason: ${state.stop_reason?.slice(0, 100)}). Run 'arc dispatch reset' to resume.`);
  return false;
}

export function recordGateSuccess(): void {
  const state = readGateState();
  if (state.status === "running" && state.consecutive_failures === 0) return;
  state.consecutive_failures = 0;
  state.status = "running";
  state.stopped_at = null;
  state.stopped_until = null;
  state.stop_reason = null;
  state.last_error_class = null;
  writeGateState(state);
}

export function recordGateFailure(errMsg: string, errClass: ErrorClass): void {
  const state = readGateState();
  state.consecutive_failures += 1;
  state.last_error_class = errClass;

  // Rate limit or plan suspension → immediate stop (no threshold)
  if (errClass === "rate_limited") {
    const now = new Date();
    state.status = "stopped";
    state.stopped_at = now.toISOString();
    state.stop_reason = errMsg.slice(0, 500);

    // Compute stopped_until: use parseable reset time if available, else default backoff
    const parsedReset = parseResetTimeUTC(errMsg, now);
    if (parsedReset) {
      // Advance to the first reset time that falls after now (same logic as check path)
      while (parsedReset <= now) {
        parsedReset.setUTCDate(parsedReset.getUTCDate() + 1);
      }
      state.stopped_until = parsedReset.toISOString();
    } else {
      state.stopped_until = new Date(now.getTime() + DEFAULT_RATE_LIMIT_BACKOFF_MS).toISOString();
      log(`dispatch: rate_limit_event has no parseable reset — defaulting to ${DEFAULT_RATE_LIMIT_BACKOFF_MS / 60000}min backoff (${state.stopped_until})`);
    }

    writeGateState(state);
    log(`dispatch: STOPPED — rate/plan limit hit. Auto-reset at ${state.stopped_until}.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass, state.stopped_until);
    return;
  }

  // Other errors: stop after consecutive threshold
  if (state.consecutive_failures >= GATE_FAILURE_THRESHOLD) {
    state.status = "stopped";
    state.stopped_at = new Date().toISOString();
    state.stop_reason = errMsg.slice(0, 500);
    writeGateState(state);
    log(`dispatch: STOPPED after ${state.consecutive_failures} consecutive failures (${errClass}). Manual restart required.`);
    notifyDispatchStopped(errMsg.slice(0, 300), errClass);
    return;
  }

  writeGateState(state);
}

/** Check if the dispatch gate is currently stopped. */
export function isGateStopped(): boolean {
  return readGateState().status === "stopped";
}

/** Reset the dispatch gate to "running". Called by `arc dispatch reset`. */
export function resetDispatchGate(): void {
  const state = readGateState();
  log(`dispatch: gate reset (was ${state.status}, ${state.consecutive_failures} failures, reason: ${state.stop_reason?.slice(0, 100)})`);
  writeGateState({
    status: "running",
    consecutive_failures: 0,
    stopped_at: null,
    stopped_until: null,
    stop_reason: null,
    last_error_class: null,
    last_updated: new Date().toISOString(),
  });
}
