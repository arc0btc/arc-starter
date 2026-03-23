import { existsSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "daily-brief-inscribe";
const POLL_INTERVAL = 30; // check every 30 min
const TARGET_HOUR_PST = 23; // 11 PM PST = end of calendar day
const TASK_SOURCE = "sensor:daily-brief-inscribe";

// Path to the child-inscription CLI (github/aibtcdev/skills must be cloned)
const CHILD_INSCRIPTION_CLI = join(
  import.meta.dir,
  "../../github/aibtcdev/skills/child-inscription/child-inscription.ts"
);

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
 * Check whether the inscription tooling is available before queuing a task.
 * Returns { ok: true } if all prerequisites pass, or { ok: false, reason } if not.
 *
 * Prerequisites:
 *   1. child-inscription CLI must exist at github/aibtcdev/skills/child-inscription/child-inscription.ts
 *      (requires cloning aibtcdev/skills into ~/arc-starter/github/aibtcdev/skills)
 */
function checkPrerequisites(): { ok: boolean; reason?: string } {
  if (!existsSync(CHILD_INSCRIPTION_CLI)) {
    return {
      ok: false,
      reason: "missing-child-inscription-cli: clone aibtcdev/skills into github/aibtcdev/skills",
    };
  }
  return { ok: true };
}

export default async function dailyBriefInscribeSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: pstDate } = getPSTInfo(now);

  // Only fire at 11 PM PST
  if (hour !== TARGET_HOUR_PST) return "skip";

  // Dedup: only fire once per PST calendar day
  const state = await readHookState(SENSOR_NAME);
  if (state?.last_fired_date === pstDate) return "skip";

  // Prerequisite check: only create the task if inscription tooling is available.
  // If missing, record the skip reason but do NOT update last_fired_date so the
  // sensor will re-check tomorrow and try again automatically.
  const prereq = checkPrerequisites();
  if (!prereq.ok) {
    await writeHookState(SENSOR_NAME, {
      ...(state ?? { version: 0 }),
      last_ran: now.toISOString(),
      last_result: `skip:${prereq.reason}`,
      version: (state?.version ?? 0) + 1,
      // last_fired_date intentionally NOT updated -- will retry tomorrow
    });
    return "skip";
  }

  // Prerequisites pass -- create the task and record the fired date.
  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    last_fired_date: pstDate,
  });

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Inscribe daily brief for ${pstDate}`,
    description: [
      `Inscribe the aibtc.news daily brief for ${pstDate} as a child ordinal under the canonical parent.`,
      ``,
      `## Workflow`,
      `1. Create workflow: arc skills run --name workflows -- create daily-brief-inscription brief-inscription-${pstDate} pending --context '{"date":"${pstDate}","parentId":"9d83815556ab6706e8a557d7f2514826e17421cd5443561f18276766b5474559i0","contentType":"text/html"}'`,
      `2. Evaluate state machine: arc skills run --name workflows -- evaluate <workflow_id>`,
      `3. Follow the state machine instructions at each state (fetch brief -> check balance -> commit tx -> confirm -> reveal -> record inscription -> payout)`,
      ``,
      `Close as failed if no compiled brief exists for this date.`,
    ].join("\n"),
    priority: 4,
    skills: JSON.stringify(["workflows", "aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  return id !== null ? "ok" : "skip";
}
