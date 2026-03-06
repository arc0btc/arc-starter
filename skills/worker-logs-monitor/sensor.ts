// worker-logs-monitor/sensor.ts
//
// Queries worker-logs deployments for ERROR-level logs since last run.
// Groups errors by pattern, checks GitHub for existing issues, and
// creates investigation tasks when new error patterns appear.
// Pure TypeScript — no LLM.

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
  insertTaskIfNew,
  fetchWithRetry,
} from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "worker-logs-monitor";
const INTERVAL_MINUTES = 60;
const TASK_SOURCE = "sensor:worker-logs-monitor";

const log = createSensorLogger(SENSOR_NAME);

interface Deployment {
  name: string;
  url: string;
  repo: string;
  credKey: string;
}

const DEPLOYMENTS: Deployment[] = [
  {
    name: "arc0btc",
    url: "https://logs.arc0btc.com",
    repo: "arc0btc/worker-logs",
    credKey: "arc0btc_worker_api_key",
  },
  {
    name: "wbd",
    url: "https://logs.wbd.host",
    repo: "whoabuddy/worker-logs",
    credKey: "whoabuddy_admin_api_key",
  },
  {
    name: "mainnet",
    url: "https://logs.aibtc.com",
    repo: "aibtcdev/worker-logs",
    credKey: "aibtc_admin_api_key",
  },
  {
    name: "testnet",
    url: "https://logs.aibtc.dev",
    repo: "aibtcdev/worker-logs",
    credKey: "aibtc_admin_api_key",
  },
];

interface LogEntry {
  id?: number;
  level: string;
  message: string;
  app_id?: string;
  context?: Record<string, unknown>;
  created_at?: string;
  request_id?: string;
}

interface ErrorPattern {
  pattern: string;
  count: number;
  deployment: string;
  repo: string;
  sample: LogEntry;
}

/** Normalize an error message to a dedup-friendly pattern key. */
function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8,}\b/gi, "<ID>") // hex IDs
    .replace(/\b\d{4,}\b/g, "<NUM>") // long numbers
    .replace(/https?:\/\/\S+/g, "<URL>") // URLs
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Fetch ERROR logs from a deployment since a given timestamp. */
async function fetchErrors(
  deployment: Deployment,
  since: string | null,
): Promise<LogEntry[]> {
  const adminKey = await getCredential("worker-logs", deployment.credKey);
  if (!adminKey) {
    log(`no admin key for ${deployment.name} (worker-logs/${deployment.credKey}) — skipping`);
    return [];
  }

  const params = new URLSearchParams({ level: "ERROR", limit: "50" });
  const url = `${deployment.url}/logs?${params}`;

  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "X-Admin-Key": adminKey,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      log(`${deployment.name}: HTTP ${response.status} fetching logs`);
      return [];
    }

    const data = await response.json();
    const logs: LogEntry[] = Array.isArray(data) ? data : data.logs ?? [];

    // Filter to entries after `since` if we have a checkpoint
    if (since) {
      const sinceTime = new Date(since).getTime();
      return logs.filter((entry) => {
        const t = entry.created_at ? new Date(entry.created_at).getTime() : 0;
        return t > sinceTime;
      });
    }

    return logs;
  } catch (error) {
    log(`${deployment.name}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/** Check if a GitHub issue already exists for this error pattern. */
function issueExistsForPattern(repo: string, pattern: string): boolean {
  const searchQuery = `repo:${repo} is:issue is:open "${pattern.slice(0, 60)}" in:title`;
  const result = Bun.spawnSync(
    ["gh", "search", "issues", "--json", "number", "--limit", "1", "-q", "length", searchQuery],
    { timeout: 15_000 },
  );

  const stdout = result.stdout.toString().trim();
  const count = parseInt(stdout, 10);
  return !isNaN(count) && count > 0;
}

export default async function workerLogsMonitorSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  const state = await readHookState(SENSOR_NAME);
  const lastRan = state?.last_checked_at as string | undefined ?? null;
  const now = new Date().toISOString();

  // Collect errors from all deployments
  const allPatterns: ErrorPattern[] = [];

  for (const deployment of DEPLOYMENTS) {
    const errors = await fetchErrors(deployment, lastRan);
    if (errors.length === 0) continue;

    log(`${deployment.name}: ${errors.length} error(s) since ${lastRan ?? "first run"}`);

    // Group by normalized message pattern
    const groups = new Map<string, { count: number; sample: LogEntry }>();
    for (const entry of errors) {
      const key = normalizeMessage(entry.message ?? "unknown");
      const existing = groups.get(key);
      if (existing) {
        existing.count++;
      } else {
        groups.set(key, { count: 1, sample: entry });
      }
    }

    for (const [pattern, { count, sample }] of groups) {
      allPatterns.push({
        pattern,
        count,
        deployment: deployment.name,
        repo: deployment.repo,
        sample,
      });
    }
  }

  // Save checkpoint
  await writeHookState(SENSOR_NAME, {
    ...state,
    last_ran: now,
    last_result: "ok",
    last_checked_at: now,
    version: state ? (state.version ?? 0) + 1 : 1,
    patterns_found: allPatterns.length,
  });

  if (allPatterns.length === 0) {
    log("no new error patterns across deployments");
    return "ok";
  }

  // Filter out patterns that already have open GitHub issues
  const newPatterns: ErrorPattern[] = [];
  const seenRepos = new Set<string>();

  for (const p of allPatterns) {
    // Only check GitHub once per unique repo (rate limit friendly)
    const cacheKey = `${p.repo}:${p.pattern}`;
    if (seenRepos.has(cacheKey)) continue;
    seenRepos.add(cacheKey);

    try {
      if (!issueExistsForPattern(p.repo, p.pattern)) {
        newPatterns.push(p);
      } else {
        log(`${p.deployment}: issue already exists for "${p.pattern.slice(0, 50)}..."`);
      }
    } catch {
      // If GitHub search fails, include the pattern anyway
      newPatterns.push(p);
    }
  }

  if (newPatterns.length === 0) {
    log("all error patterns already have open issues");
    return "ok";
  }

  // Build description for the investigation task
  const lines = [
    `New error patterns detected across worker-logs deployments.\n`,
    `**Patterns found:** ${newPatterns.length}\n`,
  ];

  for (const p of newPatterns) {
    lines.push(`### ${p.deployment} (${p.repo})`);
    lines.push(`- **Pattern:** ${p.pattern}`);
    lines.push(`- **Count:** ${p.count} occurrence(s)`);
    if (p.sample.app_id) lines.push(`- **App:** ${p.sample.app_id}`);
    if (p.sample.created_at) lines.push(`- **Latest:** ${p.sample.created_at}`);
    lines.push("");
  }

  lines.push("**Action:** Investigate each pattern. File GitHub issues on the appropriate repo for genuine bugs. Dismiss transient errors.");
  lines.push("");
  lines.push("Use CLI to inspect: `arc skills run --name worker-logs-monitor -- errors`");

  log(`creating investigation task for ${newPatterns.length} new pattern(s)`);

  insertTaskIfNew(TASK_SOURCE, {
    subject: `worker-logs: ${newPatterns.length} new error pattern(s) detected`,
    description: lines.join("\n"),
    skills: '["worker-logs-monitor"]',
    priority: 6,
    model: "sonnet",
  });

  return "ok";
}
