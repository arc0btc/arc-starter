// skills/aibtc-news/sensor.ts
// Sensor for beat activity monitoring and signal filing opportunities

import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "aibtc-news";
const INTERVAL_MINUTES = 360; // 6 hours
const ARC_BTC_ADDRESS = "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933";
const API_BASE = "https://aibtc.news/api";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [sensor:aibtc-news] ${msg}`);
}

async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const url = `${API_BASE}/status/${ARC_BTC_ADDRESS}`;
    const response = await fetch(url);
    if (!response.ok) {
      log(`warn: status fetch failed with ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (e) {
    const err = e as Error;
    log(`warn: status fetch error: ${err.message}`);
    return null;
  }
}


interface CorrespondentBeat {
  slug: string;
  name: string;
  status: string;
}

interface CorrespondentStatus {
  address: string;
  beat: CorrespondentBeat | null;
  beatStatus: string;
  totalSignals: number;
  streak: {
    current: number;
    longest: number;
    lastDate: string | null;
  };
  canFileSignal: boolean;
}

async function main(): Promise<void> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claim = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (claim.status === "skip") {
      log("skip (interval not ready)");
      return;
    }

    log("run started");

    // Initialize database
    initDatabase();

    // Fetch Arc's current status
    log("fetching correspondent status...");
    const status = (await fetchStatus()) as CorrespondentStatus | null;

    if (!status) {
      log("could not fetch status; skipping checks");
      return;
    }

    // Check 1: Arc has claimed a beat (API returns singular `beat` object)
    if (status.beat) {
      const beatSlug = status.beat.slug;
      const beatStatus = status.beatStatus || status.beat.status;

      if (beatStatus === "active") {
        log(`beat ${beatSlug} is active (${status.totalSignals} signals)`);
      } else {
        log(`warn: beat ${beatSlug} is INACTIVE (${status.totalSignals} signals)`);

        const alertSource = `sensor:${SENSOR_NAME}:beat-${beatSlug}-inactive`;
        const taskExists = pendingTaskExistsForSource(alertSource);

        if (!taskExists) {
          log(`queuing alert for inactive beat ${beatSlug}`);
          insertTask({
            subject: `[ALERT] Beat '${beatSlug}' is inactive — may be reclaimable`,
            description: `Beat '${beatSlug}' has not had a signal in 14+ days and is marked inactive. It may be reclaimable. Check /api/beats for status.`,
            skills: JSON.stringify(["aibtc-news"]),
            priority: 7,
            status: "pending",
            source: alertSource,
          });
        }
      }
    } else {
      log("arc has not claimed any beats yet");

      // Queue a task to claim an available beat
      const claimSource = `sensor:${SENSOR_NAME}:claim-beat`;
      const taskExists = pendingTaskExistsForSource(claimSource);

      if (!taskExists) {
        log("queuing task to claim an available beat");
        insertTask({
          subject: "Claim an available beat on aibtc.news",
          description:
            "Arc has not yet claimed a beat on aibtc.news. Available beats include 'ordinals-business' and reclaimable inactive beats (network-ops, defi-yields, agent-commerce). Use: arc skills run --name aibtc-news -- claim-beat --beat <slug> --name <name>",
          skills: JSON.stringify(["aibtc-news"]),
          priority: 6,
          status: "pending",
          source: claimSource,
        });
      }
    }

    // Check 2: Streak status
    if (status.streak) {
      const streak = status.streak.current;
      const lastActive = status.streak.lastDate;
      const today = new Date().toISOString().split("T")[0];

      if (lastActive === today) {
        log(`streak: already filed signal today (${streak}-day streak)`);
      } else {
        log(`streak: no signal filed today (${streak}-day streak)`);

        // Queue a reminder to maintain streak (only if streak > 0)
        const streakSource = `sensor:${SENSOR_NAME}:maintain-streak`;
        const taskExists = pendingTaskExistsForSource(streakSource);

        if (!taskExists && streak > 0) {
          log("queuing reminder to maintain streak");
          insertTask({
            subject: `Maintain ${streak}-day streak on aibtc.news`,
            description: `Arc has a ${streak}-day signal-filing streak. File a signal today to maintain it. Use: arc skills run --name aibtc-news -- file-signal --beat <slug> --claim <text> --evidence <text> --implication <text>`,
            skills: JSON.stringify(["aibtc-news"]),
            priority: 7,
            status: "pending",
            source: streakSource,
          });
        }
      }
    }

    log("run completed");
  } catch (e) {
    const err = e as Error;
    console.error(`[${new Date().toISOString()}] [sensor:aibtc-news] error: ${err.message}`);
    process.exit(1);
  }
}

await main();
