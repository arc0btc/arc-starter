// arc-reputation/sensor.ts
//
// Scans completed tasks for reputation-eligible interactions and queues
// review submission tasks. Runs every 30 minutes. Pure TypeScript — no LLM.
//
// Detection strategy:
// 1. Query completed tasks since last scan
// 2. Cross-reference task subjects/descriptions/sources with known contacts
// 3. Filter for interactions that merit a signed peer review
// 4. Queue a review task per eligible interaction (deduped by source key)
//
// Eligible interactions (substantive only):
// - PR reviews/merges involving known agents
// - x402 paid message exchanges / STX transfers
// NOT eligible: passing mentions, inbox messages, vague collaboration

import {
  claimSensorRun,
  createSensorLogger,
  readHookState,
  writeHookState,
} from "../../src/sensors.ts";
import { getDatabase, recentTaskExistsForSource, insertTask } from "../../src/db.ts";
import { initContactsSchema, type Contact } from "../contacts/schema.ts";


const SENSOR_NAME = "reputation-tracker";
const INTERVAL_MINUTES = 30;
const TASK_SOURCE_PREFIX = "sensor:reputation-tracker";
const LOOKBACK_HOURS = 2; // scan window — overlaps slightly with interval for safety
const MAX_REVIEWS_PER_DAY = 10;
const MAX_REVIEWS_PER_RUN = 3; // per-run cap to prevent burst spam

// Internal sources that should never trigger reputation reviews
const INTERNAL_SOURCE_PREFIXES = [
  "sensor:arc-alive-check",
  "sensor:arc-service-health",
  "workflow:",
];

// Internal subject patterns that are operational noise, not real interactions
const INTERNAL_SUBJECT_PATTERNS: RegExp[] = [];

const log = createSensorLogger(SENSOR_NAME);

const REVIEW_DEDUP_DAYS = 7;

// ---- Types ----

interface CompletedTask {
  id: number;
  subject: string;
  description: string | null;
  skills: string | null;
  source: string | null;
  result_summary: string | null;
  completed_at: string;
}

interface EligibleInteraction {
  task_id: number;
  task_subject: string;
  contact_id: number;
  contact_name: string;
  contact_btc_address: string | null;
  interaction_type: string; // "pr-review" | "x402-exchange" | "collaboration" | "mention"
}

// ---- Helpers ----

/** Build a set of searchable tokens for a contact (lowercased). */
function buildContactTokens(contact: Contact): string[] {
  const tokens: string[] = [];
  if (contact.display_name) tokens.push(contact.display_name.toLowerCase());
  if (contact.aibtc_name) tokens.push(contact.aibtc_name.toLowerCase());
  if (contact.bns_name) tokens.push(contact.bns_name.toLowerCase());
  if (contact.x_handle) tokens.push(contact.x_handle.toLowerCase());
  if (contact.github_handle) tokens.push(contact.github_handle.toLowerCase());
  if (contact.stx_address) tokens.push(contact.stx_address.toLowerCase());
  if (contact.btc_address) tokens.push(contact.btc_address.toLowerCase());
  if (contact.agent_id) tokens.push(contact.agent_id.toLowerCase());
  return tokens.filter((t) => t.length >= 3); // skip very short tokens
}

/**
 * Validate that the contact is actually involved in the interaction — not just a
 * coincidental token match. Applies a stricter identity check per interaction type:
 *
 * - pr-review:    contact.github_handle must appear in the task text. PR authors/reviewers
 *                 are identified by GitHub handle. No handle = no match.
 * - x402-exchange: contact btc_address or stx_address must appear. Financial transactions
 *                 are identified by on-chain addresses.
 *
 * This guard prevents the "Halcyon Wolf on tfireubs-ui's PR" false-positive class, where a
 * contact's display_name or aibtc_name happened to appear in an unrelated PR title or subject.
 */
function isContactActuallyInvolved(
  contact: Contact,
  interactionType: string,
  searchText: string,
): boolean {
  switch (interactionType) {
    case "pr-review":
      // GitHub handle is the definitive PR author/reviewer identifier
      if (!contact.github_handle) return false;
      return searchText.includes(contact.github_handle.toLowerCase());
    case "x402-exchange":
      // On-chain address is the definitive transaction party identifier
      if (contact.btc_address && searchText.includes(contact.btc_address.toLowerCase())) return true;
      if (contact.stx_address && searchText.includes(contact.stx_address.toLowerCase())) return true;
      return false;
    default:
      return false;
  }
}

/**
 * Classify the interaction type based on task signals.
 * Returns null if the task doesn't represent a meaningful interaction worthy of review.
 *
 * Substantive interactions only:
 * - Economic exchange (x402 paid messages, STX transfers)
 * - Code PR merge/review
 * - Explicit outcome (completed deliverable with verifiable result)
 *
 * NOT substantive: passing mentions, internal escalations, inbox messages,
 * vague "collaboration" references.
 */
function classifyInteraction(task: CompletedTask): string | null {
  const text = `${task.subject} ${task.source ?? ""}`.toLowerCase();
  // Code PR merge or review — verifiable on-chain/GitHub interaction
  if (text.includes("pr review") || text.includes("pull request") || text.includes("code review") || text.includes("pr merge")) {
    return "pr-review";
  }
  // Economic exchange — paid messages, STX transfers
  if (text.includes("x402") || text.includes("paid message") || text.includes("stx transfer") || text.includes("stx payment")) {
    return "x402-exchange";
  }
  // No recognized substantive signal
  return null;
}

/** Load active agent contacts with at least one address. */
function loadAgentContacts(): Contact[] {
  const db = initContactsSchema();
  return db
    .query(
      `SELECT * FROM contacts
       WHERE type = 'agent'
         AND status = 'active'
         AND (btc_address IS NOT NULL OR stx_address IS NOT NULL)`
    )
    .all() as Contact[];
}

/** Get completed tasks within the lookback window. */
function getRecentCompletedTasks(): CompletedTask[] {
  const db = getDatabase();
  return db
    .query(
      `SELECT id, subject, description, skills, source, result_summary, completed_at
       FROM tasks
       WHERE status = 'completed'
         AND completed_at > datetime('now', '-${LOOKBACK_HOURS} hours')
       ORDER BY completed_at DESC
       LIMIT 100`
    )
    .all() as CompletedTask[];
}

/** Check if we already queued or submitted a review for this task+contact pair. */
function alreadyTracked(taskId: number, contactId: number, reviewedKeys: Set<string>): boolean {
  return reviewedKeys.has(`${taskId}:${contactId}`);
}

// ---- Main sensor ----


/** Check if a contact was already reviewed within the dedup window. */
function wasRecentlyReviewed(contactName: string, contactBtcAddress: string | null): boolean {
  const db = getDatabase();
  const cutoff = new Date(Date.now() - REVIEW_DEDUP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Check tasks table for recent review submissions targeting this contact
  const result = db.query(
    `SELECT COUNT(*) as c FROM tasks
     WHERE source LIKE '${TASK_SOURCE_PREFIX}:%'
       AND subject LIKE '%${contactName.replace(/'/g, "''")}%'
       AND created_at > ?`
  ).get(cutoff) as { c: number } | null;
  return (result?.c ?? 0) > 0;
}

export default async function reputationTrackerSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  // Load state to track already-reviewed interactions
  const hookState = await readHookState(SENSOR_NAME);
  const reviewedKeys = new Set<string>(
    (hookState?.reviewed_keys as string[]) ?? []
  );

  const contacts = loadAgentContacts();
  if (contacts.length === 0) {
    log("no agent contacts with addresses found — skipping");
    return "ok";
  }

  // Build token index: token → contact
  const tokenIndex = new Map<string, Contact>();
  for (const contact of contacts) {
    for (const token of buildContactTokens(contact)) {
      tokenIndex.set(token, contact);
    }
  }

  const tasks = getRecentCompletedTasks();
  log(`scanning ${tasks.length} completed tasks against ${contacts.length} agent contacts`);

  if (tasks.length === 0) {
    return "ok";
  }

  // Skip tasks created by this sensor and internal operational tasks
  const candidateTasks = tasks.filter((t) => {
    // Self-referential loop prevention
    if (t.source?.startsWith(TASK_SOURCE_PREFIX)) return false;

    // Internal sources — operational noise, not real interactions
    if (t.source && INTERNAL_SOURCE_PREFIXES.some((p) => t.source!.startsWith(p))) return false;

    // Internal subject patterns
    if (INTERNAL_SUBJECT_PATTERNS.some((p) => p.test(t.subject))) return false;

    return true;
  });

  const eligible: EligibleInteraction[] = [];

  for (const task of candidateTasks) {
    // Skip tasks where reputation feedback was already submitted during execution
    const resultLower = (task.result_summary ?? "").toLowerCase();
    if (
      resultLower.includes("erc-8004") ||
      resultLower.includes("reputation feedback submitted") ||
      resultLower.includes("reputation review submitted")
    ) {
      continue;
    }

    // Classify first — only process tasks with a recognized interaction type
    const interactionType = classifyInteraction(task);
    if (interactionType === null) continue;

    // Build searchable text from task subject and source only.
    // Excluding result_summary prevents false positives from lengthy operational output.
    const searchText = [
      task.subject,
      task.source ?? "",
    ]
      .join(" ")
      .toLowerCase();

    // Check each token against the search text
    for (const [token, contact] of tokenIndex) {
      if (!searchText.includes(token)) continue;

      // Validate the contact is actually involved — not just a coincidental token match.
      // E.g. a contact's display_name matching words in an unrelated PR title.
      if (!isContactActuallyInvolved(contact, interactionType, searchText)) continue;

      // Skip self-references (Arc's own addresses)
      if (
        contact.bns_name === "arc0.btc" ||
        contact.display_name?.toLowerCase() === "arc"
      ) {
        continue;
      }

      const key = `${task.id}:${contact.id}`;
      if (alreadyTracked(task.id, contact.id, reviewedKeys)) continue;

      // 7-day dedup: skip if this contact was reviewed recently
      const contactDisplayName = contact.display_name ?? contact.aibtc_name ?? contact.bns_name ?? "unknown";
      if (wasRecentlyReviewed(contactDisplayName, contact.btc_address)) {
        log(`skipping ${contactDisplayName} — reviewed within last ${REVIEW_DEDUP_DAYS} days`);
        reviewedKeys.add(key);
        continue;
      }

      eligible.push({
        task_id: task.id,
        task_subject: task.subject,
        contact_id: contact.id,
        contact_name: contact.display_name ?? contact.aibtc_name ?? contact.bns_name ?? "unknown",
        contact_btc_address: contact.btc_address,
        interaction_type: interactionType,
      });

      // Only one match per task+contact pair
      reviewedKeys.add(key);
      break; // one contact match per task is enough
    }
  }

  log(`found ${eligible.length} reputation-eligible interaction(s)`);

  if (eligible.length === 0) {
    // Persist state even if nothing found (keeps reviewed_keys)
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: hookState?.version ?? 1,
      reviewed_keys: [...reviewedKeys].slice(-500), // cap at 500 entries
    });
    return "ok";
  }

  // Check daily cap: count reviews already created today
  const db2 = getDatabase();
  const todayReviewCount = (db2.query(
    `SELECT COUNT(*) as c FROM tasks
     WHERE source LIKE '${TASK_SOURCE_PREFIX}:%'
       AND created_at >= date('now')`,
  ).get() as { c: number })?.c ?? 0;

  if (todayReviewCount >= MAX_REVIEWS_PER_DAY) {
    log(`daily review cap reached (${todayReviewCount}/${MAX_REVIEWS_PER_DAY}) — skipping ${eligible.length} eligible`);
    await writeHookState(SENSOR_NAME, {
      last_ran: new Date().toISOString(),
      last_result: "capped",
      version: hookState?.version ?? 1,
      reviewed_keys: [...reviewedKeys].slice(-500),
    });
    return "ok";
  }

  const remainingBudget = Math.min(
    MAX_REVIEWS_PER_DAY - todayReviewCount,
    MAX_REVIEWS_PER_RUN,
  );

  // Queue one review task per eligible interaction (up to daily cap and per-run cap)
  let queued = 0;
  for (const interaction of eligible.slice(0, remainingBudget)) {
    const source = `${TASK_SOURCE_PREFIX}:task:${interaction.task_id}:contact:${interaction.contact_id}`;

    const description = [
      `Review interaction from task #${interaction.task_id}: "${interaction.task_subject}"`,
      ``,
      `Contact: ${interaction.contact_name} (ID: ${interaction.contact_id})`,
      `BTC address: ${interaction.contact_btc_address ?? "unknown — look up via contacts skill"}`,
      `Interaction type: ${interaction.interaction_type}`,
      ``,
      `Steps:`,
      `1. Read task #${interaction.task_id} result to understand the interaction`,
      `2. Determine appropriate rating (1-5) and tags`,
      `3. Submit signed review: arc skills run --name arc-reputation -- give-feedback --reviewee <btc-addr> --subject "<subject>" --rating <1-5> --comment "<comment>" --tags "<tags>"`,
      ``,
      `CALIBRATION: Do NOT default to 4/5. Use the full scale:`,
      `  1 = harmful or adversarial, 2 = poor quality or unreliable,`,
      `  3 = adequate / met expectations, 4 = notably good / exceeded expectations,`,
      `  5 = exceptional / rare excellence. Most routine interactions are a 3.`,
    ].join("\n");

    if (!recentTaskExistsForSource(source, 24 * 60)) {
      insertTask({
        subject: `Submit reputation review: ${interaction.contact_name} (task #${interaction.task_id}, ${interaction.interaction_type})`,
        description,
        skills: '["arc-reputation", "contacts"]',
        priority: 8,
        model: "haiku",
        source,
      });
      queued++;
    }
  }

  // Persist updated state
  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "ok",
    version: hookState?.version ?? 1,
    reviewed_keys: [...reviewedKeys].slice(-500),
  });

  log(`queued ${queued} review task(s)`);
  return "ok";
}
