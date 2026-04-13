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

const EDITOR_RATE_SATS = 175_000;

function getPSTInfo(now: Date): { hour: number; date: string } {
  const hour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "numeric",
      hour12: false,
    }).format(now),
    10
  );
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(now);
  return { hour, date };
}

/**
 * Editor payout sensor. Fires 1-6 AM PST, gated by:
 * 1. Inscription completed for today
 * 2. At least one spot-check task completed (or window expired)
 * 3. Editor registry populated
 */
export default async function editorPayoutSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: pstDate } = getPSTInfo(now);

  // Only fire in the 1-6 AM PST window (post-inscription)
  if (hour < 1 || hour > 6) return "skip";

  // Dedup: only fire once per PST calendar day
  const state = await readHookState(SENSOR_NAME);
  if (state?.lastPayoutDate === pstDate) return "skip";

  // Gate 1: inscription must have completed for today
  const inscribeState = await readHookState("daily-brief-inscribe");
  if (!inscribeState?.last_fired_date || inscribeState.last_fired_date !== pstDate) {
    log(`Inscription not completed for ${pstDate} — skipping`);
    return "skip";
  }

  // Gate 2: spot-check must have completed (or 6 PM window passed)
  const db = getDatabase();
  const spotCheckDone = db.query<{ id: number }, [string, string]>(
    `SELECT id FROM tasks
     WHERE source LIKE 'sensor:editor-spot-check%'
       AND status = 'completed'
       AND created_at >= ?
     LIMIT 1`
  ).get(pstDate, pstDate);

  if (!spotCheckDone) {
    // Allow payout if it's past 6 PM PST (spot-check window expired without flags)
    if (hour < 18) {
      log(`No completed spot-check for ${pstDate} and window not expired — skipping`);
      return "skip";
    }
    log(`Spot-check window expired without flags — proceeding`);
  }

  // Gate 3: editor registry must have entries
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
      `${API_BASE}/signals?status=brief_included&date=${pstDate}&limit=200`
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
      lastPayoutDate: pstDate,
    });
    return "ok";
  }

  // All gates passed — create payout task (DRY RUN mode)
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastPayoutDate: pstDate,
  });

  const beatSummary = beatsWithSignals
    .map((e) => `${e.beat_slug}: ${beatSignalCounts[e.beat_slug]} signal(s) → ${e.editor_name} (${EDITOR_RATE_SATS.toLocaleString()} sats)`)
    .join("\n  ");
  const totalSats = beatsWithSignals.length * EDITOR_RATE_SATS;

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `[DRY RUN] Pay ${beatsWithSignals.length} editor(s) for ${pstDate} brief (${totalSats.toLocaleString()} sats)`,
    description: [
      `Editor payouts for the ${pstDate} daily brief.`,
      `This is a DRY RUN — no sBTC transfers will be sent.`,
      ``,
      `## Beats with signals`,
      `  ${beatSummary}`,
      ``,
      `## Total: ${totalSats.toLocaleString()} sats across ${beatsWithSignals.length} editor(s)`,
      ``,
      `## Steps`,
      `1. Run: arc skills run --name editor-payout -- calculate --date ${pstDate}`,
      `2. Review the output: verify editor addresses, signal counts, balance.`,
      `3. Close task with a summary of the payout plan.`,
      ``,
      `## When ready for live payments`,
      `Change this task to use \`execute\` instead of \`calculate\`.`,
    ].join("\n"),
    priority: 6,
    skills: JSON.stringify(["editor-payout", "bitcoin-wallet"]),
  });

  if (id !== null) {
    log(`Payout task created: #${id} — ${beatsWithSignals.length} editor(s), ${totalSats} sats`);
  }

  return id !== null ? "ok" : "skip";
}
