// workflow-review/sensor.ts
//
// Evaluates workflow system health and detects new repeating patterns.
// Two-pass approach:
//   Pass 1: Template health — utilization, completion rates, stale instances
//   Pass 2: Pattern detection — repeating multi-step chains not yet modeled
//
// Also enforces a 30-day auto-stale TTL on non-completed workflows.
// Runs every 12 hours. Pure TypeScript — no LLM.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import {
  getDatabase,
  insertTask,
  pendingTaskExistsForSource,
} from "../../src/db.ts";
import type { Task } from "../../src/db.ts";
import { getTemplateByName } from "../arc-workflows/state-machine.ts";

const SENSOR_NAME = "arc-workflow-review";
const INTERVAL_MINUTES = 720; // 12 hours
const TASK_SOURCE = "sensor:arc-workflow-review";
const LOOKBACK_DAYS = 7;
const MIN_RECURRENCES = 3;
const STALE_WORKFLOW_DAYS = 30;

// (template, state) pairs that are passive waiting states — designed to hold indefinitely
// until an external event occurs. Excluded from 7-day stuck detection since it's normal for
// them to sit for weeks. Keyed by template because state names (e.g. "approved") are reused
// across templates with very different waiting semantics — pr-lifecycle's "approved" is a
// harmless wait on an external maintainer, but validation-request's "approved" (PSBT sign-off)
// staying stuck could mean a signing task silently failed, which we still want flagged.
const PASSIVE_WAITING_STATES = new Set([
  "pr-lifecycle:issue-opened",
  "pr-lifecycle:changes-requested",
  // Arc's review is done, waiting on an external maintainer to merge — the sensor
  // deliberately does not auto-transition on merge (see workflow context
  // `reason: "externally-pending"`). Weeks-long waits here are normal, not stuck.
  "pr-lifecycle:approved",
  // Holds until the T+30d course-candidacy cadence gate opens (ContentCalendarMachine).
  // A month-long wait is the intended cadence, not stuck.
  "content-calendar:public_forum_teaser",
]);

// Templates whose intended full cycle spans many days, so at any instant most
// instances are legitimately mid-pipeline rather than complete. A raw
// `completionRate < 70` snapshot flags these as "unhealthy" every review cycle
// even when 0 instances are stuck or stale (see task #21122 / #21107). Stuck-state
// and stale-count checks still apply — only the raw completion-rate threshold is
// waived. Same rationale as PASSIVE_WAITING_STATES, at template granularity.
// content-calendar is a 30-day multi-hop pipeline:
// whop_chat(T+2h) -> whop_forum(T+2d) -> public_forum_teaser(T+4d) -> course_candidate(T+30d).
const LONG_CADENCE_TEMPLATES = new Set([
  "content-calendar",
]);

const log = createSensorLogger(SENSOR_NAME);

/** Known process patterns that already have workflow templates or dedicated sensors. */
const KNOWN_PATTERNS = new Set([
  "blog-posting",
  "signal-filing",
  "beat-claiming",
  "pr-lifecycle",
  "reputation-feedback",
  "validation-request",
  "inscription",
  // Sensor sources with established handling (no workflow needed — they're atomic)
  "sensor:aibtc-heartbeat",
  "sensor:arc-service-health",
  "sensor:arc-memory-consolidate",
  // Daily self-eval → ad-hoc "Retrospective: extract learnings" chain. Same shape as
  // sensor:arc-purpose-eval, already evaluated task #20645/#21036 — a generic
  // RetrospectiveMachine was rejected, ad-hoc per-task retrospectives self-dedup by
  // construction. See memory/shared/entries/retrospective-pattern-no-generic-machine-needed.md.
  "sensor:arc-strategy-review",
  // arc-purpose-eval itself was evaluated task #21036 with the same verdict. Listed here
  // as a bare "sensor:X" entry — isKnownPattern() below treats these as prefixes, so any
  // suffixed variant (e.g. ":followup") is covered automatically without a separate entry.
  "sensor:arc-purpose-eval",
  // Already fully modeled by EmailThreadMachine (received→triaged→reply_pending→completed),
  // wired into skills/arc-email-sync/sensor.ts (insertWorkflow per thread). Not a gap —
  // this is the machine working as intended (task #21317). Bare entry so any suffixed
  // variant (e.g. ":thread") is covered via prefix matching.
  "sensor:arc-email-sync",
  // Ad-hoc "Generate <category> blog post draft" -> "Publish generated blog post" ->
  // retrospective chain. Evaluated 2026-07-04 (task #20645 addendum) as the ":draft"
  // suffix variant and rejected (deliberately bounded, self-dedup'd 2-task chain, too
  // small for a state machine). Recurring 2026-07-07 (task #21516) under the
  // ":content-generation" suffix — same underlying sensor (skills/blog-publishing/
  // sensor.ts), same verdict. Bare entry so future suffix variants are covered too.
  "sensor:blog-publishing",
  // Ad-hoc "Watch report — <timestamp>" -> retrospective chain (task #21579), avg 2.4
  // steps, skills arc-reporting + arc-skill-manager — same already-rejected ad-hoc
  // retrospective shape as retrospective-pattern-no-generic-machine-needed.md. Bare entry
  // so ":interior-<timestamp>" and other suffix variants are covered too.
  "sensor:arc-reporting-watch",
  // "Review 1 blocked task(s) for possible unblock" -> retrospective chain (task #21777),
  // avg 3.0 steps, skills arc-blocked-review + whop + arc-skill-manager + arc-brand-voice +
  // whop-sales + social-x-posting — same already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md (scheduleRetrospective() in
  // src/dispatch.ts fires after every completed task; the skill variety just reflects
  // which lane a given blocked task happened to belong to, not a distinct process).
  // Bare entry so suffix variants are covered too.
  "sensor:arc-blocked-review",
  // "Draft Arc's next amplified article — Article N" -> retrospective chain (task #21912,
  // 3 recurrences, avg 2.7 steps), surfacing via SOURCE-grouping this time
  // ("sensor:arc-article-pipeline:v2") rather than the subject-grouping already exempted
  // above ("draft arc's next amplified article", line ~179). Same underlying tasks, same
  // already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md — arc-article-pipeline's own
  // article_queue_log already tracks draft->stage->publish with idempotent resume, so a
  // second generic workflow would duplicate that, not add value. Bare entry so the ":v2"
  // and future suffix variants are covered too.
  "sensor:arc-article-pipeline",
  // "Regenerate and deploy skills/sensors catalog" -> retrospective chain (task #21912,
  // 3 recurrences, avg 2.0 steps), skills arc-catalog + blog-deploy + arc-skill-manager —
  // same already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md (scheduleRetrospective() fires
  // after every completed task above the cost/priority threshold; the deploy step is a
  // single atomic regen+publish action, not a multi-stage process needing dedup).
  "sensor:arc-catalog",
  // "Triage: X research batch (...)" -> N per-story "Research: ..." tasks + retrospective
  // chain (task #22896, 3 recurrences, avg 10.0 steps — inflated by the fan-out width, not
  // process depth). Verified via direct task-chain inspection (#22828/#22703/#22614): each
  // triage root fans out flat (root -> research subtask x N -> retrospective), no branching,
  // no gating, no cross-instance coordination — already the intended shape of
  // candidate-maturation's batching fix (see memory/shared/entries/
  // arc-link-research-dedup-measurement.md). Same already-rejected ad-hoc retrospective
  // shape as retrospective-pattern-no-generic-machine-needed.md; a state machine would add
  // bookkeeping, not value. Bare entry so ":triage:<timestamp>" suffix variants are covered.
  "sensor:candidate-maturation",
  // "Package a research report into a Whop SKU — <report>" -> retrospective chain
  // (task #23118, 3 recurrences, avg 2.3 steps, skills arc-packaging + arc-skill-manager) —
  // same already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md. arc-packaging already has its own
  // deterministic 3-step contract (materials -> draft -> stage, see
  // skills/arc-packaging/SKILL.md) with idempotent resume via packaging_queue_log; a second
  // generic workflow would duplicate that state tracking, not add value. Bare entry so
  // ":<timestamp>" suffix variants are covered too.
  "sensor:arc-packaging",
  // "Security: <pkg> (<severity>) in aibtcdev/landing-page" -> retrospective chain
  // (task #24051, 3 recurrences, avg 2.3 steps, skills github-security-alerts +
  // arc-skill-manager) — same already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md. Each alert is atomic (single
  // repo/package/severity, no branching or cross-alert coordination); the sensor already
  // groups multi-CVE alerts per patterns.md's "CVE same repo: group + assess once" rule.
  // Bare entry so future repo/package suffix variants are covered too.
  "sensor:github-security-alerts",
  // Generic sources that aren't meaningful patterns
  "unknown",
  "task:*",
]);

/**
 * Matches a normalized source against KNOWN_PATTERNS. Bare "sensor:X" entries (exactly
 * two colon-separated parts) act as prefixes: they match "sensor:X" itself and any
 * suffixed variant "sensor:X:*". This prevents the recurring failure where a sensor
 * source gets re-flagged every time it's used with a new suffix (e.g. ":followup",
 * ":thread") even though the base sensor was already evaluated and exempted.
 * See memory/shared/entries/retrospective-pattern-no-generic-machine-needed.md.
 */
function isKnownPattern(src: string): boolean {
  if (KNOWN_PATTERNS.has(src)) return true;
  for (const pattern of KNOWN_PATTERNS) {
    if (!pattern.startsWith("sensor:")) continue;
    if (pattern.split(":").length !== 2) continue;
    if (src.startsWith(`${pattern}:`)) return true;
  }
  return false;
}

/** Source prefixes to skip — human-initiated tasks are inherently varied. */
const SKIP_SOURCE_PREFIXES = ["human:"];

// Source prefixes emitted by workflow state machines (state-machine.ts insertTask calls,
// e.g. `content-calendar:${slug}:course`, `publish-fanout:${slug}:whop-forum`). Each hop's
// slug/suffix varies per work-piece, so these never group under bySource (normalizeSource
// leaves the unique slug in place), but they DO collapse under bySubject grouping since the
// task subject text is identical across hops — surfacing as a false-positive "unmodeled
// pattern" even though the chain is already produced by an existing workflow transition
// (see task #22799: 'assess course candidacy' flagged as unmodeled despite being
// ContentCalendarMachine's terminal course_candidate state, state-machine.ts:874-909).
const WORKFLOW_SOURCE_PREFIXES = [
  "content-calendar:",
  "publish-fanout:",
  "pr-review:",
  "quest:",
  "retrospective:",
];

function isWorkflowEmittedSource(source: string | null): boolean {
  if (!source) return false;
  return WORKFLOW_SOURCE_PREFIXES.some((p) => source.startsWith(p));
}

const KNOWN_SUBJECT_PREFIXES = [
  "[github-issue-monitor]",
  "for re-review",
  // Already modeled by SiteHealthAlertMachine (alert→fixing→retrospective_pending→completed).
  // Falls through source-grouping because each instance's source is a unique "workflow:<id>",
  // so it only ever surfaces via subject-grouping — this is the machine working as intended.
  "fix arc0btc.com health issue",
  // Already modeled by HealthAlertMachine (acknowledging→retrospective_pending→completed,
  // state-machine.ts:2191-2238, isOauthExpiring handling at line 2207). Falls through
  // source-grouping because each instance's source is a unique "workflow:<id>", same
  // source-uniqueness reasoning as the SiteHealthAlertMachine entry above — this is the
  // machine working as intended, not a gap (task #25257, 3 recurrences, avg 2.7 steps,
  // oauth-expiring alert type).
  "health alert",
  // Already modeled by SelfReviewCycleMachine; the "self-review triage" sub-chain was
  // separately evaluated (task #21036) and confirmed as the same ad-hoc retrospective
  // shape, no generic machine needed.
  "self-review",
  // Ad-hoc "Assess release: <repo> <tag>" → retrospective chain (task #21317), avg 2.0
  // steps, single skill (arc-skill-manager) — same already-rejected shape as
  // retrospective-pattern-no-generic-machine-needed.md.
  "assess release",
  // Already fully modeled by EmailThreadMachine (received→triaged→reply_pending→completed).
  // Same underlying tasks as the "sensor:arc-email-sync" source exemption above (task
  // #21317) — this is the subject-grouped view of the identical chains, not a new gap
  // (task #21390).
  "email from",
  // Ad-hoc daily-eval → retrospective chain, same shape already evaluated and rejected
  // for "sensor:arc-purpose-eval" (task #21036/#21317). Subject-grouped view of the same
  // tasks, not new (task #21390).
  "purpose eval",
  // Content-calendar's whop-chat hop (ContentCalendarMachine) followed by the standard
  // ad-hoc "Retrospective: extract learnings" chain — same already-rejected shape as
  // retrospective-pattern-no-generic-machine-needed.md, not new (task #21390).
  "seed whop chat",
  // "Review PR #N on aibtcdev/agent-news: <title>" -> retrospective, avg 2.0 steps,
  // single skill pair (aibtc-repo-maintenance + arc-skill-manager) — same already-rejected
  // ad-hoc retrospective shape, just a per-repo PR review variant (task #21516).
  "review pr #",
  // "Email watch report to whoabuddy" -> retrospective chain (task #21579), avg 2.0 steps,
  // arc-email-sync + arc-skill-manager. Source is "workflow:<id>:emailing" (unique per
  // instance, so it never dedups via source-grouping) — same already-rejected ad-hoc
  // retrospective shape as retrospective-pattern-no-generic-machine-needed.md.
  "email watch report to whoabuddy",
  // "Post public-forum teaser: <title>" -> retrospective chain (task #21657), avg 2.0
  // steps, whop + arc-brand-voice + arc-skill-manager — same already-rejected ad-hoc
  // retrospective shape as retrospective-pattern-no-generic-machine-needed.md.
  "post public-forum teaser",
  // "Draft Arc's next amplified article — Article N" -> retrospective chain (task
  // #21657), avg 2.7 steps. The multi-step depth here isn't ad-hoc slack — it's already
  // a formal state machine of its own: arc-article-pipeline's `article_queue_log` table
  // (post_id/staged_at claim-resume, see cli.ts) tracks draft->stage->publish with
  // idempotent resume. A second generic workflow template would duplicate that tracking,
  // not add value.
  "draft arc's next amplified article",
  // "Package a research report into a Whop SKU — <file>" -> retrospective chain (task
  // #21657), avg 2.0 steps, arc-packaging + arc-skill-manager — same already-rejected
  // ad-hoc retrospective shape as retrospective-pattern-no-generic-machine-needed.md.
  "package a research report into a whop sku",
  // "Thread whop forum teardown: <title>" -> retrospective chain (task #21724, 9
  // recurrences). Already modeled: ContentCalendarMachine's whop_forum hop
  // (source `content-calendar:<slug>:whop-forum`) and PublishFanoutMachine's whop_forum
  // hop (source `publish-fanout:<slug>:whop-forum`) both emit this exact subject
  // (state-machine.ts lines ~413, ~786), followed by the standard ad-hoc retrospective —
  // same already-rejected shape as retrospective-pattern-no-generic-machine-needed.md, not
  // a new pattern. Falls through source-grouping because each hop's source is unique
  // per work-piece slug, so it only ever surfaces via subject-grouping.
  "thread whop forum teardown",
  // "Post X thread: <title>" (and its "Post X (single tweet): <title>" chaining-disabled
  // variant — normalizeRootSubject strips the parenthetical AND the trailing ": <title>",
  // so both collapse to the same "post x" key) -> retrospective chain (task #21724, 7
  // recurrences). Already modeled: ContentCalendarMachine's x_thread hop (source
  // `content-calendar:<slug>:x`, state-machine.ts line ~755) followed by the standard
  // ad-hoc retrospective — same already-rejected shape as
  // retrospective-pattern-no-generic-machine-needed.md, not a new pattern. Same
  // source-uniqueness reasoning as the whop-forum entry above. Prefix (not exact match)
  // so "post x" alone covers both variants via startsWith.
  "post x",
  // "Research: ecosystem signal — matured candidate (...)" -> retrospective chain (task
  // #22590), avg 2.3 steps, arc-link-research + arc-skill-manager + candidate-maturation.
  // Same already-rejected ad-hoc "task closes -> Retrospective: extract learnings from
  // task #N" shape as retrospective-pattern-no-generic-machine-needed.md — root task
  // subjects vary per matured candidate so it only surfaces via subject-grouping, not a
  // new pattern.
  "research",
  // "Whop free-forum digest [<date>]: syndicate Arc status into the Public forum" ->
  // retrospective chain (task #22896, 3 recurrences, avg 2.0 steps), whop + arc-brand-voice
  // + arc-skill-manager. Source is "sensor:whop-free-forum:<date>" (unique per day, so it
  // never dedups via source-grouping) — verified via direct chain inspection
  // (#22121/#22200/#22810): each digest is a single atomic post-then-retrospective, no
  // branching or gating. Same already-rejected ad-hoc retrospective shape as
  // retrospective-pattern-no-generic-machine-needed.md.
  "whop free-forum digest",
  // "sensor:context-review" -> "Retrospective: extract learnings from task #N" chain
  // (task #23043, 3 recurrences, avg 2.0 steps), context-review + arc-skill-manager.
  // context-review's own findings-review task is atomic (audit skill coverage on recent
  // tasks, no branching/gating) followed by the standard ad-hoc retrospective — same
  // already-rejected shape as retrospective-pattern-no-generic-machine-needed.md, not a
  // new pattern requiring a dedicated state machine.
  "sensor:context-review",
];

function normalizeSource(source: string | null): string {
  if (!source) return "unknown";
  if (source.startsWith("task:")) return "task:*";
  const parts = source.split(":");
  if (parts.length > 3) return parts.slice(0, 3).join(":");
  return source;
}

function normalizeRootSubject(subject: string): string {
  return (
    subject
      .toLowerCase()
      .replace(/\s*[—–]\s*.*/g, "")
      .replace(/\s*\(.*\)/g, "")
      .replace(/\s*:\s*.*/g, "")
      .replace(/\d{4}-\d{2}-\d{2}[T\s]?\d{2}:\d{2}(:\d{2})?Z?/g, "")
      .replace(/\b[a-f0-9]{7,40}\b/g, "")
      .replace(/\b\d+\b/g, "")
      .replace(/\bfrom\s+\w+(\s+\w)?/g, "from")
      .replace(/\s+/g, " ")
      .trim()
  );
}

interface ChainInfo {
  rootId: number;
  rootSubject: string;
  rootSource: string | null;
  childCount: number;
  childSubjects: string[];
  skills: Set<string>;
}

function buildChainInfos(tasks: Task[]): ChainInfo[] {
  const byId = new Map<number, Task>();
  for (const t of tasks) byId.set(t.id, t);

  const childrenOf = new Map<number, Task[]>();
  for (const t of tasks) {
    if (t.parent_id && byId.has(t.parent_id)) {
      const children = childrenOf.get(t.parent_id) ?? [];
      if (!children.some((c) => c.id === t.id)) {
        children.push(t);
        childrenOf.set(t.parent_id, children);
      }
    }
    if (t.source?.startsWith("task:")) {
      const parentId = parseInt(t.source.slice(5), 10);
      if (!isNaN(parentId) && byId.has(parentId) && parentId !== t.id) {
        const children = childrenOf.get(parentId) ?? [];
        if (!children.some((c) => c.id === t.id)) {
          children.push(t);
          childrenOf.set(parentId, children);
        }
      }
    }
  }

  const isChild = new Set<number>();
  for (const children of childrenOf.values()) {
    for (const c of children) isChild.add(c.id);
  }

  function collectDescendants(parentId: number): Task[] {
    const direct = childrenOf.get(parentId) ?? [];
    const all: Task[] = [...direct];
    for (const c of direct) all.push(...collectDescendants(c.id));
    return all;
  }

  const chains: ChainInfo[] = [];
  for (const t of tasks) {
    if (isChild.has(t.id)) continue;
    const descendants = collectDescendants(t.id);
    if (descendants.length === 0) continue;

    const skills = new Set<string>();
    for (const d of [t, ...descendants]) {
      if (d.skills) {
        try {
          const parsed = JSON.parse(d.skills) as string[];
          for (const s of parsed) skills.add(s);
        } catch {
          // ignore
        }
      }
    }

    chains.push({
      rootId: t.id,
      rootSubject: t.subject,
      rootSource: t.source,
      childCount: descendants.length,
      childSubjects: descendants.slice(0, 5).map((d) => d.subject),
      skills,
    });
  }

  return chains;
}

interface DetectedPattern {
  key: string;
  description: string;
  recurrences: number;
  avgSteps: number;
  examples: string[];
  childExamples: string[];
  involvedSkills: string[];
}

function detectPatterns(chains: ChainInfo[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  const bySource = new Map<string, ChainInfo[]>();
  for (const chain of chains) {
    const src = normalizeSource(chain.rootSource);
    const sourceGroup = bySource.get(src) ?? [];
    sourceGroup.push(chain);
    bySource.set(src, sourceGroup);
  }

  for (const [src, group] of bySource) {
    if (group.length < MIN_RECURRENCES) continue;
    if (isKnownPattern(src)) continue;
    if (SKIP_SOURCE_PREFIXES.some((p) => src.startsWith(p))) continue;

    const avgSteps =
      group.reduce((sum, c) => sum + 1 + c.childCount, 0) / group.length;
    const allSkills = new Set<string>();
    for (const c of group) {
      for (const s of c.skills) allSkills.add(s);
    }

    patterns.push({
      key: `source:${src}`,
      description: `Tasks from "${src}" consistently spawn follow-up chains`,
      recurrences: group.length,
      avgSteps,
      examples: group.slice(0, 3).map((c) => c.rootSubject),
      childExamples: group
        .flatMap((c) => c.childSubjects.slice(0, 1))
        .slice(0, 3),
      involvedSkills: [...allSkills],
    });
  }

  const bySubject = new Map<string, ChainInfo[]>();
  for (const chain of chains) {
    const key = normalizeRootSubject(chain.rootSubject);
    if (key.length < 3) continue;
    const subjectGroup = bySubject.get(key) ?? [];
    subjectGroup.push(chain);
    bySubject.set(key, subjectGroup);
  }

  for (const [subj, group] of bySubject) {
    if (group.length < MIN_RECURRENCES) continue;
    const src = normalizeSource(group[0].rootSource);
    if (patterns.some((p) => p.key === `source:${src}`)) continue;
    if (isKnownPattern(src)) continue;
    if (KNOWN_SUBJECT_PREFIXES.some((p) => subj.startsWith(p))) continue;
    // Every root in this subject group came from a workflow-driven hop (e.g. each
    // course-candidate task's source is `content-calendar:<unique-slug>:course`) — the
    // chain is already modeled by that workflow's state machine, the subject text just
    // happens to be identical across work-pieces. Not an unmodeled pattern.
    if (group.every((c) => isWorkflowEmittedSource(c.rootSource))) continue;

    const avgSteps =
      group.reduce((sum, c) => sum + 1 + c.childCount, 0) / group.length;
    const allSkills = new Set<string>();
    for (const c of group) {
      for (const s of c.skills) allSkills.add(s);
    }

    patterns.push({
      key: `subject:${subj}`,
      description: `"${subj}" tasks consistently create follow-up chains`,
      recurrences: group.length,
      avgSteps,
      examples: group.slice(0, 3).map((c) => c.rootSubject),
      childExamples: group
        .flatMap((c) => c.childSubjects.slice(0, 1))
        .slice(0, 3),
      involvedSkills: [...allSkills],
    });
  }

  patterns.sort((a, b) => b.recurrences * b.avgSteps - a.recurrences * a.avgSteps);
  return patterns;
}

function patternAlreadyModeled(patternKey: string): boolean {
  const candidates: string[] = [];

  if (patternKey.startsWith("source:")) {
    const parts = patternKey.slice("source:".length).split(":");
    const meaningful = parts.filter((p) => p && p !== "sensor");
    for (const part of meaningful) {
      candidates.push(part);
      if (part.startsWith("arc-")) candidates.push(part.slice(4));
    }
    for (let i = 0; i < meaningful.length - 1; i++) {
      const a = meaningful[i];
      const b = meaningful[i + 1];
      candidates.push(`${a}-${b}`);
      if (a.startsWith("arc-")) candidates.push(`${a.slice(4)}-${b}`);
    }
  } else if (patternKey.startsWith("subject:")) {
    const subject = patternKey.slice("subject:".length);
    candidates.push(subject.replace(/\s+/g, "-"));
    const firstWord = subject.split(/[\s-]+/)[0];
    if (firstWord && firstWord.length > 2) candidates.push(firstWord);
  }

  return candidates.some((name) => getTemplateByName(name) !== null);
}

// --- Pass 1: Template Health Evaluation ---

interface TemplateHealth {
  template: string;
  total: number;
  completed: number;
  stale: number;
  active: number;
  completionRate: number;
  lastActivity: string | null;
  stuckStates: string[]; // non-terminal states with instances stuck >7d
}

function evaluateTemplateHealth(db: ReturnType<typeof getDatabase>): {
  health: TemplateHealth[];
  staleCount: number;
  orphanCount: number;
} {
  // Get all workflow stats grouped by template
  const rows = db
    .query(
      `SELECT
        template,
        current_state,
        count(*) as cnt,
        max(last_progress_at) as last_update,
        sum(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) as completed_cnt,
        sum(CASE WHEN completed_at IS NULL AND last_progress_at < datetime('now', '-7 days') THEN 1 ELSE 0 END) as stuck_cnt,
        sum(CASE WHEN completed_at IS NULL AND last_progress_at < datetime('now', '-${STALE_WORKFLOW_DAYS} days') THEN 1 ELSE 0 END) as stale_cnt
      FROM workflows
      GROUP BY template, current_state
      ORDER BY template, cnt DESC`
    )
    .all() as Array<{
      template: string;
      current_state: string;
      cnt: number;
      last_update: string;
      completed_cnt: number;
      stuck_cnt: number;
      stale_cnt: number;
    }>;

  // Aggregate by template
  const byTemplate = new Map<string, TemplateHealth>();
  let totalStale = 0;
  let orphanCount = 0;

  for (const row of rows) {
    // Check if template is registered
    const isRegistered = getTemplateByName(row.template) !== null;
    if (!isRegistered) {
      orphanCount += row.cnt;
      continue;
    }

    const existing = byTemplate.get(row.template) ?? {
      template: row.template,
      total: 0,
      completed: 0,
      stale: 0,
      active: 0,
      completionRate: 0,
      lastActivity: null,
      stuckStates: [],
    };

    existing.total += row.cnt;
    existing.completed += row.completed_cnt;
    existing.stale += row.stale_cnt;
    existing.active += row.cnt - row.completed_cnt;
    totalStale += row.stale_cnt;

    if (!existing.lastActivity || row.last_update > existing.lastActivity) {
      existing.lastActivity = row.last_update;
    }

    if (
      row.stuck_cnt > 0 &&
      row.completed_cnt === 0 &&
      !PASSIVE_WAITING_STATES.has(`${row.template}:${row.current_state}`)
    ) {
      existing.stuckStates.push(`${row.current_state} (${row.stuck_cnt})`);
    }

    byTemplate.set(row.template, existing);
  }

  // Calculate completion rates
  for (const h of byTemplate.values()) {
    h.completionRate = h.total > 0 ? (h.completed / h.total) * 100 : 0;
  }

  return {
    health: [...byTemplate.values()].sort((a, b) => a.completionRate - b.completionRate),
    staleCount: totalStale,
    orphanCount,
  };
}

// --- Auto-stale: close workflows past TTL ---

function autoStaleWorkflows(db: ReturnType<typeof getDatabase>): number {
  const result = db
    .query(
      `UPDATE workflows
       SET current_state = 'closed-stale', completed_at = datetime('now')
       WHERE completed_at IS NULL
         AND current_state != 'closed-stale'
         AND last_progress_at < datetime('now', '-${STALE_WORKFLOW_DAYS} days')`
    )
    .run();
  return result.changes;
}

export default async function workflowReviewSensor(): Promise<string> {
  const statePre = await readHookState(SENSOR_NAME);
  const proposedKeys: string[] = (statePre?.proposed_keys as string[]) ?? [];

  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  if (pendingTaskExistsForSource(TASK_SOURCE)) {
    log("pending review task exists — skipping");
    return "skip";
  }

  const hookState = await readHookState(SENSOR_NAME);
  const db = getDatabase();

  // --- Auto-stale enforcement ---
  const staleClosed = autoStaleWorkflows(db);
  if (staleClosed > 0) {
    log(`auto-stale: closed ${staleClosed} workflow(s) past ${STALE_WORKFLOW_DAYS}-day TTL`);
  }

  // --- Pass 1: Template health evaluation ---
  const { health, staleCount, orphanCount } = evaluateTemplateHealth(db);

  const unhealthy = health.filter(
    (h) =>
      (h.completionRate < 70 && !LONG_CADENCE_TEMPLATES.has(h.template)) ||
      h.stuckStates.length > 0 ||
      h.stale > 0
  );
  const unused = health.filter((h) => h.total === 0);

  log(`template health: ${health.length} templates, ${unhealthy.length} unhealthy, ${orphanCount} orphan rows`);

  // --- Pass 2: Pattern detection (existing logic) ---
  const tasks = db
    .query(
      `SELECT * FROM tasks
       WHERE status = 'completed'
         AND completed_at > datetime('now', '-${LOOKBACK_DAYS} days')
       ORDER BY completed_at DESC`
    )
    .all() as Task[];

  log(`analyzing ${tasks.length} completed tasks from last ${LOOKBACK_DAYS} days`);

  let unmodeled: DetectedPattern[] = [];
  if (tasks.length >= 10) {
    const chains = buildChainInfos(tasks);
    log(`found ${chains.length} task chains with children`);

    const patterns = detectPatterns(chains);
    const novel = patterns.filter((p) => !proposedKeys.includes(p.key));
    unmodeled = novel.filter((p) => !patternAlreadyModeled(p.key));
    log(`${unmodeled.length} unmodeled patterns after filtering`);
  }

  // --- Decide whether to create a task ---
  const hasHealthIssues = unhealthy.length > 0 || orphanCount > 0;
  const hasNewPatterns = unmodeled.length > 0;

  if (!hasHealthIssues && !hasNewPatterns) {
    log("no health issues or new patterns — skipping");
    if (proposedKeys.length > 0 && hookState) {
      await writeHookState(SENSOR_NAME, { ...hookState, proposed_keys: proposedKeys });
    }
    return "ok";
  }

  // --- Build task description ---
  const lines: string[] = [];
  let subject = "";

  if (hasHealthIssues) {
    lines.push("# Workflow System Health\n");

    if (staleClosed > 0) {
      lines.push(`Auto-stale: ${staleClosed} workflow(s) closed past ${STALE_WORKFLOW_DAYS}-day TTL this cycle.\n`);
    }

    if (orphanCount > 0) {
      lines.push(`## Orphan Workflows: ${orphanCount} rows`);
      lines.push(`Workflows using template names not registered in state-machine.ts. These can never advance.`);
      lines.push(`Action: bulk-close as \`closed-stale\` via \`arc skills run --name arc-workflows -- delete\` or direct SQL.\n`);
    }

    if (unhealthy.length > 0) {
      lines.push("## Template Health Report\n");
      lines.push("| Template | Total | Completed | Rate | Active | Stale | Stuck States | Last Activity |");
      lines.push("|----------|-------|-----------|------|--------|-------|-------------|---------------|");
      for (const h of unhealthy) {
        lines.push(
          `| ${h.template} | ${h.total} | ${h.completed} | ${h.completionRate.toFixed(0)}% | ${h.active} | ${h.stale} | ${h.stuckStates.join(", ") || "—"} | ${h.lastActivity?.slice(0, 10) ?? "never"} |`
        );
      }
      lines.push("");
      lines.push("**Actions to consider:**");
      lines.push("- Templates with <70% completion rate: investigate failure patterns, fix or simplify the state machine");
      lines.push("- Templates with stuck instances: transition or close stuck workflows");
      lines.push("- Templates with stale instances: close as stale or fix the advancement path");
      lines.push("");
    }
  }

  if (hasNewPatterns) {
    lines.push("# New Patterns Detected\n");
    lines.push(`${unmodeled.length} repeating multi-step process(es) not yet modeled as workflow state machines.\n`);
    lines.push("For each pattern, evaluate whether a formal state machine would add value.");
    lines.push("If yes, design the template in skills/arc-workflows/state-machine.ts and register in getTemplateByName().\n");

    for (const pattern of unmodeled.slice(0, 5)) {
      lines.push(`## ${pattern.key}`);
      lines.push(`${pattern.description}`);
      lines.push(`- Recurrences: ${pattern.recurrences}`);
      lines.push(`- Avg steps per chain: ${pattern.avgSteps.toFixed(1)}`);
      lines.push(`- Skills involved: ${pattern.involvedSkills.join(", ") || "none"}`);
      lines.push(`- Root examples: ${pattern.examples.join("; ")}`);
      lines.push(`- Child examples: ${pattern.childExamples.join("; ")}`);
      lines.push("");
    }
  }

  // Build subject line
  const parts: string[] = [];
  if (hasHealthIssues) {
    const issues = unhealthy.length + (orphanCount > 0 ? 1 : 0);
    parts.push(`${issues} health issue(s)`);
  }
  if (hasNewPatterns) {
    parts.push(`${unmodeled.length} new pattern(s)`);
  }
  subject = `workflow review — ${parts.join(", ")}`;

  insertTask({
    subject,
    description: lines.join("\n"),
    skills: '["arc-workflows", "arc-skill-manager"]',
    source: TASK_SOURCE,
    priority: 7,
    model: "sonnet",
  });

  // Record proposed keys
  const updatedKeys = [
    ...unmodeled.map((p) => p.key),
    ...proposedKeys.slice(0, 20),
  ];

  const stateToWrite = hookState
    ? { ...hookState, proposed_keys: updatedKeys }
    : {
        last_ran: new Date().toISOString(),
        last_result: "ok",
        version: 1,
        consecutive_failures: 0,
        proposed_keys: updatedKeys,
      };

  await writeHookState(SENSOR_NAME, stateToWrite as Parameters<typeof writeHookState>[1]);

  log(`created review task: ${subject}`);
  return "ok";
}
