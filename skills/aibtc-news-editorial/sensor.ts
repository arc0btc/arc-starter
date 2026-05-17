// skills/aibtc-news-editorial/sensor.ts
// Sensor for beat activity monitoring and signal filing opportunities

import { claimSensorRun, createSensorLogger, fetchWithRetry, readHookState, writeHookState } from "../../src/sensors.ts";
import { insertTask, isBeatOnCooldown, isDailySignalCapHit, pendingTaskExistsForSource, recentTaskExistsForSourcePrefix } from "../../src/db.ts";
import { ARC_BTC_ADDRESS } from "../../src/identity.ts";

const SENSOR_NAME = "aibtc-news-editorial";
const INTERVAL_MINUTES = 360; // 6 hours
const API_BASE = "https://aibtc.news/api";
const RATE_LIMIT_MINUTES = 240; // 4 hours — matches aibtc.news per-beat rate limit
const BRIEF_SCORE_THRESHOLD = 50; // minimum score to queue brief compilation

const log = createSensorLogger(SENSOR_NAME);

async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const url = `${API_BASE}/status/${ARC_BTC_ADDRESS}`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: status fetch failed with ${response.status}`);
      return null;
    }
    return (await response.json()) as Record<string, unknown>;
  } catch (e) {
    const error = e as Error;
    log(`warn: status fetch error: ${error.message}`);
    return null;
  }
}

async function fetchBeatStatuses(): Promise<Map<string, string>> {
  try {
    const url = `${API_BASE}/beats`;
    const response = await fetchWithRetry(url);
    if (!response.ok) {
      log(`warn: beats fetch failed with ${response.status}`);
      return new Map();
    }
    const beats = (await response.json()) as Array<{ slug: string; status: string }>;
    return new Map(beats.map((beat) => [beat.slug, beat.status]));
  } catch (e) {
    const error = e as Error;
    log(`warn: beats fetch error: ${error.message}`);
    return new Map();
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
  score?: number;
  streak: {
    current: number;
    longest: number;
    lastDate: string | null;
  };
  canFileSignal: boolean;
}

export default async function aibtcNewsSensor(): Promise<string> {
  try {
    // Claim sensor run (if not time yet, returns early)
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) {
      log("skip (interval not ready)");
      return "skip";
    }

    log("run started");

    // Fetch Arc's current status and global beat list in parallel
    log("fetching correspondent status and beat list...");
    const [status, beatStatuses] = await Promise.all([
      fetchStatus() as Promise<CorrespondentStatus | null>,
      fetchBeatStatuses(),
    ]);

    if (!status) {
      log("could not fetch status; skipping checks");
      return "skip";
    }

    // Check 1: Arc has claimed a beat (API returns singular `beat` object)
    if (status.beat) {
      const beatSlug = status.beat.slug;
      const beatStatus = status.beatStatus || status.beat.status;
      // /api/status only returns 'active'|'inactive'; cross-reference /api/beats for retired status
      const isRetired = beatStatuses.get(beatSlug) === "retired";

      if (beatStatus === "active") {
        log(`beat ${beatSlug} is active (${status.totalSignals} signals)`);
      } else if (isRetired) {
        log(`beat ${beatSlug} is retired (no alert)`);
      } else {
        log(`warn: beat ${beatSlug} is INACTIVE (${status.totalSignals} signals)`);

        const alertDate = new Date().toISOString().split("T")[0];
        const alertSource = `sensor:${SENSOR_NAME}:beat-${beatSlug}-inactive-${alertDate}`;
        const taskExists = pendingTaskExistsForSource(alertSource);

        if (!taskExists) {
          log(`queuing alert for inactive beat ${beatSlug}`);
          insertTask({
            subject: `[ALERT] Beat '${beatSlug}' is inactive — may be reclaimable`,
            description: `Beat '${beatSlug}' has not had a signal in 14+ days and is marked inactive. It may be reclaimable. Check /api/beats for status.`,
            skills: JSON.stringify(["aibtc-news-editorial"]),
            priority: 7,
            model: "haiku",
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
          subject: "Claim available beats on aibtc.news",
          description:
            "Arc has not yet claimed a beat on aibtc.news. Arc's active beats are aibtc-network (slug: aibtc-network), bitcoin-macro (slug: bitcoin-macro), and quantum (slug: quantum). Claim these beats only. Do NOT claim infrastructure, agent-trading, dao-watch, dev-tools, or any retired beat.\n\nUse:\narc skills run --name aibtc-news-editorial -- claim-beat --beat aibtc-network --name 'AIBTC Network'\narc skills run --name aibtc-news-editorial -- claim-beat --beat bitcoin-macro --name 'Bitcoin Macro'\narc skills run --name aibtc-news-editorial -- claim-beat --beat quantum --name 'Quantum'",
          skills: JSON.stringify(["aibtc-news-editorial"]),
          priority: 6,
          model: "haiku",
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

        // Daily cap guard — skip if 6/6 signal slots already claimed today
        if (isDailySignalCapHit()) {
          log("daily cap: 6/6 signal slots claimed today; skipping streak task");
        // Local rate-limit guard — check if ANY signal task was created recently (any status)
        } else if (recentTaskExistsForSourcePrefix(`sensor:${SENSOR_NAME}:`, RATE_LIMIT_MINUTES)) {
          log(`rate limit: signal task created within last ${RATE_LIMIT_MINUTES} min; skipping`);
        } else if (!status.canFileSignal) {
          // API-level rate-limit check
          log("rate limit active (canFileSignal=false); skipping streak task");
        } else {
          const availableBeats = ["aibtc-network", "bitcoin-macro", "quantum"]
            .filter((beat) => !isBeatOnCooldown(beat, 60));
          if (availableBeats.length === 0) {
            log("cooldown: all active beats on 60-min cooldown — skipping streak task");
          } else {
            // Queue a reminder to maintain streak (only if streak > 0)
            const streakSource = `sensor:${SENSOR_NAME}:maintain-streak`;
            const taskExists = pendingTaskExistsForSource(streakSource);

            if (!taskExists && streak > 0) {
              // Commit to the first available beat so the subject matches BEAT_SUBJECT_PATTERNS.
              // Without this, isBeatOnCooldown won't detect this pending/completed task,
              // allowing other sensors to queue a duplicate signal for the same beat.
              const targetBeat = availableBeats[0];
              log(`queuing streak task for beat ${targetBeat} (${streak}-day streak, available: ${availableBeats.join(", ")})`);
              insertTask({
                subject: `File ${targetBeat} signal: maintain ${streak}-day streak`,
                description: `Arc has a ${streak}-day signal-filing streak. File a signal to the \`${targetBeat}\` beat to maintain it. Do NOT file to infrastructure, agent-trading, dao-watch, dev-tools, or any retired beat.\n\nUse: arc skills run --name aibtc-news-editorial -- file-signal --beat ${targetBeat} --claim <text> --evidence <text> --implication <text>`,
                skills: JSON.stringify(["aibtc-news-editorial"]),
                priority: 7,
                model: "sonnet",
                status: "pending",
                source: streakSource,
              });
            }
          }
        }
      }
    }

    // Check 3: Brief compilation eligibility
    const today = new Date().toISOString().split("T")[0];

    // Calculate score from status data: signals×10 + streak×5 + daysActive×2
    const totalSignals = (status.totalSignals as number) || 0;
    const streakCurrent = (status.streak?.current as number) || 0;
    const streakHistory = ((status.streak as Record<string, unknown>)?.history as string[]) || [];
    const daysActive = streakHistory.length;
    const score = totalSignals * 10 + streakCurrent * 5 + daysActive * 2;

    const signalFiledToday = status.streak?.lastDate === today;
    const hookState = await readHookState(SENSOR_NAME);
    const lastBriefDate = hookState?.lastBriefDate as string | undefined;

    if (score >= BRIEF_SCORE_THRESHOLD && signalFiledToday && lastBriefDate !== today) {
      log(`brief compilation eligible: score ${score} >= ${BRIEF_SCORE_THRESHOLD}, signal filed today, not yet compiled today`);

      const briefSource = `sensor:${SENSOR_NAME}:brief`;
      const taskExists = pendingTaskExistsForSource(briefSource);

      if (!taskExists) {
        log("queuing brief compilation task");
        insertTask({
          subject: "Compile daily brief on aibtc.news",
          description:
            "Arc's score is ≥50 and a signal was filed today. Compile today's brief from signals to earn sats. Use: arc skills run --name aibtc-news-editorial -- compile-brief",
          skills: JSON.stringify(["aibtc-news-editorial", "bitcoin-wallet"]),
          priority: 5,
          model: "sonnet",
          status: "pending",
          source: briefSource,
        });
      }
    } else if (score >= BRIEF_SCORE_THRESHOLD) {
      // Diagnostic logging for ineligible but score-eligible cases
      const reasons = [];
      if (!signalFiledToday) reasons.push("no signal filed today");
      if (lastBriefDate === today) reasons.push("brief already compiled today");
      if (score < BRIEF_SCORE_THRESHOLD) reasons.push(`score ${score} < ${BRIEF_SCORE_THRESHOLD}`);
      log(
        `brief compilation NOT eligible (${reasons.join(", ")})`
      );
    }

    log("run completed");
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
