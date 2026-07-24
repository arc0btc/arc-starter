# ARC-0014: Optional Codex Adversarial Cross-Check for High-Stakes PRs

| Field | Value |
|-------|-------|
| ARC | 0014 |
| Title | Optional Codex Adversarial Cross-Check for High-Stakes PRs |
| Author | Arc |
| Status | Proposed — awaiting whoabuddy sign-off |
| Created | 2026-07-14 |
| Requires | none (uses existing `dispatchCodex()`, `src/codex.ts`) |

---

## Context

CLAUDE.md's PR Workflow (steps 1–9) is a standing cross-repo SOP. Steps 4 and 5 are the
quality gates before a PR is opened:

4. **Code Review** — `/code-review --fix` (Claude Code product slash-command, opaque, not
   Arc-owned skill code)
5. **Ultrareview** — `/ultrareview` (same — user-triggered slash command, final deep quality
   gate)

Both gates are Claude reviewing Claude's own work. There is no cross-model check anywhere in
the documented workflow.

`src/codex.ts` already implements `dispatchCodex(prompt, model?, cwd?)` — spawns the OpenAI
Codex CLI as a subprocess (o3/o4-mini/gpt-4.1/gpt-5.4), returns `{ result, cost_usd,
api_cost_usd, input_tokens, output_tokens }`. It already handles binary resolution (PATH +
nvm fallback), a 15-minute timeout, and cost estimation from known per-model pricing. It is
already used by the web arena feature — this is not new infrastructure, just an unused second
consumer.

This proposal was triggered by research into how the OpenAI Codex plugin pattern runs inside
Claude Code (task #22617) and an assessment (task #22621,
`memory/shared/entries/codex-adversarial-review-gate-assessment.md`) of whether that pattern is
worth wiring into Arc's own PR workflow.

---

## Motivation

`/code-review` and `/ultrareview` both run on the same model family reviewing its own diff.
Same-model review shares blind spots with the model that wrote the code — a structural version
of the maker=checker problem ARC-0013 names for task verification, applied to code review
instead of task completion.

If we do nothing: PRs continue to pass through two Claude-on-Claude gates with no independent
second opinion, and any blind spot common to Claude's review style on a given diff shape goes
uncaught by both gates simultaneously.

This is a narrow gap, not a broad one. Arc's codex SDK route plus the web arena already give
richer cross-model capability than the plugin pattern that prompted the research — the missing
piece is only wiring the existing capability into the *documented* workflow, which requires
sign-off because CLAUDE.md's PR workflow is shared SOP text, not code Arc can edit unilaterally.

---

## Proposal

Add a new optional step **after step 5 (Ultrareview)** in CLAUDE.md's PR Workflow:

**5a. Codex cross-check (optional, high-stakes PRs only)** — for PRs that meet the same
high-stakes bar CLAUDE.md already defines for opus routing (cross-file architectural
ambiguity spanning 3+ files/subsystems with no established pattern, or an irreversible
action), run a thin CLI wrapper that calls `dispatchCodex()` with the PR diff and a review
prompt (correctness, security, and "what would you flag that a same-model reviewer might
miss"). Advisory only — does not block PR creation. Findings get posted as a PR comment or
folded into the PR description at the author's discretion, same as `/code-review`'s
non-`--fix` findings today.

**Gating, explicitly not "run on every PR":**
- Routine 1–2 file fixes, config changes, and bounded follow-ups skip this step — same bar as
  the existing sonnet-vs-opus routing rule.
- Skipped by default; the author (Arc, at dispatch time) decides per-PR whether the bar is
  met, same judgment call already made for model routing.

**Implementation, scoped to the minimum:**
- One new skill (or a CLI subcommand on an existing review-adjacent skill) wrapping
  `dispatchCodex(diffPlusPrompt, "o4-mini")` — `o4-mini` is the cheapest available Codex model
  ($1.10/$4.40 per M tokens) and is the right default absent evidence a larger model is needed.
- No new columns, no new DB tables — this is a manual/optional workflow step, not a sensor or
  a dispatch-gated automatic stage.

---

## Cost / Latency

No real data point exists yet. Estimate from `CODEX_PRICING` in `src/codex.ts`:
`o4-mini` = $1.10/M input, $4.40/M output. A typical PR diff + review prompt is small
(low thousands of tokens in, low hundreds out) — sub-$0.05/run on paper. The real unknown is
**latency**: `dispatchCodex()` spawns a full Codex CLI subprocess with a 15-minute timeout,
which is a meaningfully heavier tax on the critical path than the sub-minute cost of
`/code-review`. Recommend running one real trial on a genuine high-stakes PR diff before this
becomes a habitual step, to get an actual cost+latency number instead of an estimate.

---

## Open Questions (whoabuddy decides)

1. **Sign-off to edit CLAUDE.md's PR Workflow section** — adding step 5a to the documented
   SOP. No code changes ship without this; the CLI wrapper is trivial once the workflow text
   is approved.
2. **Gating bar** — is "same bar as opus routing" the right high-stakes threshold, or should
   this be rarer (e.g. only irreversible/on-chain-touching PRs)?
3. **Model choice** — `o4-mini` as the default, or is a stronger Codex model worth the extra
   cost for genuine adversarial coverage?
4. **Blocking vs advisory** — this proposal keeps it advisory-only (same posture ARC-0013 §6
   recommends starting with for maker≠checker: log first, measure disagreement rate, decide
   later whether to block).

---

## Non-goals / risks

- This spec authorizes **no code and no CLAUDE.md edit.** It is the scoped proposal for
  whoabuddy's sign-off; the CLI wrapper (~trivial, `dispatchCodex()` already does the work)
  starts only after approval.
- Running this on every PR (not just high-stakes ones) would add cost/latency for marginal
  benefit on routine fixes — explicitly out of scope per the gating rule above.
- No real cost/latency data point exists yet; the first live run should be treated as a
  calibration trial, not a committed baseline.
