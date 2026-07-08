// skills/arc-article-pipeline/sensor.ts
// Cadence sensor for Arc's Operator-Amplified Article Pipeline — P2 of arc-demand-flywheel quest.
// Queues one "draft the next article" dispatch task every 48h (every-other-day, the phase's
// cadence floor). This sensor ONLY gets a finding to "staged" — it never calls
// blog-publishing's `publish` directly, never commits/pushes arc0me-site, and never posts to X.
// The blog leg hands off to Arc's own autonomous blog-publishing lane (draft:true sync); the
// X ARTICLE variant (title + article body + companion post — NOT a tweet thread) is emailed to
// whoabuddy, and only he posts it, from his own @whoabuddy account.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTaskDeduped, pendingTaskExistsForSource } from "../../src/db.ts";
// Side-effect-free import (cli.ts's main() is import.meta.main-guarded): the task-description
// numbers below come from the SAME constant validateXArticle() enforces, so the instruction the
// dispatch LLM reads and the validator that judges its draft can never desync (dev-council: hohpe).
import { X_ARTICLE_CONSTRAINTS } from "./cli.ts";

const SENSOR_NAME = "arc-article-pipeline";
const INTERVAL_MINUTES = 60 * 48; // every-other-day floor ("faster" is fine, this is the ceiling gate)
// v2 = the X-Article draft schema (xArticle object, NOT the retired xThread array) — bumped on
// the breaking contract change (dev-council: newman) so a stale pre-rework pending task can
// never suppress the correctly-shaped replacement via the pendingTaskExistsForSource dedup.
const SOURCE_VERSION = "v2";

const log = createSensorLogger(SENSOR_NAME);

export default async function arcArticlePipelineSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  initDatabase();
  const db = getDatabase();

  const ksRow = db.query("SELECT value FROM agent_config WHERE key = 'outbound_enabled'").get() as { value: string } | null;
  if (ksRow?.value === "false") {
    log("kill switch active (outbound_enabled=false) — skipping article cadence");
    return "skip";
  }

  let articleN = 1;
  try {
    const row = db.query("SELECT MAX(article_n) as max_n FROM article_queue_log").get() as { max_n: number | null };
    articleN = (row?.max_n ?? 0) + 1;
  } catch {
    articleN = 1; // table not created yet — cli.ts creates it on first run
  }

  const source = `sensor:arc-article-pipeline:${SOURCE_VERSION}:article-${articleN}`;
  if (pendingTaskExistsForSource(source)) {
    log(`task already queued for article ${articleN} (${source}) — skip`);
    return "skip";
  }

  const taskId = insertTaskDeduped({
    subject: `Draft Arc's next amplified article — Article ${articleN}`,
    description: [
      `An operator-amplified long-form article is due (every-other-day-or-faster cadence,`,
      `P2 of arc-demand-flywheel). Two voice registers, not one — read`,
      `skills/arc-article-pipeline/SKILL.md before drafting. Follow these steps:`,
      ``,
      `STEP 1 — materials (deterministic, run first):`,
      `  bun skills/arc-article-pipeline/cli.ts materials --article ${articleN}`,
      `  Selects the next unused relevance-4/5 finding from research/INDEX.md (crown jewels`,
      `  first, rotation-window dedup against recent articles), extracts its measured hook +`,
      `  a real file:line citation. Writes the brief to`,
      `  db/article-materials/article-${articleN}.json. (--article ${articleN} pins the same`,
      `  number this task was queued for, so steps 1 and 3 can never target different briefs.)`,
      ``,
      `STEP 2 — draft (you, this dispatch turn):`,
      `  Read the brief's voiceInstructions. Write`,
      `  { "blogTitle": "...", "blogBody": "...",`,
      `    "xArticle": { "title": "...", "body": "...", "companionPost": "..." } } to`,
      `  db/article-materials/article-${articleN}.draft.json.`,
      `    - blogBody: Arc's own voice (SOUL.md-gated), 700-1800 words, leads with the hook +`,
      `      file:line citation. NO CTA/URL — appended deterministically by 'stage'.`,
      `    - xArticle: a long-form X ARTICLE (NOT a tweet thread) in Jason's (@whoabuddy)`,
      `      amplification voice — first person Jason, explicitly crediting/quoting Arc,`,
      `      never impersonating Arc, never undisclosed fronting.`,
      `      title <=${X_ARTICLE_CONSTRAINTS.titleMaxChars} chars;`,
      `      body ${X_ARTICLE_CONSTRAINTS.bodyWordRange[0]}-${X_ARTICLE_CONSTRAINTS.bodyWordRange[1]} words,`,
      `      PLAIN TEXT paragraphs (X's article composer renders no markdown — no backticks`,
      `      either), hook + file:line citation within the first`,
      `      ${X_ARTICLE_CONSTRAINTS.citationWindowChars} characters (~ the first two paragraphs);`,
      `      companionPost <=${X_ARTICLE_CONSTRAINTS.companionMaxChars} chars (the short post`,
      `      Jason pairs with the article share).`,
      `      NO CTA/URL anywhere (appended deterministically by 'stage').`,
      ``,
      `STEP 3 — stage (deterministic, run last):`,
      `  bun skills/arc-article-pipeline/cli.ts stage --article ${articleN}`,
      `  Validates the draft, creates the arc0.me blog draft, deploys an isolated preview`,
      `  (Cloudflare staging env — never production), syncs the blog leg to blog-publishing's`,
      `  autonomous lane (draft:true preserved — Arc's own sensor queues review+publish on its`,
      `  normal cadence), writes the X Article variant to skills/arc-article-pipeline/drafts/,`,
      `  and emails the ready-to-paste X Article draft to whoabuddy (his existing`,
      `  amplification-email lane). This STOPS at "staged" — it does NOT post to X and does`,
      `  NOT flip draft:false itself; only whoabuddy posts the X Article, from his own account.`,
    ].join("\n"),
    skills: JSON.stringify(["arc-article-pipeline"]),
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
    last_result: "ok",
    version: ((await readHookState(SENSOR_NAME))?.version ?? 0) + 1,
    last_queued_article: articleN,
    last_task_id: taskId,
  });

  log(`queued Article ${articleN} task (id: ${taskId}, source: ${source})`);
  return "ok";
}
