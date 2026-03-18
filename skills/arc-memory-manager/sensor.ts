import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import {
  insertTask,
  pendingTaskExistsForSource,
  countArcMemories,
  listArcMemory,
} from "../../src/db.ts";

const SENSOR_NAME = "arc-memory-manager";
const INTERVAL_MINUTES = 360; // Every 6 hours
const TASK_SOURCE = "sensor:arc-memory-manager";
const log = createSensorLogger(SENSOR_NAME);

const ENTRY_COUNT_THRESHOLD = 500;
const NO_TTL_PERCENT_THRESHOLD = 80;
const STALE_DAYS = 90;

const DOMAINS = [
  "fleet",
  "incidents",
  "cost",
  "integrations",
  "defi",
  "publishing",
  "identity",
  "infrastructure",
] as const;

export default async function arcMemoryManagerSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) return "skip";

  const issues: string[] = [];

  // Check 1: Total entry count
  const totalCount = countArcMemories();
  if (totalCount > ENTRY_COUNT_THRESHOLD) {
    issues.push(`Entry count ${totalCount} exceeds ${ENTRY_COUNT_THRESHOLD} threshold`);
  }

  // Check 2: Entries without TTL
  const allEntries = listArcMemory(undefined, 1000);
  const noTtlCount = allEntries.filter((e) => e.ttl_days === null).length;
  const noTtlPercent = totalCount > 0 ? Math.round((noTtlCount / totalCount) * 100) : 0;
  if (noTtlPercent > NO_TTL_PERCENT_THRESHOLD && totalCount > 20) {
    issues.push(`${noTtlPercent}% of entries lack TTL (${noTtlCount}/${totalCount})`);
  }

  // Check 3: Stale entries (no update in STALE_DAYS)
  const now = Date.now();
  const staleCutoff = now - STALE_DAYS * 24 * 60 * 60 * 1000;
  const staleCount = allEntries.filter((e) => {
    const updated = new Date(e.updated_at).getTime();
    return updated < staleCutoff;
  }).length;
  if (staleCount > 10) {
    issues.push(`${staleCount} entries not updated in ${STALE_DAYS}+ days`);
  }

  // Check 4: Domain distribution
  const domainCounts: Record<string, number> = {};
  for (const domain of DOMAINS) {
    domainCounts[domain] = countArcMemories(domain);
  }
  const maxDomain = Object.entries(domainCounts).sort((a, b) => b[1] - a[1])[0];
  if (maxDomain && totalCount > 20 && maxDomain[1] > totalCount * 0.5) {
    issues.push(
      `Domain imbalance: "${maxDomain[0]}" has ${maxDomain[1]}/${totalCount} entries (${Math.round((maxDomain[1] / totalCount) * 100)}%)`,
    );
  }

  if (issues.length === 0) {
    log(`healthy: ${totalCount} entries, ${noTtlPercent}% no-TTL, ${staleCount} stale`);
    return "ok";
  }

  insertTask({
    subject: `Memory health: ${issues.length} issue(s) detected`,
    description: [
      "arc-memory-manager sensor detected memory health issues:",
      "",
      ...issues.map((i) => `- ${i}`),
      "",
      "Run `arc skills run --name arc-memory-manager -- health` for full report.",
      "Run `arc skills run --name arc-memory-manager -- stale` to list stale entries.",
      "Run `arc skills run --name arc-memory-manager -- expire` to clean up expired entries.",
    ].join("\n"),
    skills: '["arc-memory-manager"]',
    priority: 8,
    model: "haiku",
    source: TASK_SOURCE,
  });

  log(`created task: ${issues.length} issue(s)`);
  return "ok";
}
