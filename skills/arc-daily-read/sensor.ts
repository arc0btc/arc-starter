// skills/arc-daily-read/sensor.ts
// Time-gate sensor for Arc's Daily Read.
// Fires a dispatch task once per day at UTC 13:00 (live audience window).
// Composition happens in cli.ts; this sensor only queues the task.
// P3 of arc-demand-distribution quest.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTaskDeduped, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-daily-read";
const INTERVAL_MINUTES = 30; // check every 30 min (sensor tick rate)
const TARGET_UTC_HOUR = 13; // post at UTC 13:00

const log = createSensorLogger(SENSOR_NAME);

export default async function arcDailyReadSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initDatabase();
  const db = getDatabase();

  // Kill switch check
  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as { value: string } | null;
  if (ksRow?.value === "false") {
    log("kill switch active (outbound_enabled=false) — skipping daily read");
    return "skip";
  }

  // Time gate: only fire in the UTC 13:00 window (13:00–13:29)
  const now = new Date();
  const utcHour = now.getUTCHours();
  if (utcHour !== TARGET_UTC_HOUR) {
    return "skip";
  }

  // Already posted today?
  const todayRow = db.query(
    "SELECT COUNT(*) as n FROM daily_read_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };

  // daily_read_log may not exist yet on first run
  // (cli.ts creates it — but if sensor runs before cli.ts, handle gracefully)
  const alreadyPostedToday = todayRow?.n > 0;
  if (alreadyPostedToday) {
    log("already posted today — skipping");
    return "skip";
  }

  // Check cap: need 4 slots
  const countRow = db.query(
    "SELECT COUNT(*) as n FROM x_post_log WHERE date(posted_at) = date('now')"
  ).get() as { n: number };
  const DAILY_TWEET_CAP = 6;
  const slotsRemaining = DAILY_TWEET_CAP - countRow.n;

  if (slotsRemaining < 4) {
    log(`cap insufficient: ${slotsRemaining} slots remaining, need 4 — deferring to tomorrow`);
    return "skip";
  }

  // Dedup: don't queue if a pending task already exists for today
  const todaySource = `sensor:arc-daily-read:${now.toISOString().split("T")[0]}`;
  if (pendingTaskExistsForSource(todaySource)) {
    log(`task already queued for today (${todaySource}) — skip`);
    return "skip";
  }

  // Get next edition number
  let editionN = 1;
  try {
    const editionRow = db.query("SELECT MAX(edition_n) as max_n FROM daily_read_log").get() as { max_n: number | null };
    editionN = (editionRow.max_n ?? 0) + 1;
  } catch {
    // table may not exist yet — cli.ts will create it
    editionN = 1;
  }

  // Queue the dispatch task
  const taskId = insertTaskDeduped({
    subject: `Post Arc's Daily Read — Edition ${editionN}`,
    description: [
      `Arc's Daily Read Edition ${editionN} is due. UTC 13:00 window.`,
      ``,
      `Run: bun ~/arc-starter/skills/arc-daily-read/cli.ts post`,
      ``,
      `This will:`,
      `1. Generate the real-data chart from distilled_artifacts (NO AI art)`,
      `2. Compose the 4-tweet beat (root + reply-2 + reply-3 + CTA)`,
      `3. Check cap (need 4/${DAILY_TWEET_CAP} slots; ${slotsRemaining} available)`,
      `4. Post via existing X client (honors kill switch + dedup)`,
      `5. Fire amplification email to operator (D4 — required, non-blocking)`,
      `6. Log edition to daily_read_log`,
      ``,
      `Reach-proof carry-forward: ≥10 consecutive beats needed (cannot fit this quest window).`,
      `Target: ≥15 net followers + ≥1 external RT within 7 days of Edition 1.`,
      `Baseline: 51 followers (P2, 2026-06-27), 0 external engagement.`,
    ].join("\n"),
    skills: JSON.stringify(["arc-daily-read"]),
    priority: 2,
    source: todaySource,
  });

  if (taskId === null) {
    log("task creation skipped (duplicate subject or source)");
    return "skip";
  }

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "queued",
    version: ((await readHookState(SENSOR_NAME))?.version ?? 0) + 1,
    last_queued_date: now.toISOString().split("T")[0],
    last_task_id: taskId,
  });

  log(`queued Daily Read Edition ${editionN} task (id: ${taskId}, source: ${todaySource})`);
  return "ok";
}
