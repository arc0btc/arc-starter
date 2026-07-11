// skills/arc-workflows/blog-render.ts
// arc-day-n-publishing P1 (dev-council/Fowler + Newman, design spec §3.6, CONFIRMED-applied):
// the blog-post-publish task descriptor, extracted from ContentCalendarMachine's
// `source_drafted` action so it has ONE definition and TWO callers — ContentCalendarMachine
// itself (legacy/manually-pre-filled work-pieces, e.g. Tier-A backfill) and the merged Day-N
// producer (skills/arc-daily-read/cli.ts). Justification is FAILURE ISOLATION, not reuse for
// its own sake (per the council's correction): this module has exactly one behavioral
// definition of "how a blog-publish task is worded," so a caller can retry/inspect it
// independently of the state machine's own transition bookkeeping, and the eventual
// second caller (Day-N) inherits proven copy instead of forking a second, driftable version.
//
// This module does NOT author blog content. There is no deterministic "renderBlogPost()"
// anywhere in this codebase — publishing an mdx file is an LLM-driven dispatch task against
// the `blog-publishing` skill (gated by `arc-brand-voice`). "Extraction" here means
// centralizing the ONE task-descriptor-construction function that both callers dispatch,
// not adding a new rendering engine that doesn't exist today.

export interface BlogPublishTaskInput {
  /** Stable slug this blog post files under (matches the eventual .mdx filename minus
   *  extension, e.g. "2026-07-08-day-5-cost-routing-defaults"). Callers own slug shape. */
  slug: string;
  title: string;
  /** Path to the drafted source material (materials brief / research artifact) the post
   *  is built from — surfaced to the drafting LLM turn, not read by this function. */
  sourceArtifactPath: string;
  /** Caller-specific context appended after the standard instructions (e.g. Day-N's
   *  "this mirrors the thread just posted" note, or a content-calendar cluster note). */
  extraContext?: string;
}

export interface BlogPublishTaskDescriptor {
  subject: string;
  priority: number;
  model: string;
  skills: string[];
  description: string;
}

/**
 * Build the deterministic task descriptor for publishing a blog work-piece — the T+0
 * canonical artifact any downstream channel (whether ContentCalendarMachine's legacy saga
 * or the Day-N producer's own thread) amplifies. Pure function: no DB/network access, no
 * task insertion, no source key — callers own the dedup `source` key and any state-machine
 * advancement (ContentCalendarMachine sets `autoAdvanceState`; the Day-N producer does not,
 * since it queues a bare task with no attached workflow instance — see cli.ts comment on
 * why Day-N-sourced posts must not get a ContentCalendarMachine instance).
 */
export function buildBlogPublishTask(input: BlogPublishTaskInput): BlogPublishTaskDescriptor {
  return {
    subject: `Publish blog work-piece: ${input.title || input.slug}`,
    priority: 4,
    model: "sonnet",
    skills: ["blog-publishing", "arc-brand-voice"],
    description: `Publish the canonical, signed blog artifact for this work-piece — the T+0 source of truth any downstream amplification (thread, syndication) points back to.

Source artifact: ${input.sourceArtifactPath}
Voice: read skills/arc-brand-voice/CHANNELS.md §blog before publishing.
Slug: ${input.slug} (use this exact slug — the caller's dedup key and any cross-referencing rely on it matching byte-for-byte).
${input.extraContext ? `\n${input.extraContext}\n` : ""}
Steps:
1. Finalize and publish the post (blog-publishing skill, e.g. \`create --title "..." --slug ${input.slug}\` then \`publish --id ${input.slug}\`). Verify it is live (build success ≠ deploy success — confirm the URL resolves, see MEMORY [P] content-publish-verify-deploy).
2. Sign the artifact per Arc's publishing convention.
3. Mirror to Moltbook (zero-effort syndication, arc-day-n-publishing P3 — applies to every canonical blog publish, Day-N and non-Day-N alike, since this is the one shared descriptor): run \`bun run skills/social-engine/moltbook-mirror-post.ts <db> --slug ${input.slug} --title "${input.title || input.slug}" --url <the exact URL confirmed live in step 1>\`. This is a link-back mirror only (no bespoke content is authored on Moltbook) and is idempotent per slug. If the owner dashboard isn't connected, the script exits cleanly with a CHECKPOINT (not a failure) — this is an external operator prerequisite, do NOT treat it as a blog-publish failure and do not retry the blog publish over it.
4. Report back which URL went live (and the Moltbook mirror outcome — mirrored / idempotent / checkpoint).`,
  };
}
