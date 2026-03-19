// skills/arc-bounty-scanner/sensor.ts
// Scan GitHub for open bounty issues in the AIBTC ecosystem

import { claimSensorRun, createSensorLogger, insertTaskIfNew } from "../../src/sensors.ts";
import { taskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-bounty-scanner";
const INTERVAL_MINUTES = 60;
const log = createSensorLogger(SENSOR_NAME);

/** Labels that indicate a funded/bounty work item */
const BOUNTY_LABELS = ["bounty", "funded", "reward", "prize"];

/** GitHub orgs to scan for bounty issues */
const BOUNTY_ORGS = ["aibtcdev", "arc0btc"];

interface BountyIssue {
  number: number;
  title: string;
  repository: string;
  url: string;
  labels: string[];
  author: string;
  createdAt: string;
}

function gh(args: string[]): { ok: boolean; stdout: string } {
  const result = Bun.spawnSync(["gh", ...args], { timeout: 30_000 });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
  };
}

function searchBountiesByOrg(org: string, label: string): BountyIssue[] {
  const result = gh([
    "search", "issues",
    "--owner", org,
    "--label", label,
    "--state", "open",
    "--limit", "20",
    "--json", "number,title,repository,url,labels,author,createdAt",
  ]);

  if (!result.ok || !result.stdout) return [];

  try {
    const data = JSON.parse(result.stdout) as Array<{
      number: number;
      title: string;
      repository: { nameWithOwner: string };
      url: string;
      labels: Array<{ name: string }>;
      author: { login: string };
      createdAt: string;
    }>;

    return data.map((issue) => ({
      number: issue.number,
      title: issue.title,
      repository: issue.repository.nameWithOwner,
      url: issue.url,
      labels: issue.labels.map((l) => l.name),
      author: issue.author.login,
      createdAt: issue.createdAt,
    }));
  } catch {
    return [];
  }
}

export default async function bountyScannerSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const allBounties: BountyIssue[] = [];

    for (const org of BOUNTY_ORGS) {
      for (const label of BOUNTY_LABELS) {
        const issues = searchBountiesByOrg(org, label);
        allBounties.push(...issues);
      }
    }

    // Deduplicate by URL across label searches
    const seen = new Set<string>();
    const uniqueBounties = allBounties.filter((b) => {
      if (seen.has(b.url)) return false;
      seen.add(b.url);
      return true;
    });

    let created = 0;

    for (const bounty of uniqueBounties) {
      const sourceKey = `bounty:${bounty.repository}#${bounty.number}`;

      if (taskExistsForSource(sourceKey)) continue;

      const labelStr = bounty.labels.join(", ");

      insertTaskIfNew(
        sourceKey,
        {
          subject: `Bounty: ${bounty.repository}#${bounty.number} — ${bounty.title}`,
          description: [
            `Bounty opportunity in ${bounty.repository}`,
            `Issue: ${bounty.url}`,
            `Labels: ${labelStr}`,
            `Author: ${bounty.author}`,
            `Opened: ${bounty.createdAt}`,
            "",
            "Instructions:",
            `1. Read the full issue: gh issue view --repo ${bounty.repository} ${bounty.number}`,
            "2. Check reward size ($ or sats mentioned in body/labels)",
            "3. Verify unclaimed — no assignee, no open PR",
            "4. Assess if within Arc domain (JS/TS, Bitcoin, Stacks, docs)",
            "5. If actionable: create P3 follow-up task to implement with relevant skills",
            "6. If not: close with reason (out of scope / already claimed / too complex)",
          ].join("\n"),
          skills: JSON.stringify(["arc-bounty-scanner"]),
          priority: 5,
        },
        "any",
      );

      created++;
    }

    if (created > 0) {
      log(`queued ${created} new bounty issue(s)`);
    }

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
