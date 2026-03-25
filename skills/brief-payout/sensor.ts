import {
  claimSensorRun,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createSensorLogger,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "brief-payout";
const POLL_INTERVAL = 30; // check every 30 min
const TASK_SOURCE = "sensor:brief-payout";
const API_BASE = "https://aibtc.news/api";
const log = createSensorLogger(SENSOR_NAME);

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
  }).format(now); // YYYY-MM-DD
  return { hour, date };
}

/**
 * Safety-net sensor for correspondent payouts.
 *
 * The primary trigger path is the PayoutDistributionMachine workflow created
 * by the inscription state machine's `payout` state. This sensor fires as a
 * fallback if that workflow path did not trigger payouts.
 *
 * Window: 1-6 AM PST (2+ hours after inscription at 11 PM)
 */
export default async function briefPayoutSensor(): Promise<string> {
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

  // Prerequisite: inscription must have completed for today
  const inscribeState = await readHookState("daily-brief-inscribe");
  if (!inscribeState?.last_fired_date || inscribeState.last_fired_date !== pstDate) {
    log(`Inscription not completed for ${pstDate} — skipping payout trigger`);
    return "skip";
  }

  // Check if payout workflow already exists (created by inscription state machine)
  try {
    const proc = Bun.spawn(
      ["bash", "bin/arc", "skills", "run", "--name", "workflows", "--", "get", `payout-${pstDate}`],
      { cwd: import.meta.dir + "/../..", stdin: "ignore", stdout: "pipe", stderr: "pipe" }
    );
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0 && stdout.trim().length > 0) {
      log(`Payout workflow already exists for ${pstDate} — marking as done`);
      await writeHookState(SENSOR_NAME, {
        ...(state ?? { version: 0 }),
        last_ran: now.toISOString(),
        last_result: "skip:workflow-exists",
        version: (state?.version ?? 0) + 1,
        lastPayoutDate: pstDate,
      });
      return "skip";
    }
  } catch {
    // Workflow CLI not available or failed — proceed to create task
  }

  // Check for pending earnings before creating a task
  try {
    const resp = await fetchWithRetry(
      `${API_BASE}/earnings/${encodeURIComponent("bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku")}?status=pending&from=${pstDate}&to=${pstDate}`
    );

    if (!resp.ok) {
      log(`Earnings API returned ${resp.status} — skipping`);
      return "skip";
    }

    const data = (await resp.json()) as { earnings?: unknown[] };
    const earnings = data.earnings ?? (Array.isArray(data) ? data : []);

    if (earnings.length === 0) {
      log(`No pending earnings for ${pstDate} — nothing to pay`);
      await writeHookState(SENSOR_NAME, {
        ...(state ?? { version: 0 }),
        last_ran: now.toISOString(),
        last_result: "ok:no-earnings",
        version: (state?.version ?? 0) + 1,
        lastPayoutDate: pstDate,
      });
      return "ok";
    }

    log(`Found ${earnings.length} pending earning(s) for ${pstDate}`);
  } catch (err) {
    log(`Error checking earnings: ${err instanceof Error ? err.message : String(err)}`);
    return "error";
  }

  // All conditions met — create a DRY RUN task (calculate only, no transfers).
  // When we're ready for live payments, change this to use `execute` instead of `calculate`
  // and remove the [DRY RUN] prefix.
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastPayoutDate: pstDate,
  });

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `[DRY RUN] Calculate correspondent payouts for ${pstDate} daily brief`,
    description: [
      `Run a dry-run payout calculation for the ${pstDate} daily brief.`,
      `This is a DRY RUN — no sBTC transfers will be sent.`,
      ``,
      `## Steps`,
      `1. Run: arc skills run --name brief-payout -- calculate --date ${pstDate}`,
      `2. Review the output: verify correspondent count, earnings match, address resolution, and balance.`,
      `3. Close task with a summary of the payout plan.`,
      ``,
      `## When ready for live payments`,
      `Edit skills/brief-payout/sensor.ts — change the task to use \`execute\` instead of \`calculate\`.`,
    ].join("\n"),
    priority: 6,
    skills: JSON.stringify(["brief-payout", "bitcoin-wallet"]),
  });

  return id !== null ? "ok" : "skip";
}
