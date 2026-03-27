// skills/paperboy/sensor.ts
// Tracks Paperboy delivery count and payout state.
// Cadence: daily. Creates tasks when earnings are owed or delivery milestones are hit.

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
  readHookState,
  writeHookState,
  SENSOR_FETCH_TIMEOUT_MS,
} from "../../src/sensors.ts";
import type { HookState } from "../../src/sensors.ts";

const SENSOR_NAME = "paperboy";
const INTERVAL_MINUTES = 1440; // once per day

const API_BASE = "https://paperboy-dash.p-d07.workers.dev";
const PAPERBOY_SLUG = "trustless";

// Alert on every N-delivery milestone
const DELIVERY_MILESTONE_STEP = 5;

const log = createSensorLogger(SENSOR_NAME);

interface PaperboyState extends HookState {
  deliveries: number;
  recruits: number;
  earned_sats: number;
  owed_sats: number;
  last_payout_check: string;
}

function parseNum(s: string | undefined): number {
  return s ? parseInt(s.replace(/,/g, ""), 10) : 0;
}

async function fetchProfileStats(): Promise<{
  deliveries: number;
  recruits: number;
  earned_sats: number;
  owed_sats: number;
}> {
  const url = `${API_BASE}/paperboy/${PAPERBOY_SLUG}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SENSOR_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`profile fetch failed: HTTP ${response.status}`);
  }
  const html = await response.text();

  const deliveriesMatch = html.match(/<strong>(\d+)<\/strong>\s*deliveries?/i);
  const recruitsMatch = html.match(/<strong>(\d+)<\/strong>\s*recruits?/i);
  const earnedMatch = html.match(/Earned[^<]*<strong>([\d,]+)<\/strong>\s*sats/i);
  const owedMatch = html.match(/Owed[^<]*<strong>([\d,]+)<\/strong>\s*sats/i);

  return {
    deliveries: parseNum(deliveriesMatch?.[1]),
    recruits: parseNum(recruitsMatch?.[1]),
    earned_sats: parseNum(earnedMatch?.[1]),
    owed_sats: parseNum(owedMatch?.[1]),
  };
}

export default async function paperboySensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    log("checking Paperboy delivery count and payout state");

    const stats = await fetchProfileStats();
    log(
      `deliveries=${stats.deliveries} recruits=${stats.recruits} ` +
        `earned=${stats.earned_sats} sats owed=${stats.owed_sats} sats`,
    );

    const state = (await readHookState(SENSOR_NAME)) as PaperboyState | null;
    const prevDeliveries = state?.deliveries ?? 0;
    const prevOwed = state?.owed_sats ?? 0;

    const today = new Date().toISOString().slice(0, 10);

    // Alert: pending payout changed (new sats owed or amount changed)
    if (stats.owed_sats > 0 && stats.owed_sats !== prevOwed) {
      const source = `sensor:${SENSOR_NAME}:payout:${today}`;
      const taskId = insertTaskIfNew(source, {
        subject: `paperboy: ${stats.owed_sats} sats payout pending`,
        description: [
          `Paperboy payout state as of ${today}:`,
          `- Deliveries: ${stats.deliveries}`,
          `- Recruits: ${stats.recruits}`,
          `- Earned (total): ${stats.earned_sats} sats`,
          `- **Owed (pending payout): ${stats.owed_sats} sats**`,
          "",
          "Confirm payout status:",
          "```",
          "arc skills run --name paperboy -- check-earnings",
          "```",
          "",
          "Weekly payouts are in sBTC. If payout is overdue, contact Tiny Marten (tinymarten.btc) via AIBTC inbox.",
        ].join("\n"),
        skills: '["paperboy"]',
        model: "haiku",
        priority: 6,
      });
      if (taskId !== null) log(`created payout task #${taskId} — ${stats.owed_sats} sats owed`);
    }

    // Alert: delivery milestone (every DELIVERY_MILESTONE_STEP deliveries)
    const prevMilestone = Math.floor(prevDeliveries / DELIVERY_MILESTONE_STEP);
    const currMilestone = Math.floor(stats.deliveries / DELIVERY_MILESTONE_STEP);
    if (currMilestone > prevMilestone && stats.deliveries > 0) {
      const source = `sensor:${SENSOR_NAME}:milestone:${stats.deliveries}`;
      const taskId = insertTaskIfNew(
        source,
        {
          subject: `paperboy: ${stats.deliveries} deliveries reached`,
          description: [
            `Paperboy delivery milestone: **${stats.deliveries} deliveries** as of ${today}.`,
            "",
            `Stats:`,
            `- Deliveries: ${stats.deliveries}`,
            `- Recruits: ${stats.recruits}`,
            `- Earned: ${stats.earned_sats} sats`,
            `- Owed: ${stats.owed_sats} sats`,
            "",
            "After 3 deliveries to the same recipient, pitch them to register as a correspondent (2,000 sats reward per recruit).",
            "",
            "Check delivery history:",
            "```",
            "arc skills run --name paperboy -- list-deliveries",
            "```",
          ].join("\n"),
          skills: '["paperboy"]',
          model: "haiku",
          priority: 8,
        },
        "any",
      );
      if (taskId !== null) log(`created milestone task #${taskId} — ${stats.deliveries} deliveries`);
    }

    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state?.version ?? 0) + 1,
      deliveries: stats.deliveries,
      recruits: stats.recruits,
      earned_sats: stats.earned_sats,
      owed_sats: stats.owed_sats,
      last_payout_check: today,
    } satisfies PaperboyState);

    const newDeliveries = stats.deliveries - prevDeliveries;
    log(
      `done: deliveries=${stats.deliveries} (+${newDeliveries} since last check), ` +
        `earned=${stats.earned_sats} sats, owed=${stats.owed_sats} sats`,
    );
    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
