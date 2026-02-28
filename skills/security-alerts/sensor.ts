import { claimSensorRun } from "../../src/sensors.ts";
import { initDatabase, insertTask, taskExistsForSource } from "../../src/db.ts";
import { spawnSync } from "node:child_process";

const SENSOR_NAME = "security-alerts";
const INTERVAL_MINUTES = 360;
const TASK_SOURCE_PREFIX = "sensor:security-alerts";

const WATCHED_REPOS = [
  "arc0btc/arc-starter",
  "aibtcdev/landing-page",
  "aibtcdev/skills",
  "aibtcdev/x402-api",
  "aibtcdev/aibtc-mcp-server",
];

/** Severity levels that warrant a task, mapped to task priority */
const ALERT_SEVERITIES: Record<string, number> = {
  critical: 3,
  high: 4,
};

interface DependabotAlert {
  number: number;
  state: string;
  html_url: string;
  created_at: string;
  security_advisory: {
    severity: string;
    summary: string;
    cve_id: string | null;
    cvss: { score: number };
  };
  security_vulnerability: {
    package: { ecosystem: string; name: string };
    first_patched_version: { identifier: string } | null;
    vulnerable_version_range: string;
  };
  dependency: {
    manifest_path: string;
  };
}

interface AlertGroup {
  repo: string;
  pkg: string;
  highestSeverity: string;
  highestPriority: number;
  alerts: DependabotAlert[];
}

function fetchOpenAlerts(repo: string): DependabotAlert[] | null {
  const result = spawnSync(
    "gh",
    [
      "api",
      `/repos/${repo}/dependabot/alerts?state=open&severity=critical,high&per_page=50`,
    ],
    { timeout: 30_000 }
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString().trim() ?? "";
    if (stderr.includes("403") || stderr.includes("disabled")) {
      console.log(
        `[security-alerts] dependabot disabled for ${repo}, skipping`
      );
    } else {
      console.error(`[security-alerts] error fetching ${repo}: ${stderr}`);
    }
    return null;
  }

  try {
    const data = JSON.parse(result.stdout?.toString().trim() ?? "[]");
    if (!Array.isArray(data)) return [];
    return data as DependabotAlert[];
  } catch {
    return null;
  }
}

/** Group alerts by repo+package to avoid task spam */
function groupAlerts(
  repo: string,
  alerts: DependabotAlert[]
): AlertGroup[] {
  const groups = new Map<string, AlertGroup>();

  for (const alert of alerts) {
    const severity = alert.security_advisory?.severity;
    const priority = ALERT_SEVERITIES[severity];
    if (!priority) continue;

    const pkg = alert.security_vulnerability?.package?.name ?? "unknown";
    const key = `${repo}:${pkg}`;

    const existing = groups.get(key);
    if (existing) {
      existing.alerts.push(alert);
      if (priority < existing.highestPriority) {
        existing.highestPriority = priority;
        existing.highestSeverity = severity;
      }
    } else {
      groups.set(key, {
        repo,
        pkg,
        highestSeverity: severity,
        highestPriority: priority,
        alerts: [alert],
      });
    }
  }

  return Array.from(groups.values());
}

export default async function securityAlertsSensor(): Promise<string> {
  initDatabase();

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  let tasksCreated = 0;

  for (const repo of WATCHED_REPOS) {
    const alerts = fetchOpenAlerts(repo);
    if (!alerts || alerts.length === 0) continue;

    const groups = groupAlerts(repo, alerts);

    for (const group of groups) {
      // Source key is repo+package — one task per vulnerable package per repo
      const source = `${TASK_SOURCE_PREFIX}:${repo}:${group.pkg}`;
      if (taskExistsForSource(source)) continue;

      const alertNumbers = group.alerts.map((a) => a.number);
      const topAlert = group.alerts[0];
      const cves = group.alerts
        .map((a) => a.security_advisory?.cve_id)
        .filter(Boolean)
        .join(", ") || "no CVE";
      const maxCvss = Math.max(
        ...group.alerts.map((a) => a.security_advisory?.cvss?.score ?? 0)
      );
      const patchedVersion =
        topAlert.security_vulnerability?.first_patched_version?.identifier;
      const manifest = topAlert.dependency?.manifest_path ?? "unknown";

      const alertCount = group.alerts.length;
      const subjectSuffix =
        alertCount > 1 ? ` (${alertCount} alerts)` : "";

      insertTask({
        subject: `Security: ${group.pkg} (${group.highestSeverity}) in ${repo}${subjectSuffix}`,
        description: [
          `${alertCount} dependabot alert(s) for ${group.pkg} on ${repo}`,
          "",
          `Package: ${group.pkg}`,
          `Severity: ${group.highestSeverity} (max CVSS ${maxCvss})`,
          `CVEs: ${cves}`,
          `Alert numbers: ${alertNumbers.join(", ")}`,
          `Manifest: ${manifest}`,
          patchedVersion
            ? `Fix: upgrade to ${patchedVersion}`
            : "No patch available yet",
          `URL: ${topAlert.html_url}`,
          "",
          "Instructions:",
          "1. Review the alert details on GitHub",
          "2. Assess if the vulnerability affects our usage of this package",
          "3. If a patch exists, update the dependency",
          "4. If no patch exists, evaluate workarounds or risk acceptance",
        ].join("\n"),
        priority: group.highestPriority,
        source,
      });

      tasksCreated++;
      console.log(
        `[security-alerts] created task for ${group.pkg} in ${repo} (${alertCount} alert(s), ${group.highestSeverity})`
      );
    }
  }

  if (tasksCreated > 0) {
    console.log(
      `[security-alerts] created ${tasksCreated} task(s) for security alerts`
    );
  }

  return tasksCreated > 0 ? "ok" : "skip";
}
