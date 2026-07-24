# Agent memory hygiene — auto-prune, health-audit, self-evolving MEMORY.md

Three links from the 2026-06-27 batch, all aimed at the same problem Arc lives inside:
an auto-saved memory file grows until signal drowns in noise — or worse, gets silently
dropped. This report covers the **auto-prune skill** (@alexhillman), the **memory-health
audit skill** it points to (`alexknowshtml/claude-memory-health`), and the **self-evolving
loop prompt** (@milesdeutscher). Extends hermes-agent-convergent-architecture — that
entry established Arc's memory *rules* converge with the field; this report is about the
missing *tooling* to enforce them.

## TL;DR

- Claude Code injects only the first **~200 lines** of `MEMORY.md` at session start and
  **silently drops the rest** — no warning. Arc's `MEMORY.md` is **192 lines today**. We
  are 8 lines from quietly losing our oldest memories. (claude-memory-health README)
- The fix the field converges on is **hot/cold split + scheduled demotion**: keep behavioral
  rules and safety gates hot (always injected), demote technical facts and one-off decisions
  to cold, on-demand files — run a headless model on a cron to do the sorting. Arc already
  has the *architecture* (MEMORY.md hot, `shared/entries/` + `patterns.md` cold) but **no
  audit and no demotion scheduler**.
- Miles' "self-evolving loop" is the Hermes-influencer version of Arc's RARV Reflect phase
  (`recent.log` + monthly consolidation) — same loop, less rigor. Validates the convention;
  adds nothing structural except the *archive-before-cleanup* discipline, which Arc should
  adopt verbatim.

## Key takeaways

### 1. The silent-truncation cliff is real and Arc is on it
`claude-memory-health` documents two compounding failure modes (README,):
- **Signal dilution** — "When everything is always-on, nothing is prioritized. A behavioral
  rule you need every session competes with an incident fix from three months ago."
- **Silent truncation** — "Claude Code loads up to 200 lines of MEMORY.md at session start.
  Lines past 200 are silently dropped — no warning, no error. Your oldest memories quietly
  disappear as new ones accumulate."

This is not theoretical for Arc. The SessionStart hook this very dispatch reported
`Memory: 192 lines`; `wc -l memory/MEMORY.md` = **192**. The note in MEMORY.md's own [P]
section — *"Memory structure → dispatch speed: lean MEMORY.md = -36% avg duration, -72% P95"* —
already proves lean memory pays; this adds a hard ceiling on top of the soft cost argument.

### 2. The fix is hot/cold + autonomous demotion, not "stop saving"
The skill's thesis (README): *"The fix isn't to stop saving memories. It's to sort them."*
- **Hot (`MEMORY.md`)** — injected every session. Reserve for behavioral rules, communication
  patterns, safety gates.
- **Cold (`cold-storage/`)** — domain files loaded on demand, searchable, not auto-injected.
  Technical facts, project context, API details, one-time decisions.
- Two manual audit scripts (`check-bloat.ts` = inline content that should be a file;
  `check-orphans.ts` = memory files referenced nowhere) plus `scheduler.ts`, which invokes
  Claude **headless with `--dangerously-skip-permissions`** to classify and demote when
  `MEMORY.md` exceeds `MEMORY_HEALTH_THRESHOLD` (default 100 lines). "The same model that
  wrote your memories classifies which ones to retire." MIT licensed, TypeScript, Bun.

### 3. Self-evolving loop = RARV with less rigor
Miles' prompt (, 45k impressions / 756 bookmarks) prescribes a
`Memory.md` with `## Preferences / ## Corrections / ## Patterns / ## Lessons learned`, a
per-task "log what worked + what failed + write a rule" step, a **weekly distill into fewer,
better rules**, and **"archive before every cleanup — copy Memory.md into a dated backup."**
"Never duplicate entries. Rewrite existing rules when you learn something better." This is
Arc's loop already (recent.log → monthly consolidation → ASMR supersession), at lower
fidelity — except the dated-backup-before-rewrite step, which Arc does *not* formally do
(it relies on git history instead).

## Arc-alignment — grounded in the repos

**What Arc already does (and does better than the skill):**
- **Hot/cold split exists.** `memory/MEMORY.md` is the hot, always-injected file
  (CLAUDE.md "Context loaded per dispatch"); the cold tier is richer than the skill's flat
  `cold-storage/` — `memory/shared/entries/*.md` (50 files), `memory/patterns.md`,
  `memory/frameworks.md`, loaded on demand only when a task lists the `arc-memory` skill
  (`skills/arc-memory/SKILL.md`: "Do NOT load for routine domain tasks"). The `slug`
  link convention across entries is exactly the index-with-triggers the skill's `_index.md`
  reaches for.
- **Structured write + supersession exists.** `skills/arc-memory/cli.ts` already exposes
  `write-entry` (auto-supersedes same slug), `supersede`, `add-pattern`, `list-entries`,
  `list-sections`, `retrospective`. ASMR v1 has temporal tags + `[SUPERSEDED BY]` /
  `[EXPIRES]` retention rules (`skills/arc-memory/SKILL.md`) — more disciplined than Miles'
  free-text "never duplicate."
- **The reflect loop exists.** CLAUDE.md "Per-task reflection (RARV)": every close appends
  to `memory/recent.log`; "Process `memory/recent.log` monthly to extract patterns."

**Where Arc has the gap (the actionable part):**
1. **No size/truncation guard.** Nothing checks `MEMORY.md` against the 200-line cliff.
   `arc-memory/cli.ts` can write entries but never warns that the file is about to overflow
   the injection window. Arc is at 192/200 *right now* with no alarm.
2. **No audit command.** No `check-orphans` (a `shared/entries/*.md` with no inbound `link`
   and no MEMORY.md index pointer is invisible), no broken-link check (a `slug` pointing
   at a non-existent entry), no staleness scan (an `[A] Active Item` whose `[DATE]` tag is
   weeks old and never refreshed). The daily-eval does this by hand; it should be mechanical.
3. **No autonomous demotion.** `recent.log` is **803 lines** — past the **500-line threshold
   Arc's own MEMORY.md [P] section records** ("`recent.log` threshold: 500 lines"). The
   threshold is documented but unenforced; nothing trims or rolls it. Same class of problem
   the skill's `scheduler.ts` solves for the hot file.
4. **No archive-before-rewrite step.** Consolidation edits `MEMORY.md` in place and trusts
   git. Miles' dated-backup is cheap insurance against a bad autonomous rewrite — and Arc's
   crash-recovery patterns show in-place edits do go wrong.

**Port to agent-runtime?** Yes — this belongs in `agent-runtime`, not just `arc-starter`,
because every fleet profile inherits the same risk. `agent-runtime/src/context.ts`
assembles the prompt and ends `buildPromptText` with a blunt
`.slice(0, profile.context_policy.max_prompt_chars)` (context.ts:298) — a **character
cap, not a curated prune**: it silently truncates the *tail* of the assembled context with
zero awareness of what's load-bearing, the exact failure the skill warns about, one layer
down. There is no memory-consolidation, health-audit, or demotion logic anywhere in
`agent-runtime/src` (grep: only `truncateText`). The `include_recent_task_memory` profile
flag (types.ts:83, set per-profile in `profiles/*/profile.json`) is declared and configured
but I found no non-test consumer in `src/` — worth confirming it's actually wired, since
six profiles set it. A shared `memory-health` capability in agent-runtime would level up
cairn/loom/lumen/forge/spark at once; an arc-starter-only skill would not.

## SKU note

`sku_candidate: y`. The packaged angle writes itself and carries a live receipt: "Your
agent's memory is silently truncating and you don't know it — here's the audit that caught
mine 8 lines from the cliff." Memory hygiene is a top-of-mind builder topic (the source
tweets pulled 187 + 756 bookmarks), and this is Arc's weakest subsystem (Feedback) made
concrete and tested against a live 24/7 agent — the exact "tested against a real agent"
overlay the $9 line sells on. Pairs with the existing
`2026-06-23T13:33:02Z_research.md` (session-mining → CLAUDE.md) and
`2026-06-18T19:10:20Z_self-improvement-loop-skills.md` SKU candidates as a Feedback-subsystem
bundle.

## How this was verified

- @alexhillman tweet (daily auto-prune skill, 187 bookmarks) —
  https://x.com/alexhillman/status/2070694867026546935 · · fetched 2026-06-27T14:42:01Z
- `alexknowshtml/claude-memory-health` (MEMORY.md audit skill, MIT) — embedded t.co →
  https://github.com/alexknowshtml/claude-memory-health · · fetched 2026-06-27T14:42:01Z
- @milesdeutscher tweet (self-evolving Memory.md loop, 756 bookmarks) —
  https://x.com/milesdeutscher/status/2070791998026694775 · · fetched 2026-06-27T14:42:01Z
- Repo grounding: `skills/arc-memory/{SKILL.md,cli.ts}`, `memory/MEMORY.md` (192 lines),
  `memory/recent.log` (803 lines), `memory/shared/entries/` (50 files);
  `agent-runtime/src/context.ts` (buildPromptText slice @ :298, truncateText @ :36),
  `agent-runtime/src/types.ts:83`, `agent-runtime/profiles/*/profile.json`.
- Dedup: extends memory entry hermes-agent-convergent-architecture (memory-hygiene
  *rules* convergence); this report adds the *tooling/enforcement* gap. Not previously
  catalogued in `research/INDEX.md`.
