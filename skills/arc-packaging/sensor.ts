// skills/arc-packaging/sensor.ts
// Cadence sensor for the standing packaging pipeline stage — P3 of arc-demand-flywheel quest.
// Queues one "package the next backlog candidate" dispatch task every 24h, IF an eligible
// candidate exists (research/INDEX.md's SKU backlog table has a relevance>=4 report that isn't
// already queued/claimed/packaged, OR a prior attempt is stuck queued/claimed and needs a
// resume). This is the piece that makes packaging an ACTIVE stage instead of a passive list.
//
// Mirrors arc-article-pipeline's sensor.ts (P2): queues, never executes. `materials` and
// `stage` (both deterministic, run by the dispatch-cycle LLM in between) are the only things
// that touch Whop or the research shelf. This sensor never mints a product itself.
//
// dev-council (Kleppmann/Lamport/Newman/Fowler, 2026-07-03, unanimous): the original version of
// this sensor computed its own independent backlog count and compared it against
// packaging_queue_log's row count — a second, divergent implementation of the same eligibility
// question `cli.ts`'s `selectCandidate()` already answers correctly, and the two disagreed: the
// count comparison silently stalled the pipeline around the halfway point of the backlog. Fixed
// by importing the SAME selection function `cli.ts` uses — there is now exactly one answer to
// "is there anything to package right now."

import { join } from "path";
import { Database } from "bun:sqlite";
import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTaskDeduped, pendingTaskExistsForSource } from "../../src/db.ts";
import { selectCandidate } from "./lib/backlog.ts";

const SENSOR_NAME = "arc-packaging";
const INTERVAL_MINUTES = 60 * 24; // 24h — a supply-side backlog stage. Since 2026-07-03 the
// stage PUBLISHES each SKU to the storefront (operator directive: SKUs are Arc-managed, like
// the blog — a growing corpus + consistent automated operations). One new catalog item per
// day is catalog growth, not feed spam — it pushes nothing into anyone's timeline or chat;
// the member-facing ANNOUNCEMENT still never fires automatically (see cli.ts's stage), which
// is what "looks spammy on turn-on" actually guards.

const ARC_STARTER_ROOT = join(import.meta.dir, "../../");
const INDEX_PATH = join(ARC_STARTER_ROOT, "research/INDEX.md");

const log = createSensorLogger(SENSOR_NAME);

export default async function arcPackagingSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initDatabase();
  const db: Database = getDatabase();

  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as
    | { value: string }
    | null;
  if (ksRow?.value === "false") {
    log("kill switch active (outbound_enabled=false) — skipping packaging cadence");
    return "skip";
  }

  // packaging_queue_log may not exist yet on a fresh install — cli.ts creates it on first run;
  // treat "no table" the same as "no rows queued" rather than throwing.
  let candidate;
  try {
    candidate = selectCandidate(db, INDEX_PATH);
  } catch (e) {
    log(`selectCandidate failed (packaging_queue_log likely not created yet — run cli.ts once): ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }

  if (!candidate) {
    log("no eligible candidate (backlog drained of relevance>=4 reports, or nothing stuck to resume) — skip");
    return "skip";
  }

  // Dedup key is the actual candidate's report file, not a count-derived pseudo-sequence — a
  // stable, meaningful identity that can't drift out of sync with reality (dev-council: Lamport
  // flagged the earlier count-derived `attempt-N` scheme as coupled to row-insertion order in a
  // way that could repeat or skip under concurrent/manual runs).
  const source = `sensor:arc-packaging:${candidate.reportFile}`;
  if (pendingTaskExistsForSource(source)) {
    log(`task already queued for ${candidate.reportFile} (${source}) — skip`);
    return "skip";
  }

  const taskId = insertTaskDeduped({
    subject: `Package a research report into a Whop SKU — ${candidate.reportFile}`,
    description: [
      `The standing packaging pipeline stage (P3 of arc-demand-flywheel) found an eligible`,
      `report: ${candidate.reportFile} (relevance ${candidate.relevance}). Read`,
      `skills/arc-packaging/SKILL.md before drafting. Follow these steps:`,
      ``,
      `STEP 1 — materials (deterministic, run first):`,
      `  bun skills/arc-packaging/cli.ts materials --report ${candidate.reportFile}`,
      `  Writes a materials brief to db/packaging-materials/<slug>.json — includes the`,
      `  report's FULL TEXT (reportMarkdown field, not just a path), sku_why, a suggested $9`,
      `  price, and the REQUIRED dual-audience-frame instructions.`,
      ``,
      `STEP 2 — draft (you, this dispatch turn):`,
      `  Read the brief's reportMarkdown, voiceInstructions, and sanitizationChecklist. Write`,
      `  { "title": "...", "headline": "...", "description": "..." } to`,
      `  db/packaging-materials/<slug>.draft.json.`,
      `    - SOUL.md-gated prose (kill adverbs, no banned openers/structures).`,
      `    - description MUST contain BOTH audience frames verbatim-or-near-verbatim:`,
      `      the human line "operator: give this to your agent" AND the agent line`,
      `      "read this content" — audience is LOCKED to agent operators, not general readers.`,
      `    - Lead with the report's real measured hook/number in the FIRST sentence.`,
      `    - Do NOT claim the x402 rail delivers this product immediately — it isn't wired to`,
      `      this catalog entry yet. Say Whop checkout now, x402 for this catalog coming soon.`,
      `    - Vary the closing sentence — do not reuse the same closing line across SKUs.`,
      `    - Do NOT include anything from the sanitizationChecklist (secrets, internal IPs,`,
      `      credential-adjacent detail, unreleased strategy) — 'stage' will hard-fail on a`,
      `      regex hit, but a careful draft shouldn't rely on that net alone.`,
      ``,
      `STEP 3 — stage (deterministic, run last):`,
      `  bun skills/arc-packaging/cli.ts stage --report ${candidate.reportFile}`,
      `  Validates the draft (dual-frame check + sanitization scan), strips internal-only`,
      `  content (Arc's own recommendations table, wiki-links, cache/task-id provenance lines)`,
      `  from the deliverable, mints the Whop SKU, marks the report packaged in`,
      `  research/INDEX.md, wires membership unlock-all SILENTLY (a $0 promo code — no chat`,
      `  announcement fires automatically), and finally makes the SKU visible on the public`,
      `  storefront (operator directive 2026-07-03: SKUs are Arc-managed, no operator review,`,
      `  same as the blog). Emails whoabuddy a summary with the product/checkout/promo links`,
      `  for visibility (not a review gate). This is the end of the pipeline for this report —`,
      `  the member-chat announcement stays operator-gated; do NOT post the SKU, checkout`,
      `  link, or redemption link anywhere yourself (no chat, forum, X, or blog mention).`,
    ].join("\n"),
    skills: JSON.stringify(["arc-packaging"]),
    priority: 4,
    model: "sonnet",
    source,
  });

  if (taskId === null) {
    log("task creation skipped (duplicate subject or source)");
    return "skip";
  }

  await writeHookState(SENSOR_NAME, {
    last_ran: new Date().toISOString(),
    last_result: "queued",
    version: ((await readHookState(SENSOR_NAME))?.version ?? 0) + 1,
    last_queued_report: candidate.reportFile,
    last_task_id: taskId,
  });

  log(`queued packaging task for ${candidate.reportFile} (id: ${taskId}, source: ${source}, relevance: ${candidate.relevance})`);
  return "ok";
}
