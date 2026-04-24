import {
  claimSensorRun,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase, getDatabase } from "../../src/db.ts";
import { getUTCInfo } from "../../src/time.ts";

const SENSOR_NAME = "eic-payout";
const POLL_INTERVAL = 30; // check every 30 min
const TASK_SOURCE = "sensor:eic-payout";
const API_BASE = "https://aibtc.news/api";
const EIC_RATE_SATS = 400_000;
const ACTIVE_BEATS = ["aibtc-network", "bitcoin-macro", "quantum"];

const log = createSensorLogger(SENSOR_NAME);

/**
 * EIC payout sensor. Fires 09:00-14:00 UTC for yesterday's inscribed brief.
 * Queues one deterministic script task (no LLM) to send 400K sBTC.
 *
 * Gates:
 *  1. daily-brief-inscribe hookState shows it fired today
 *  2. editor_registry populated and consistent across all 3 active beats
 *  3. ≥1 active beat had signals in yesterday's brief
 *
 * Spot-check task state is logged but not gating.
 */
export default async function eicPayoutSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: utcDate } = getUTCInfo(now);
  if (hour < 9 || hour > 14) return "skip";

  const yesterday = new Date(now);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const briefDate = yesterday.toISOString().slice(0, 10);

  const state = await readHookState(SENSOR_NAME);
  if (state?.lastPayoutDate === briefDate) return "skip";

  // Short-circuit if the payout was already sent manually via cli.ts
  // (sensor hookState is unaware of manual invocations)
  const db = getDatabase();
  const sentRow = db.query<{ status: string }, [string]>(
    "SELECT status FROM eic_payouts WHERE date = ?"
  ).get(briefDate);
  if (sentRow?.status === "sent") {
    log(`EIC payout for ${briefDate} already marked sent — updating state and skipping`);
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { version: 0 }),
      last_ran: now.toISOString(),
      last_result: "ok:already-sent",
      version: (state?.version ?? 0) + 1,
      lastPayoutDate: briefDate,
    });
    return "skip";
  }

  // Gate 1: inscribe fired today
  const inscribeState = await readHookState("daily-brief-inscribe");
  if (!inscribeState?.last_fired_date || inscribeState.last_fired_date !== utcDate) {
    log(`daily-brief-inscribe has not fired today (${utcDate}) — skipping`);
    return "skip";
  }

  // Gate 2: registry populated + consistent
  const rows = db.query<{ beat_slug: string; btc_address: string; stx_address: string | null }, []>(
    `SELECT beat_slug, btc_address, stx_address FROM editor_registry
     WHERE beat_slug IN ('aibtc-network','bitcoin-macro','quantum')`
  ).all();

  if (rows.length === 0) {
    log("editor_registry empty for active beats — skipping");
    return "skip";
  }

  const uniqueBtc = new Set(rows.map((r) => r.btc_address));
  if (uniqueBtc.size !== 1) {
    log(`editor_registry inconsistent (${uniqueBtc.size} distinct editors) — refusing to queue payout`);
    return "error";
  }

  // Informational: spot-check status
  const spotCheckRow = db.query<{ id: number }, [string]>(
    `SELECT id FROM tasks WHERE source LIKE 'sensor:editor-spot-check%'
       AND status = 'completed' AND created_at >= ? LIMIT 1`
  ).get(briefDate);
  log(spotCheckRow ? `Spot-check completed for ${briefDate} (task #${spotCheckRow.id})` : `No spot-check for ${briefDate} (informational only)`);

  // Gate 3: at least one beat with signals in yesterday's brief
  let beatSignalCounts: Record<string, number> = {};
  try {
    const resp = await fetchWithRetry(`${API_BASE}/signals?status=brief_included&date=${briefDate}&limit=200`);
    if (resp.ok) {
      const data = (await resp.json()) as { signals?: Array<{ beat: string; beatSlug?: string }> };
      for (const s of data.signals ?? []) {
        const slug = s.beatSlug ?? s.beat.toLowerCase();
        beatSignalCounts[slug] = (beatSignalCounts[slug] ?? 0) + 1;
      }
    }
  } catch (err) {
    log(`signals fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  const beatsWithSignals = ACTIVE_BEATS.filter((b) => (beatSignalCounts[b] ?? 0) > 0);
  if (beatsWithSignals.length === 0) {
    log(`No active beats had signals in brief ${briefDate} — nothing to pay`);
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { version: 0 }),
      last_ran: now.toISOString(),
      last_result: "ok:no-signals",
      version: (state?.version ?? 0) + 1,
      lastPayoutDate: briefDate,
    });
    return "ok";
  }

  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastPayoutDate: briefDate,
  });

  const id = insertTaskIfNew(`${TASK_SOURCE}:${briefDate}`, {
    subject: `Pay EIC ${EIC_RATE_SATS.toLocaleString()} sats for ${briefDate} brief (${beatsWithSignals.length} beat(s) with signals)`,
    priority: 5,
    skills: JSON.stringify(["eic-payout", "bitcoin-wallet"]),
    script: `arc skills run --name eic-payout -- execute --date ${briefDate}`,
  });

  if (id !== null) log(`EIC payout task created: #${id} (date=${briefDate}, beats=${beatsWithSignals.join(",")})`);
  return id !== null ? "ok" : "skip";
}
