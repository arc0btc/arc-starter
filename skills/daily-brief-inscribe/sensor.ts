import { claimSensorRun, readHookState, writeHookState, insertTaskIfNew } from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";

const SENSOR_NAME = "daily-brief-inscribe";
const POLL_INTERVAL = 30; // check every 30 min
const TARGET_HOUR_PST = 23; // 11 PM PST = end of calendar day
const TASK_SOURCE = "sensor:daily-brief-inscribe";

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

  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    last_fired_date: pstDate,
  });

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `Inscribe daily brief for ${pstDate}`,
    description: `Record the Bitcoin inscription for the aibtc.news daily brief.\n\nRun: arc skills run --name aibtc-news-classifieds -- inscribe-brief --date ${pstDate}\n\nRequires BIP-137 auth. Close as failed if brief has not been compiled for this date.`,
    priority: 6,
    skills: JSON.stringify(["aibtc-news-classifieds", "bitcoin-wallet"]),
  });

  return id !== null ? "ok" : "skip";
}
