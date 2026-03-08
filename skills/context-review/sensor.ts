// context-review/sensor.ts
//
// Audits whether recently completed/failed tasks had the right skills loaded.
// Checks for: invalid skill refs, missing skill coverage, context waste,
// empty skills on failed tasks. Creates a review task when issues are found.
// Pure TypeScript — no LLM.

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import { getDatabase, initDatabase } from "../../src/db.ts";
import { discoverSkills } from "../../src/skills.ts";

const SENSOR_NAME = "context-review";
const INTERVAL_MINUTES = 120;
const TASK_SOURCE = "sensor:context-review";
const REVIEW_WINDOW_HOURS = 4;
const MINIMUM_ISSUES_THRESHOLD = 2;

const log = createSensorLogger(SENSOR_NAME);

// ---- Types ----

interface RecentTask {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;
  status: string;
  source: string | null;
}

interface ContextFinding {
  task_id: number;
  task_subject: string;
  finding_type: "invalid_skill_reference" | "missing_skill_coverage" | "context_waste" | "empty_skills_failed";
  detail: string;
}

// ---- Keyword-to-skill mapping ----

// Sources whose descriptions are meta-analysis reports (contain child task subjects
// as examples). Scanning their descriptions would produce false positives since the
// description text discusses other tasks rather than describing this task's own work.
const META_TASK_SOURCES = new Set([
  "sensor:arc-workflow-review",
  "sensor:context-review",
  "sensor:arc-self-audit",
  "sensor:compliance-review",
  "sensor:arc-failure-triage", // failure retrospectives list failed task subjects verbatim
]);

// Maps skill names to domain keywords that indicate a task likely needs that skill.
// Only includes skills where keyword detection is meaningful.
const SKILL_KEYWORD_MAP: Record<string, string[]> = {
  "stacks-stackspot": ["stacking", "stackspot", "pox", "stx reward"],
  "bitcoin-wallet": ["bitcoin wallet", "btc wallet", "utxo", "send btc", "bitcoin transaction"],
  "bitcoin-taproot-multisig": ["taproot multisig", "musig", "multisig psbt", "sign multisig", "m-of-n"],
  "aibtc-news-classifieds": ["post-classified", "classified ad", "aibtc.news/api/classifieds"],
  "arc-housekeeping": ["housekeeping", "wal file", "stale lock", "uncommitted change"],
  "arc-cost-alerting": ["cost alert", "budget overrun", "spending limit", "overspend"],
  "arc-skill-manager": ["memory consolidat", "skill manager", "manage-skills"],
  "blog-publishing": ["blog draft", "publish blog", "new blog post", "write blog"],
  "blog-deploy": ["deploy blog", "blog deploy", "deploy arc0.me"],
  "social-x-posting": ["compose tweet", "draft tweet", "publish tweet", "schedule tweet", "post to x", "x posting"],
  "social-agent-engagement": ["agent engagement", "x402 message", "send x402", "agent-engagement skill"],
  "github-ci-status": ["ci status", "github actions", "workflow run"],
  "github-security-alerts": ["security alert", "dependabot", "vulnerability"],
  "arc-email-sync": ["email sync", "inbox sync", "arc-email"],
  "defi-bitflow": ["bitflow", "dex swap", "liquidity pool"],
  "defi-zest": ["zest", "zest protocol", "zest yield", "zest supply"],
  "defi-stacks-market": ["stacks market", "stx price", "market data"],
  "aibtc-news-editorial": ["aibtc news", "news editorial", "ordinals business"],
  "aibtc-dev-ops": ["aibtc dev", "aibtc ops", "aibtc deploy"],
  "arc-workflows": ["pr lifecycle", "arc workflow"],
  "arc-worktrees": ["worktree", "isolated branch"],
  // arc-credentials skill is only needed for auditing/rotating the store, NOT for routine
  // credential usage. Tasks that say "arc creds get/set" are just using the CLI — they don't
  // need the skill loaded. Only flag when the task is explicitly about the credential store itself.
  "arc-credentials": ["credential store audit", "rotate credentials", "kdf rotation", "credentials.enc audit"],
  "arc-web-dashboard": ["web dashboard", "arc-web-dashboard"],
};

// ---- Helpers ----

function parseSkillsArray(skills_json: string | null): string[] {
  if (!skills_json) return [];
  try {
    const parsed = JSON.parse(skills_json);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // malformed JSON
  }
  return [];
}

function getRecentCompletedAndFailedTasks(window_hours: number): RecentTask[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT id, subject, description, skills, status, source
       FROM tasks
       WHERE status IN ('completed', 'failed')
         AND completed_at > datetime('now', '-${window_hours} hours')
       ORDER BY completed_at DESC
       LIMIT 50`
    )
    .all() as RecentTask[];
}

// ---- Checks ----

function checkInvalidSkillReferences(
  task: RecentTask,
  valid_skill_names: Set<string>,
): ContextFinding[] {
  const findings: ContextFinding[] = [];
  const loaded_skills = parseSkillsArray(task.skills);

  for (const skill_name of loaded_skills) {
    if (!valid_skill_names.has(skill_name)) {
      findings.push({
        task_id: task.id,
        task_subject: task.subject,
        finding_type: "invalid_skill_reference",
        detail: `skill "${skill_name}" does not exist in skills/`,
      });
    }
  }

  return findings;
}

function checkMissingSkillCoverage(
  task: RecentTask,
  valid_skill_names: Set<string>,
): ContextFinding[] {
  const findings: ContextFinding[] = [];
  const loaded_skills = parseSkillsArray(task.skills);
  const loaded_set = new Set(loaded_skills);

  // Retrospective tasks inherit the parent task's subject verbatim ("Retrospective: extract
  // learnings from task #N — <parent subject>"). Keyword-matching them produces false positives
  // because the embedded parent subject may mention any domain. Skip keyword checks entirely.
  if (task.subject.startsWith("Retrospective:")) return findings;

  // Research tasks fetch and analyze external content (e.g., X articles, GitHub issues).
  // Their descriptions contain domain terminology from the *content* they analyze, not from
  // skills they need. "tweet" in "Research X article: @user" means fetching, not posting.
  if (task.subject.startsWith("Research X article:")) return findings;

  // Reputation review tasks embed the subject of the interaction being reviewed (e.g., a PR
  // title containing "classified ad"). The domain keywords belong to the reviewed interaction,
  // not to what the reputation review task itself needs.
  if (task.subject.startsWith("Submit reputation review:")) return findings;

  // Meta-analysis tasks have descriptions that quote other tasks' subjects/content.
  // Scanning those descriptions would produce false positives, so limit to subject only.
  // Use prefix matching so sensor sources with date suffixes (e.g. sensor:arc-failure-triage:retro:2026-03-06) still match.
  const isMetaSource = task.source
    ? Array.from(META_TASK_SOURCES).some((prefix) => task.source!.startsWith(prefix))
    : false;
  const searchable_text = isMetaSource
    ? task.subject.toLowerCase()
    : `${task.subject} ${task.description ?? ""}`.toLowerCase();

  for (const [skill_name, keywords] of Object.entries(SKILL_KEYWORD_MAP)) {
    if (!valid_skill_names.has(skill_name)) continue;
    if (loaded_set.has(skill_name)) continue;

    for (const keyword of keywords) {
      if (searchable_text.includes(keyword.toLowerCase())) {
        findings.push({
          task_id: task.id,
          task_subject: task.subject,
          finding_type: "missing_skill_coverage",
          detail: `mentions "${keyword}" but skill "${skill_name}" not loaded`,
        });
        break; // one finding per skill per task
      }
    }
  }

  return findings;
}

function checkContextWaste(
  task: RecentTask,
): ContextFinding[] {
  const loaded_skills = parseSkillsArray(task.skills);
  // Flag tasks with an unusually high skill count (>5 suggests over-loading)
  if (loaded_skills.length > 5) {
    return [{
      task_id: task.id,
      task_subject: task.subject,
      finding_type: "context_waste",
      detail: `loaded ${loaded_skills.length} skills — likely excessive context`,
    }];
  }
  return [];
}

function checkEmptySkillsFailed(
  task: RecentTask,
): ContextFinding[] {
  if (task.status !== "failed") return [];
  const loaded_skills = parseSkillsArray(task.skills);
  if (loaded_skills.length === 0) {
    return [{
      task_id: task.id,
      task_subject: task.subject,
      finding_type: "empty_skills_failed",
      detail: "task failed with no skills loaded — may have lacked needed context",
    }];
  }
  return [];
}

// ---- Main sensor ----

export default async function contextReviewSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    log("auditing context loading for recent tasks...");

    const recent_tasks = getRecentCompletedAndFailedTasks(REVIEW_WINDOW_HOURS);
    if (recent_tasks.length === 0) {
      log("no recent completed/failed tasks to audit");
      return "ok";
    }

    // Build valid skill name set
    const all_skills = discoverSkills();
    const valid_skill_names = new Set(all_skills.map((s) => s.name));

    // Run all checks
    const all_findings: ContextFinding[] = [];

    for (const task of recent_tasks) {
      all_findings.push(...checkInvalidSkillReferences(task, valid_skill_names));
      all_findings.push(...checkMissingSkillCoverage(task, valid_skill_names));
      all_findings.push(...checkContextWaste(task));
      all_findings.push(...checkEmptySkillsFailed(task));
    }

    log(`audited ${recent_tasks.length} tasks, found ${all_findings.length} issue(s)`);

    if (all_findings.length < MINIMUM_ISSUES_THRESHOLD) {
      return "ok";
    }

    // Group findings by type for the report
    const by_type = new Map<string, ContextFinding[]>();
    for (const finding of all_findings) {
      const group = by_type.get(finding.finding_type) ?? [];
      group.push(finding);
      by_type.set(finding.finding_type, group);
    }

    const type_labels: Record<string, string> = {
      invalid_skill_reference: "Invalid Skill References",
      missing_skill_coverage: "Missing Skill Coverage",
      context_waste: "Context Waste (excessive skills)",
      empty_skills_failed: "Empty Skills on Failed Tasks",
    };

    let description = `Context review audit found ${all_findings.length} issue(s) across ${recent_tasks.length} recent tasks.\n\n`;

    for (const [finding_type, findings] of by_type) {
      description += `## ${type_labels[finding_type] ?? finding_type}\n\n`;
      for (const f of findings) {
        description += `- **Task #${f.task_id}** (${f.task_subject}): ${f.detail}\n`;
      }
      description += "\n";
    }

    description += "Review findings. For missing coverage, update the sensor/template creating those tasks to include the right skills. For invalid refs, check if the skill was renamed or removed.";

    insertTaskIfNew(TASK_SOURCE, {
      subject: `context-review: ${all_findings.length} context loading issue(s) found`,
      description,
      skills: '["context-review"]',
      priority: 6,
      model: "sonnet",
    });

    return "ok";
  } catch (e) {
    const error = e as Error;
    log(`error: ${error.message}`);
    return "error";
  }
}
