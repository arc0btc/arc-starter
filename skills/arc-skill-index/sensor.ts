// arc-skill-index/sensor.ts
//
// Indexes all SKILL.md files into arc_memory (domain='skills') for smart skill discovery.
// Also indexes recent failure patterns per skill.
// Runs every 60 minutes.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { discoverSkills } from "../../src/skills.ts";
import { initDatabase, upsertMemory, getDatabase } from "../../src/db.ts";
import type { Task } from "../../src/db.ts";

const SENSOR_NAME = "arc-skill-index";
const INTERVAL_MINUTES = 60;

const log = createSensorLogger(SENSOR_NAME);

/** Extract a capability summary from SKILL.md content + frontmatter metadata. */
function buildCapabilitySummary(
  name: string,
  description: string,
  tags: string[],
  content: string,
  hasSensor: boolean,
  hasCli: boolean,
): string {
  const parts: string[] = [];

  parts.push(`Skill: ${name}`);
  if (description) parts.push(`Description: ${description}`);
  if (tags.length > 0) parts.push(`Tags: ${tags.join(", ")}`);

  const capabilities: string[] = [];
  if (hasSensor) capabilities.push("sensor");
  if (hasCli) capabilities.push("cli");
  if (capabilities.length > 0) parts.push(`Has: ${capabilities.join(", ")}`);

  // Extract CLI commands if present (lines starting with arc or containing --)
  const cliLines = content
    .split("\n")
    .filter((line) => /^\s*(arc\s|.*--\w)/.test(line) && !line.startsWith("#"))
    .map((line) => line.trim())
    .slice(0, 5);
  if (cliLines.length > 0) {
    parts.push(`CLI commands: ${cliLines.join(" | ")}`);
  }

  // Keep it under ~300 chars for FTS efficiency
  const summary = parts.join(". ");
  return summary.length > 500 ? summary.slice(0, 497) + "..." : summary;
}

/** Index failure patterns for skills that appear in recently failed tasks. */
function indexFailurePatterns(): number {
  const db = getDatabase();

  // Get failed tasks from the last 30 days that have skills
  const failedTasks = db
    .query(
      `SELECT id, subject, skills, result_summary
       FROM tasks
       WHERE status = 'failed'
         AND skills IS NOT NULL
         AND skills != '[]'
         AND completed_at >= datetime('now', '-30 days')
       ORDER BY completed_at DESC
       LIMIT 200`,
    )
    .all() as Pick<Task, "id" | "subject" | "skills" | "result_summary">[];

  // Group failures by skill name
  const failuresBySkill = new Map<string, Array<{ id: number; subject: string; summary: string }>>();

  for (const task of failedTasks) {
    let skillNames: string[];
    try {
      skillNames = JSON.parse(task.skills ?? "[]") as string[];
    } catch {
      continue;
    }
    for (const skill of skillNames) {
      const existing = failuresBySkill.get(skill) ?? [];
      existing.push({
        id: task.id,
        subject: task.subject,
        summary: (task.result_summary ?? "").slice(0, 100),
      });
      failuresBySkill.set(skill, existing);
    }
  }

  let count = 0;
  for (const [skill, failures] of failuresBySkill) {
    const content = [
      `Skill ${skill}: ${failures.length} failures in last 30 days.`,
      ...failures.slice(0, 5).map((f) => `- #${f.id}: ${f.subject.slice(0, 80)} → ${f.summary}`),
      failures.length > 5 ? `... and ${failures.length - 5} more` : "",
    ]
      .filter(Boolean)
      .join("\n");

    upsertMemory({
      key: `skill-failure:${skill}`,
      domain: "skills",
      content,
      tags: `skill failure ${skill}`,
      ttl_days: 30,
      importance: 6,
    });
    count++;
  }

  return count;
}

export default async function arcSkillIndexSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initDatabase();
  const skills = discoverSkills();

  let indexed = 0;
  for (const skill of skills) {
    try {
      const skillMdPath = join(skill.path, "SKILL.md");
      const content = readFileSync(skillMdPath, "utf-8");

      const summary = buildCapabilitySummary(
        skill.name,
        skill.description,
        skill.tags,
        content,
        skill.hasSensor,
        skill.hasCli,
      );

      upsertMemory({
        key: `skill:${skill.name}`,
        domain: "skills",
        content: summary,
        tags: ["skill", ...skill.tags, skill.hasSensor ? "sensor" : "", skill.hasCli ? "cli" : ""]
          .filter(Boolean)
          .join(" "),
        importance: 4,
      });
      indexed++;
    } catch (err) {
      log(`failed to index skill ${skill.name}: ${err}`);
    }
  }

  const failureCount = indexFailurePatterns();

  log(`indexed ${indexed} skills, ${failureCount} failure patterns`);
  return "ok";
}
