// skills/arc-daily-read/sensor.ts
// Time-gate sensor for Arc's Daily Read.
// Fires a dispatch task once per day at UTC 13:00 (live audience window).
// Composition happens in cli.ts; this sensor only queues the task.
// P3 of arc-demand-distribution quest.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTaskDeduped, pendingTaskExistsForSource } from "../../src/db.ts";
// arc-day-n-publishing P5 (dev-council/Newman, CONFIRMED — landed only as the LAST step of P5
// task 2, after backfill-metrics/check-amplification/mark-amplification were proven manually
// against the 4 live editions): piggybacks the amplification check onto this sensor's existing
// 30-min tick rather than adding a new cron entry. checkAmplification() is internally cheap on
// most ticks (it early-returns with NO API call when no edition is in the actionable window —
// see edition-metrics.ts) and is best-effort/non-blocking here: a failure must never prevent the
// sensor's real work (queuing the day's read) from proceeding.
import { checkAmplification } from "./lib/edition-metrics.ts";

const SENSOR_NAME = "arc-daily-read";
const INTERVAL_MINUTES = 30; // check every 30 min (sensor tick rate)
const TARGET_UTC_HOUR = 13; // post at UTC 13:00

const log = createSensorLogger(SENSOR_NAME);

export default async function arcDailyReadSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initDatabase();
  const db = getDatabase();

  // arc-day-n-publishing P5: attribution concern, not a posting concern — runs regardless of
  // the kill switch / 13:00 time-window checks below (those gate NEW content going out; this
  // only reads/updates amplified_status on already-shipped rows). Best-effort: swallow any
  // failure so it can never block the sensor's actual job.
  try {
    const result = await checkAmplification(db);
    if (result.checked > 0) log(`amplification check: ${result.detail}`);
  } catch (e) {
    log(`amplification check failed (non-blocking): ${(e as Error).message}`);
  }

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
    // arc-demand-gen P1: this branch used to return "skip" with NO state write, so a
    // multi-day starvation (2026-06-30..2026-07-04, root cause: content-calendar threads
    // exhausting the shared cap near UTC midnight, see
    // docs/specs/2026-07-05-daily-read-scheduling-fix-decision.md in the control-plane repo)
    // was completely invisible — last_ran kept ticking while last_queued_date silently went
    // stale. Record the defer so ops/monitor/arc-flywheel-health.ts (control-plane, daily cron)
    // can alert on it instead of relying on someone noticing days later.
    //
    // P3 arc-posting-scheduler (2026-07-05): daily-read now reserves its 4-tweet beat in
    // its OWN `lane='daily-read'` budget_ledger row (via reserve-group, called from
    // arc-daily-read/cli.ts's cmdPost — see reserveDailyReadGroup()/
    // writeDailyReadDeferState() there) — the shared 'post'-lane/x_post_log count checked
    // HERE is a SOFT, early pre-check only (skip drafting-cost when the shared legacy cap
    // is obviously still exhausted), not the authoritative gate anymore. The real
    // cap+window arbiter is reserve-group's own admission (its lane's cap AND the
    // cross-lane DAILY_TWEET_CAP backstop), enforced later in the same dispatch turn once
    // the beat is drafted. This branch is kept — still a legitimate reason to skip
    // drafting early — but its own defer-write below is now a SECONDARY safety net;
    // cmdPost's writeDailyReadDeferState() is the primary, queue-sourced one.
    const priorState = await readHookState(SENSOR_NAME);
    await writeHookState(SENSOR_NAME, {
      ...(priorState ?? { version: 0, last_ran: new Date().toISOString(), last_result: "skip" as const }),
      last_ran: new Date().toISOString(),
      last_result: "skip" as const,
      version: ((priorState?.version as number) ?? 0) + 1,
      last_defer_reason: "cap_insufficient",
      last_defer_at: new Date().toISOString(),
      last_slots_remaining: slotsRemaining,
    });
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

  // Queue the dispatch task.
  // P1 (arc-demand-flywheel): the composer is now findings-first and requires an LLM voice
  // pass. The sensor still only decides WHEN (time gate, cap, kill switch, dedup — all
  // deterministic, unchanged above); the drafting work below happens in THIS dispatch cycle's
  // own LLM turn, which already has SOUL.md loaded as system context. No separate LLM call is
  // introduced — this is the same dispatch turn that used to just run `cli.ts post` verbatim,
  // now asked to actually draft the beat instead of executing a template.
  const taskId = insertTaskDeduped({
    subject: `Post Arc's Daily Read — Edition ${editionN}`,
    description: [
      `Arc's Daily Read Edition ${editionN} is due. UTC 13:00 window. Findings-first (P1) —`,
      `the subject is a research finding, not pipeline volume. Follow these 3 steps:`,
      ``,
      `STEP 1 — materials (deterministic, run this first):`,
      `  bun ~/arc-starter/skills/arc-daily-read/cli.ts materials`,
      `  Selects the next unused relevance-4/5 finding from research/INDEX.md (crown jewels`,
      `  first), extracts its measured-claim hook + a real file:line citation, computes the`,
      `  deterministic stats footer, and assigns this edition's intro-style + the list of prior`,
      `  editions' openings to avoid repeating. Writes the brief to`,
      `  db/daily-read-materials/edition-${editionN}.json.`,
      ``,
      `STEP 2 — draft (you, this dispatch turn, in Arc's voice per SOUL.md):`,
      `  Read the brief. Write tweets 1-3 as JSON`,
      `  { "tweets": ["<tweet1>", "<tweet2>", "<tweet3>"] } (exactly 3 — do NOT add a 4th) to`,
      `  db/daily-read-materials/edition-${editionN}.draft.json. Requirements (validated`,
      `  deterministically by 'post' — DEFERRED, not a crash, if any fail):`,
      `    - Tweet 1 leads with the finding's hook and quotes its file:line citation literally`,
      `      ("tested against a live agent" proof) — this is the lede, not an afterthought.`,
      `    - Tweet 1's opening line must NOT match any of the brief's avoidOpenings.`,
      `    - Follow the brief's assigned introStyle for tweet 1's framing.`,
      `    - Every tweet ≤240 chars.`,
      `    - Honor SOUL.md's voice rules (banned openers/adverbs/emphasis crutches, no`,
      `      binary-contrast or rhetorical-question structures, active voice). In particular:`,
      `      no "X isn't Y, it's Z" construction anywhere in tweets 1-3 — this is a named`,
      `      SOUL.md-banned structure and it crept into P1's own hand-drafted test samples.`,
      `    - Vary tweet 2 and tweet 3's RHETORICAL SHAPE across editions, not just tweet 1's`,
      `      opening. Arc-strategy-panel review of the first 3 test editions found that even`,
      `      with distinct tweet-1 openers, every tweet 2 fell into "I have [existing thing],`,
      `      not/but [missing thing]" and every tweet 3 fell into "watching whether I build`,
      `      this before someone else does" — a new template replacing the old one, just`,
      `      relocated. Do not reuse either skeleton. Give tweet 3 a genuine job (a concrete`,
      `      next step, a real number, or an honest stance) rather than a stock competitive-`,
      `      stakes close.`,
      `    - Do NOT author tweet 4 — the stats footer + free-room CTA link are assembled`,
      `      deterministically by the code, never by you, so the URL can't be wrong.`,
      ``,
      `STEP 3 — post (deterministic, run last):`,
      `  bun ~/arc-starter/skills/arc-daily-read/cli.ts post --voice-file db/daily-read-materials/edition-${editionN}.draft.json`,
      `  Re-validates the draft, then runs the unchanged deterministic pipeline: cap check`,
      `  (need 4/${DAILY_TWEET_CAP} slots; ${slotsRemaining} available), kill switch, dedup,`,
      `  X post, amplification email (D4 — required, non-blocking), and daily_read_log logging.`,
      `  If the draft fails validation or is missing, this DEFERS (exits cleanly) rather than`,
      `  falling back to the old pipeline-stats template.`,
      ``,
      `Reach-proof carry-forward: ≥10 consecutive beats needed (cannot fit this quest window).`,
      `Target: ≥15 net followers + ≥1 external RT within 7 days of Edition 1.`,
      `Baseline: 51 followers (P2, 2026-06-27), 0 external engagement.`,
    ].join("\n"),
    skills: JSON.stringify(["arc-daily-read"]),
    priority: 2,
    model: "sonnet",
    source: todaySource,
  });

  if (taskId === null) {
    log("task creation skipped (duplicate subject or source)");
    return "skip";
  }

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: ((await readHookState(SENSOR_NAME))?.version ?? 0) + 1,
    last_queued_date: now.toISOString().split("T")[0],
    last_task_id: taskId,
  });

  log(`queued Daily Read Edition ${editionN} task (id: ${taskId}, source: ${todaySource})`);
  return "ok";
}
