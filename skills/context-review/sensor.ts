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
const INTERVAL_MINUTES = 480; // 8 hours — skill mismatch detection 3x/day
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
  result_summary: string | null;
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
  "sensor:arc-failure-triage",      // failure retrospectives list failed task subjects verbatim
  "sensor:arc-introspection",        // introspection reports summarize recent task subjects verbatim
  "sensor:arc-cost-reporting",       // cost reports embed top task subjects/descriptions — external data, not skill requirements
  "sensor:github-release-watcher",   // descriptions contain external release notes content — keywords don't indicate skill requirements
  "sensor:arc-blocked-review",       // descriptions are built from blocked tasks' own descriptions — domain keywords belong to those tasks
]);

// Maps skill names to domain keywords that indicate a task likely needs that skill.
// Only includes skills where keyword detection is meaningful.
const SKILL_KEYWORD_MAP: Record<string, string[]> = {
  "stacks-stackspot": ["stackspot", "pox", "stx reward", "stx stacking"],
  // NOTE: "stacking" excluded — too broad, catches "Stacker achievements" (UI/badge tasks on landing-page).
  // "stx stacking" and "pox" are unambiguous. "blog-x-syndication" is not a real skill;
  // use "blog-publishing" + "social-x-posting" for blog-to-X syndication tasks.
  // "bitcoin wallet" / "btc wallet" are intentionally excluded — too generic.
  // Provisioning tasks describe "generate Bitcoin wallets" (setup) without needing this skill.
  // Only match on unambiguous operational keywords: actual transaction/UTXO work.
  "bitcoin-wallet": ["utxo", "send btc", "bitcoin transaction", "wallet unlock btc", "spend bitcoin"],
  "bitcoin-taproot-multisig": ["taproot multisig", "musig", "multisig psbt", "sign multisig", "m-of-n"],
  "aibtc-news-classifieds": ["post-classified", "classified ad", "aibtc.news/api/classifieds"],
  "arc-housekeeping": ["wal file", "stale lock", "uncommitted change", "arc-housekeeping run"],
  "arc-cost-alerting": ["cost alert", "budget overrun", "spending limit", "overspend"],
  "arc-skill-manager": ["memory consolidat", "skill manager", "manage-skills"],
  "blog-publishing": ["blog draft", "publish blog", "new blog post", "write blog"],
  "blog-deploy": ["deploy blog", "blog deploy", "deploy arc0.me"],
  "social-x-posting": ["compose tweet", "draft tweet", "publish tweet", "schedule tweet", "post to x", "x posting"],
  // x402 is a payment/messaging protocol — do NOT use "x402 message" or "send x402" here.
  // Those keywords appear in payments tasks, not social engagement.
  "social-agent-engagement": ["agent engagement", "agent-engagement skill", "x post reply", "engage on x"],
  // "github-ci-status" intentionally excluded — its SKILL.md states it is sensor-only and
  // should never be explicitly loaded at dispatch. Flagging tasks for not loading it is always
  // a false positive. PR review tasks that mention "ci status" use gh commands directly.
  "github-security-alerts": ["security alert", "dependabot"],
  "arc-email-sync": ["email sync", "inbox sync", "arc-email"],
  "defi-bitflow": ["bitflow", "dex swap", "liquidity pool"],
  "defi-zest": ["zest", "zest protocol", "zest yield", "zest supply"],
  "defi-stacks-market": ["stacks market", "stx price"],
  // "market data" excluded — too generic, matches ordinals-market-data sensor tasks incorrectly
  "aibtc-news-editorial": ["aibtc news", "news editorial", "ordinals business"],
  "aibtc-dev-ops": ["aibtc dev", "aibtc ops", "aibtc deploy"],
  "arc-workflows": ["pr lifecycle", "arc workflow"],
  "arc-worktrees": ["worktree", "isolated branch"],
  // arc-credentials skill is only needed for auditing/rotating the store, NOT for routine
  // credential usage. Tasks that say "arc creds get/set" are just using the CLI — they don't
  // need the skill loaded. Only flag when the task is explicitly about the credential store itself.
  "arc-credentials": ["credential store audit", "rotate credentials", "kdf rotation", "credentials.enc audit"],
  // presentation.html lives in src/web/ — arc-web-dashboard is the correct skill.
  // "arc-site" and "arc-weekly-presentation" are common incorrect aliases dispatch uses.
  "arc-web-dashboard": ["web dashboard", "arc-web-dashboard", "presentation.html", "tuesday deck", "tuesday presentation", "weekly deck", "weekly presentation"],
};

// ---- Helpers ----

function parseSkillsArray(skills_json: string | null): string[] {
  if (!skills_json) return [];
  try {
    const parsed = JSON.parse(skills_json);
    if (Array.isArray(parsed)) return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    // fallback: comma-separated plain string (legacy format from arc-workflows sensor)
    const parts = skills_json.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts;
  }
  return [];
}

function getRecentCompletedAndFailedTasks(window_hours: number): RecentTask[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT id, subject, description, skills, status, source, result_summary
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

  // "Extract learning from task #N — <parent subject>" tasks embed the parent task's subject
  // in their own subject and description. Domain keywords belong to the parent task's work,
  // not to what the learning extraction task itself needs.
  if (/^Extract learning from task #\d+/.test(task.subject)) return findings;

  // Scaffold tasks create a new skill and load arc-skill-manager to do so.
  // Flagging them for not loading the skill they're creating is always a false positive.
  if (/^Scaffold \S+ skill /i.test(task.subject)) return findings;

  // Research tasks fetch and analyze external content (e.g., X articles, GitHub issues).
  // Their descriptions contain domain terminology from the *content* they analyze, not from
  // skills they need. "tweet" in "Research X article: @user" means fetching, not posting.
  if (task.subject.startsWith("Research X article:")) return findings;

  // Retry tasks are about waiting for relay/service recovery and resending a message.
  // Their descriptions contain the original message topic (e.g., "bitflow", "zest") as context
  // for what to resend, not as indicators of skills needed for execution. The relay
  // mechanics (bitcoin-wallet + aibtc-inbox-sync) are what actually matter for retry tasks.
  if (task.subject.startsWith("Retry:")) return findings;

  // Reputation review tasks embed the subject of the interaction being reviewed (e.g., a PR
  // title containing "classified ad"). The domain keywords belong to the reviewed interaction,
  // not to what the reputation review task itself needs.
  if (task.subject.startsWith("Submit reputation review:")) return findings;

  // PR review tasks: the PR title in the subject (e.g. "Review PR #427 on landing-page: Stacker achievement")
  // contains domain keywords from the PR content, not from what the review task itself needs.
  if (/^Review PR #\d+/.test(task.subject)) return findings;
  // Audit tasks similarly embed issue/PR titles (e.g. "Produce prioritized achievements audit for landing-page#384")
  if (/audit for [\w/-]+#\d+/.test(task.subject)) return findings;

  // Presentation update tasks (src/web/presentation.html) describe slide *content* as context
  // for what to write — e.g. "Zest sBTC supply ops", "AIBTC NEWS COMPETITION" — not as
  // operational requirements. These keywords belong to the slide topic, not the skill set.
  // arc-web-dashboard is the only skill these tasks need; its coverage is caught via the
  // keyword map entry ("presentation.html", "tuesday deck", etc.).
  if (/presentation\.html|tuesday\s+(deck|presentation)|weekly\s+(deck|presentation|slides)/i
    .test(`${task.subject} ${task.description ?? ""}`)) return findings;

  // llms.txt / llms-full.txt update tasks enumerate skill names from release notes (e.g.
  // "8 new BFF skills: dca, hermetica, hodlmm, bitflow-..."). Their descriptions contain
  // domain keywords from those skill names, not operational requirements — loading defi-bitflow
  // or defi-zest would add no value to a documentation update. Skip keyword checks entirely.
  if (/^Update llms/i.test(task.subject)) return findings;

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

  // Retrospective tasks embed parent subject — they fail for domain reasons, not missing context.
  if (task.subject.startsWith("Retrospective:")) return [];
  // Human-action tasks require a human to act — they fail because the human didn't, not due to missing context.
  if (task.subject.startsWith("HUMAN ACTION:")) return [];
  if (task.subject.startsWith("whoabuddy action needed:")) return [];

  // Tasks rejected at dispatch (no model set) never ran — missing skills is irrelevant.
  if (task.result_summary?.startsWith("No model set")) return [];

  // Superseded tasks were intentionally closed before running — not a context issue.
  if (task.result_summary?.startsWith("superseded by task")) return [];

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
