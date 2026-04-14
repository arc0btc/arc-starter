import {
  claimSensorRun,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";

const SENSOR_NAME = "editor-payout";
const POLL_INTERVAL = 30; // check every 30 min
const TASK_SOURCE = "sensor:editor-payout";
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

import { getUTCInfo } from "../../src/time.ts";

const EDITOR_RATE_SATS = 175_000;

/**
 * Editor payout sensor. Fires 09:00-14:00 UTC, gated by:
 * 1. Inscription completed for today
 * 2. Editor registry populated
 * Spot-check status is logged (informational) but does not gate payout.
 */
export default async function editorPayoutSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: utcDate } = getUTCInfo(now);

  // Only fire in the 09:00-14:00 UTC window (post-inscription)
  if (hour < 9 || hour > 14) return "skip";

  // Dedup: only fire once per UTC calendar day
  const state = await readHookState(SENSOR_NAME);
  if (state?.lastPayoutDate === utcDate) return "skip";

  // Gate 1: inscription must have completed for today
  const inscribeState = await readHookState("daily-brief-inscribe");
  if (!inscribeState?.last_fired_date || inscribeState.last_fired_date !== utcDate) {
    log(`Inscription not completed for ${utcDate} — skipping`);
    return "skip";
  }

  // Informational: log spot-check status (does not gate payout)
  const db = getDatabase();
  const spotCheckDone = db.query<{ id: number }, [string]>(
    `SELECT id FROM tasks
     WHERE source LIKE 'sensor:editor-spot-check%'
       AND status = 'completed'
       AND created_at >= ?
     LIMIT 1`
  ).get(utcDate);

  if (spotCheckDone) {
    log(`Spot-check completed for ${utcDate} (task #${spotCheckDone.id})`);
  } else {
    log(`No completed spot-check for ${utcDate} — proceeding (informational only)`);
  }

  // Gate 2: editor registry must have entries
  const editors = db.query<{ beat_slug: string; editor_name: string }, []>(
    "SELECT beat_slug, editor_name FROM editor_registry"
  ).all();

  if (editors.length === 0) {
    log("Editor registry empty — run: arc skills run --name editor-payout -- registry refresh");
    return "skip";
  }

  // Check for approved signals per beat in today's brief
  let beatSignalCounts: Record<string, number> = {};
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/signals?status=brief_included&date=${utcDate}&limit=200`
    );
    if (resp.ok) {
      const data = (await resp.json()) as { signals?: Array<{ beat: string; beatSlug?: string }> };
      for (const s of data.signals ?? []) {
        const slug = s.beatSlug ?? s.beat.toLowerCase();
        beatSignalCounts[slug] = (beatSignalCounts[slug] ?? 0) + 1;
      }
    }
  } catch (err) {
    log(`Error fetching brief signals: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  const beatsWithSignals = editors.filter((e) => (beatSignalCounts[e.beat_slug] ?? 0) > 0);
  if (beatsWithSignals.length === 0) {
    log(`No beats with signals in today's brief — nothing to pay`);
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { version: 0 }),
      last_ran: now.toISOString(),
      last_result: "ok:no-signals",
      version: (state?.version ?? 0) + 1,
      lastPayoutDate: utcDate,
    });
    return "ok";
  }

  // All gates passed — create payout task (LIVE mode)
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastPayoutDate: utcDate,
  });

  const beatSummary = beatsWithSignals
    .map((e) => `${e.beat_slug}: ${beatSignalCounts[e.beat_slug]} signal(s) → ${e.editor_name} (${EDITOR_RATE_SATS.toLocaleString()} sats)`)
    .join("\n  ");
  const totalSats = beatsWithSignals.length * EDITOR_RATE_SATS;

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Pay ${beatsWithSignals.length} editor(s) for ${utcDate} brief (${totalSats.toLocaleString()} sats)`,
    description: [
      `Editor payouts for the ${utcDate} daily brief.`,
      ``,
      `## Beats with signals`,
      `  ${beatSummary}`,
      ``,
      `## Total: ${totalSats.toLocaleString()} sats across ${beatsWithSignals.length} editor(s)`,
      ``,
      `## Steps`,
      `1. Run: arc skills run --name editor-payout -- execute --date ${utcDate}`,
      `2. Verify sBTC transfers sent and record txids.`,
      `3. Close task with a summary of payments.`,
    ].join("\n"),
    priority: 5,
    skills: JSON.stringify(["editor-payout", "bitcoin-wallet"]),
  });

  if (id !== null) {
    log(`Payout task created: #${id} — ${beatsWithSignals.length} editor(s), ${totalSats} sats`);
  }

  return id !== null ? "ok" : "skip";
}
