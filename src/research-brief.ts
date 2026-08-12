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

// ---- Two-stage triage brief (Phase 8, containment pass) ----
//
// Replaces one-dispatch-per-candidate with the SAME two-stage shape the operator's own
// email batches already prove works (tasks #20093 -> #20099/#20111, read live from the DB):
// #20093 (opus) ran `arc-link-research process` ONCE across a whole 21-link batch (mechanical
// caching, not 21 separate fetches), consolidated near-duplicate topics down from ~21 links to
// 14 real topics, skipped low-relevance ones with a one-line note, then fanned out individual
// `arc tasks add` calls for the survivors — each reusing #20093's cache via `--task`, never
// re-running `process`. This was $115.08/24h's fix: ONE judgment dispatch instead of N.
//
// candidate-maturation/sensor.ts calls buildTriageBrief() with the story-clusters that survived
// (a) the mechanical pre-filter (isMechanicallyRejectable — already stripped the zero-signal
// bare-t.co/RT-only class) and (b) cross-run cluster collapse (computeClusterKey — already
// merged same-story siblings). What's LEFT is genuinely a judgment call (real link or real
// text substance, but relevance/angle still unknown) — exactly the class of work a batched
// triage pass is for, not a mechanical filter.

export interface TriageClusterMember {
  tweetId: string;
  authorId?: string;
  textSnippet: string;
  links: string[];
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  discoveryContext?: string;
}

export interface TriageCluster {
  clusterKey: string | null;
  members: TriageClusterMember[];
  /** Pre-computed model hint (candidate-maturation's existing chooseModel logic, applied to
   * the cluster's highest-engagement member) — triage may override per-topic if its own
   * judgment disagrees, this is a starting point, not a mandate. */
  suggestedModel: "opus" | "sonnet";
}

/**
 * Builds the full description for ONE triage task representing every surviving story-cluster
 * from a single maturation run. `taskCreateSkill`/`sourcePrefix` let the triage agent fan out
 * per-topic tasks with a dedup-safe --source (mirrors #20093's "task:<parent>:<slug>" shape —
 * insertTask/insertTaskIfNew dedup on `source`, so each per-topic slug must be distinct).
 */
export function buildTriageBrief(clusters: TriageCluster[]): string {
  const allLinks = Array.from(new Set(clusters.flatMap((c) => c.members.flatMap((m) => m.links)))).join(", ");

  const clusterBlocks = clusters.map((cluster, i) => {
    const rep = cluster.members.reduce((best, m) =>
      m.likeCount + m.retweetCount * 2 + m.replyCount * 2 > best.likeCount + best.retweetCount * 2 + best.replyCount * 2 ? m : best
    );
    const memberLines = cluster.members.map(
      (m) =>
        `     - tweet_id ${m.tweetId}${m.authorId ? ` (author ${m.authorId})` : ""}: "${m.textSnippet.slice(0, 200)}" ` +
        `[${m.likeCount} likes, ${m.retweetCount} RTs, ${m.replyCount} replies] links: ${m.links.join(", ") || "(none)"}`
    );
    return [
      `### Story ${i + 1} (cluster_key: ${cluster.clusterKey ?? "singleton, no shared key"}, ${cluster.members.length} member tweet(s), suggested model: ${cluster.suggestedModel})`,
      `  Representative: "${rep.textSnippet.slice(0, 300)}"${rep.discoveryContext ? ` — discovered via ${rep.discoveryContext}` : ""}`,
      `  Links: ${rep.links.join(", ") || "(none — text-substance survivor, judge the text itself)"}`,
      "  All member tweets (evidence, cite the ones you actually use):",
      ...memberLines,
    ].join("\n");
  });

  return [
    `Triage + fan-out — ${clusters.length} surviving stor${clusters.length === 1 ? "y" : "ies"} from this maturation run ` +
      `(mirrors the operator's own #20093 batch-triage flow — read that task in the DB for the exemplar).`,
    "",
    "## Pre-fan-out triage",
    "1. Run this FIRST, passing --task with THIS task's own id (shown above as \"Task ID: N\"),",
    "   across ALL links below in ONE call — this is the mechanical caching pass, not per-link fetches:",
    `     arc skills run --name arc-link-research -- process --links "${allLinks}" --task <Task ID>`,
    "2. For EACH story below, decide RESEARCH or DECLINE. RESEARCH is gated — a story only",
    "   qualifies if you can state BOTH of these in one line each (this is the fix for the",
    "   opus-research-burst zero-conversion pattern — 4 consecutive overnight briefs where",
    "   fanned-out research produced prose but never a follow-up task, memory update, or",
    "   shipped change; see memory/shared/entries/opus-research-burst-no-action-conversion.md):",
    "   - HYPOTHESIS: a specific, checkable claim — not \"this looks interesting\" or \"worth",
    "     understanding better\". E.g. \"Arc's own X posting queue has the same rate-limit gap",
    "     this thread describes\" is checkable; \"agent orchestration is evolving fast\" is not.",
    "   - EXIT CONDITION: what you would concretely DO if the hypothesis holds true — file a",
    "     follow-up task, write a memory/shared entry, or change code/config. \"Write a report",
    "     about it\" is NOT an exit condition — the report itself is not the action.",
    "   - DECLINE (no task filed) if you cannot state both in one line each, even if the",
    "     story is genuinely interesting reading. Note it inline in your own final summary —",
    "     one line per declined story, no per-story task. A thin-but-true hypothesis with no",
    "     real exit condition is a DECLINE, not a downgraded RESEARCH.",
    "   - RESEARCH (only once hypothesis + exit condition are both stated): fan out ONE",
    "     per-topic task via:",
    '     arc tasks add --subject "Research: <topic>" --model opus|sonnet --skills',
    '       arc-link-research --source "task:<Task ID>:<unique-slug>" --parent <Task ID>',
    "     (insertTask dedups by --source — use a distinct slug per topic. The suggested",
    "     model above is a starting point; upgrade to opus if the story is genuinely",
    "     substantive, downgrade to sonnet only for a thin summarize-only case — never",
    "     downgrade brainpower just to save tokens on real signal.)",
    "   Each per-topic task's description MUST open with the hypothesis and exit condition",
    "   you stated for it (verbatim, so the dispatched agent inherits the same bar), THEN",
    "   embed this SAME standing-brief checklist (reuse verbatim, do not paraphrase):",
    "",
    "   ## Hypothesis: <one line, from your triage decision above>",
    "   ## Exit condition: <one line, from your triage decision above>",
    "",
    ...standingBriefSteps('arc skills run --name arc-link-research -- process --links "<this topic\'s links>" --task <Task ID>').map((l) => `   ${l}`),
    "",
    "   When closing the per-topic task, state explicitly whether the exit condition",
    "   triggered — and if it did, TAKE the action (file the follow-up task / write the",
    "   memory entry / note the code change), don't just describe that it would apply.",
    "   \"Exit condition did not trigger\" is a valid, honest close — leaving it unaddressed",
    "   is not.",
    "",
    "3. Cap fan-out at ~8 per-topic tasks this run — if more than 8 stories are genuinely",
    "   research-worthy, cluster harder (merge adjacent angles) or decline the weaker ones;",
    "   do not silently exceed this to avoid making a judgment call.",
    "4. Close THIS triage task when done, summarizing: N stories researched (list task ids),",
    "   M declined (one line each, why).",
    "",
    "## Stories",
    ...clusterBlocks,
  ].join("\n");
}
