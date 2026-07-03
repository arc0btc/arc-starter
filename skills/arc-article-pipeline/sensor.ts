// skills/arc-article-pipeline/sensor.ts
// Cadence sensor for Arc's Operator-Amplified Article Pipeline — P2 of arc-demand-flywheel quest.
// Queues one "draft the next article" dispatch task every 48h (every-other-day, the phase's
// cadence floor). This sensor ONLY gets a finding to "staged" — it never calls
// blog-publishing's `publish`, never commits/pushes arc0me-site, and never posts to X. Firing
// (blog publish + the operator posting the X thread from @whoabuddy) is always a separate,
// human-initiated action.

import { claimSensorRun, createSensorLogger, readHookState, writeHookState } from "../../src/sensors.ts";
import { initDatabase, getDatabase, insertTaskDeduped, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "arc-article-pipeline";
const CADENCE_MINUTES = 60 * 48; // every-other-day floor ("faster" is fine, this is the ceiling gate)

const log = createSensorLogger(SENSOR_NAME);

export default async function arcArticlePipelineSensor(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, CADENCE_MINUTES);
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

  const source = `sensor:arc-article-pipeline:article-${articleN}`;
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
      `  bun skills/arc-article-pipeline/cli.ts materials`,
      `  Selects the next unused relevance-4/5 finding from research/INDEX.md (crown jewels`,
      `  first, rotation-window dedup against recent articles), extracts its measured hook +`,
      `  a real file:line citation. Writes the brief to`,
      `  db/article-materials/article-${articleN}.json.`,
      ``,
      `STEP 2 — draft (you, this dispatch turn):`,
      `  Read the brief's voiceInstructions. Write`,
      `  { "blogTitle": "...", "blogBody": "...", "xThread": ["...", "..."] } to`,
      `  db/article-materials/article-${articleN}.draft.json.`,
      `    - blogBody: Arc's own voice (SOUL.md-gated), 700-1800 words, leads with the hook +`,
      `      file:line citation. NO CTA/URL — appended deterministically by 'stage'.`,
      `    - xThread: Jason's (@whoabuddy) amplification voice — first person Jason,`,
      `      explicitly crediting/quoting Arc, never impersonating Arc, never undisclosed`,
      `      fronting. Tweet 1 must contain the hook + citation. 3-6 tweets, each <=280`,
      `      chars, NO CTA/URL (appended deterministically).`,
      ``,
      `STEP 3 — stage (deterministic, run last):`,
      `  bun skills/arc-article-pipeline/cli.ts stage --article ${articleN}`,
      `  Validates the draft, creates the arc0.me blog draft (stays unpublished), deploys an`,
      `  isolated preview (Cloudflare staging env — never production), and writes the`,
      `  X-thread variant to skills/arc-article-pipeline/drafts/. This STOPS at "staged" —`,
      `  it does NOT publish the blog post and does NOT post to X. Flag the staged article to`,
      `  whoabuddy for quality-gate + fire (he publishes + posts from his own @whoabuddy`,
      `  account when he approves it).`,
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
    last_result: "queued",
    version: ((await readHookState(SENSOR_NAME))?.version ?? 0) + 1,
    last_queued_article: articleN,
    last_task_id: taskId,
  });

  log(`queued Article ${articleN} task (id: ${taskId}, source: ${source})`);
  return "ok";
}
