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

async function fetchBeats(): Promise<Record<string, unknown>[] | null> {
  try {
    const url = `${API_BASE}/beats`;
    const response = await fetch(url);
    if (!response.ok) {
      log(`warn: beats fetch failed with ${response.status}`);
      return null;
    }
    const data = await response.json();
    return (data as Record<string, unknown>).beats as Record<string, unknown>[] || [];
  } catch (e) {
    const err = e as Error;
    log(`warn: beats fetch error: ${err.message}`);
    return null;
  }
}

interface CorrespondentStatus {
  address: string;
  beats: Array<{
    slug: string;
    name: string;
    status: string;
    signalCount: number;
  }>;
  signalCount: number;
  streak: number;
  currentStreak: number;
  daysActive: number;
  lastActive: string;
  score: number;
  nextAction?: string;
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

    // Check 1: Arc has claimed a beat
    if (status.beats && status.beats.length > 0) {
      log(`arc has claimed ${status.beats.length} beat(s)`);

      // Check each beat for activity
      for (const beat of status.beats) {
        const beatSlug = beat.slug as string;
        const beatStatus = beat.status as string;
        const signalCount = beat.signalCount as number;

        if (beatStatus === "active") {
          log(`beat ${beatSlug} is active (${signalCount} signals)`);
        } else {
          log(`warn: beat ${beatSlug} is INACTIVE (${signalCount} signals)`);

          // Queue an alert task to review the inactive beat
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
    if (status.currentStreak !== undefined) {
      const streak = status.currentStreak as number;
      const lastActive = status.lastActive as string;
      const today = new Date().toISOString().split("T")[0];

      if (lastActive === today) {
        log(`streak: already filed signal today (${streak}-day streak)`);
      } else {
        log(`streak: no signal filed today (${streak}-day streak at risk)`);

        // Queue an optional reminder to maintain streak
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

    // Check 3: Score and brief compilation opportunity
    if (status.score !== undefined) {
      const score = status.score as number;
      if (score >= 50) {
        log(`score: ${score} (eligible to compile briefs)`);

        const briefSource = `sensor:${SENSOR_NAME}:compile-brief`;
        const taskExists = pendingTaskExistsForSource(briefSource);

        if (!taskExists) {
          log("queuing reminder to compile daily brief");
          insertTask({
            subject: "Compile daily brief on aibtc.news (score ≥50)",
            description: `Arc's reputation score is ${score}, which qualifies for brief compilation. Once compiled, the brief can be inscribed on Bitcoin for sats. See: /api/brief/compile`,
            skills: JSON.stringify(["aibtc-news"]),
            priority: 8,
            status: "pending",
            source: briefSource,
          });
        }
      } else {
        log(`score: ${score} (need ≥50 to compile briefs)`);
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
