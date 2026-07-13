// src/research-brief.ts
//
// The standing research brief shared by every sensor that files a "Research:" task into
// arc-link-research (arc-x-research-channel quest, Phase 7 quality-fix pass).
//
// ROOT CAUSE this replaces: both candidate-maturation/sensor.ts and
// research-nugget-relay/sensor.ts used to end their filed task's description with a
// two-line mechanical pointer ("Evaluate these links for mission relevance. Use: arc
// skills run --name arc-link-research -- process --links <url>") — the dispatched agent
// ran that command and stopped, producing the hollow scaffold `process` writes on its
// own (empty sku_why, repos_touched:"unknown", no TL;DR — confirmed live on task
// #22284). The operator's own email-batch tasks (#20099 opus, #20111 sonnet — BOTH good
// even on sonnet) embed a real editorial brief: an explicit report-shape checklist, a
// decline path, and a "port to agent-runtime?" prompt. This module is that checklist,
// extracted to ONE place (dev-council 2026-07-13, Fowler lens, CONFIRMED: the two
// sensors originally carried ~18 near-identical lines each — load-bearing editorial
// vocabulary duplicated is exactly the kind of thing that silently diverges the day
// someone tightens the report shape in one sensor and forgets the other).
//
// Each sensor still owns its OWN header lines (discovery context, engagement/rubric
// data it actually has in hand) — only the shared checklist (steps 1-3) lives here.

/**
 * Returns the shared standing-brief checklist (steps 1-3), parameterized by the exact
 * `process` command line the calling sensor wants the agent to run (it varies: candidate-
 * maturation passes a joined link list, research-nugget-relay passes a single source_url).
 * `--task <Task ID>` can't be filled with the real numeric id here — insertTask()/
 * insertTaskIfNew() haven't run yet when the description text is built, so the id doesn't
 * exist. The agent substitutes its own known id, the same way #20099/#20111's exemplar
 * descriptions say "task_id:THIS" for a human-authored task to fill in — src/dispatch.ts's
 * buildPrompt always states "Task ID: N" at the top of every dispatched agent's prompt
 * (confirmed live, ~line 524), so this is not asking the agent to guess.
 */
export function standingBriefSteps(processCommand: string): string[] {
  return [
    "--- Standing research brief (mirrors the operator's own email-batch brief shape — #20099/#20111) ---",
    "",
    "1. Run this FIRST, passing --task with THIS task's own id (shown above in your",
    "   prompt as \"Task ID: N\") so the report's front-matter carries it:",
    `     ${processCommand}`,
    "   This caches/dedups the link(s) and writes a mechanical scaffold report.",
    "2. Then go BEYOND that scaffold — edit the SAME report file directly:",
    "   - sku_why: real buyer-facing judgment (would a $9 packaged reader pay for",
    "     this? why or why not, one line — not left empty).",
    "   - repos_touched: resolve it by actually reading arc-starter (this VM) and",
    "     agent-runtime if relevant — never leave it \"unknown\" without having looked.",
    "   - Write a \"## TL;DR\" (3 lines) and cited \"## Key Takeaways\".",
    "   - Add an Arc-alignment note: cite a real file/skill where Arc already does",
    "     this, or state plainly \"no direct code hook\" — never hand-wave.",
    "   - Run reindex when done: arc skills run --name arc-link-research -- reindex",
    "3. DECLINE PATH: if, after reading it, this is genuinely low-relevance/",
    "   tangential — do NOT force a report. Skip step 1-2 entirely and close this",
    "   task directly with a two-line reasoned decline:",
    "     arc tasks close --id <Task ID> --status completed --summary \"<why this",
    "     isn't relevant, 2 lines>\"",
    "   A short, honest decline is the CORRECT output here, not a failure — do not",
    "   pad a thin link into a hollow report just to produce something.",
  ];
}
