import {
  claimSensorRun,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  createSensorLogger,
} from "../../src/sensors.ts";
import { initDatabase } from "../../src/db.ts";
import { getUTCInfo } from "../../src/time.ts";

const SENSOR_NAME = "dri-performance-review";
const POLL_INTERVAL = 60; // check every 60 min
const TARGET_HOUR_UTC = 13; // 13:00 UTC (~8am CDT) — after overnight activity settles
const TASK_SOURCE = "sensor:dri-performance-review";
const log = createSensorLogger(SENSOR_NAME);

export default async function driPerformanceReviewSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, POLL_INTERVAL);
  if (!claimed) return "skip";

  const now = new Date();
  const { hour, date: utcDate } = getUTCInfo(now);

  // Only fire at target hour
  if (hour !== TARGET_HOUR_UTC) return "skip";

  // Dedup: only fire once per UTC day
  const state = await readHookState(SENSOR_NAME);
  if (state?.lastReviewDate === utcDate) return "skip";

  log(`Queuing daily DRI performance review for ${utcDate}`);

  await writeHookState(SENSOR_NAME, {
    ...(state ?? { version: 0 }),
    last_ran: now.toISOString(),
    last_result: "ok",
    version: (state?.version ?? 0) + 1,
    lastReviewDate: utcDate,
  });

  const id = insertTaskIfNew(TASK_SOURCE, {
    subject: `DRI performance review for ${utcDate}`,
    description: [
      `Daily DRI performance review — post results to a GitHub issue on aibtcdev/agent-news.`,
      ``,
      `## Review scope`,
      `Cover ALL 5 DRI seats with both overall performance and last-24h activity:`,
      ``,
      `### Beat Editors`,
      `1. **Elegant Orb** — \`aibtc-network\` beat editor`,
      `2. **Ivory Coda** (@giwaov) — \`bitcoin-macro\` beat editor`,
      `3. **Zen Rocket** — \`quantum\` beat editor`,
      ``,
      `### Operational DRIs`,
      `4. **Secret Mars** (@secret-mars) — Classifieds Sales DRI`,
      `5. **Opal Gorilla** (@Robotbot69) — Distribution DRI`,
      ``,
      `## Data sources`,
      `- aibtc.news API: signal counts, approval rates, beat activity`,
      `- Local DB: editor_registry, contact_interactions, editor_payouts`,
      `- GitHub: DRI issue trackers (#477 Sales, #483 cross-DRI), IC hiring activity`,
      `- Leaderboard API for ranking/score data`,
      ``,
      `## For each DRI, report:`,
      `- **Status**: active / degraded / dark`,
      `- **Last 24h**: specific actions taken, signals filed/approved, deliveries made`,
      `- **Overall trend**: improving / steady / declining (with supporting data)`,
      `- **Flags**: anything requiring Publisher attention or escalation`,
      ``,
      `## Output`,
      `Create a GitHub issue on aibtcdev/agent-news with the full report:`,
      `\`\`\``,
      `gh issue create --repo aibtcdev/agent-news \\`,
      `  --title "DRI Performance Review — ${utcDate}" \\`,
      `  --body "<report content>"`,
      `\`\`\``,
      `Add --label "dri-review" if the label exists; skip the flag if it errors.`,
      ``,
      `Tag these GitHub users in the issue body: @secret-mars @Robotbot69 @arc0btc @cedarxyz @pbtc21`,
      `Also mention the beat editors by name (they may not have GitHub handles mapped).`,
      ``,
      `Close this task as completed once the issue is created. Include the issue URL in the summary.`,
    ].join("\n"),
    priority: 6,
    skills: JSON.stringify(["dri-performance-review", "aibtc-news-editorial"]),
  });

  if (id !== null) {
    log(`DRI performance review task created: #${id}`);
  }

  return id !== null ? "ok" : "skip";
}
