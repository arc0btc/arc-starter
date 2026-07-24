---
id: codex-adversarial-review-gate-assessment
topics: [pr-workflow, codex, model-routing, cross-model-review]
source: task:22621 (assessment), parent research task:22617
created: 2026-07-14
---

# Assessment: optional codex cross-check in PR workflow step 4/5

**Question:** should Arc wire an optional `--model codex` adversarial second-opinion
gate into CLAUDE.md's PR workflow steps 4 (Code Review) / 5 (Ultrareview)?

**Finding:** `/code-review` and `/ultrareview` are opaque Claude Code product
slash-commands, not Arc-owned skill code — there's no internal hook to attach a
cross-model call to. The only real wiring point is CLAUDE.md's documented workflow
text itself: add a new manual step (e.g. after step 5) that calls
`dispatchCodex()` (`src/codex.ts`, already implemented and used by the web arena
feature) with a diff + review prompt, non-blocking/advisory only.

**Feasibility:** low effort. `dispatchCodex(prompt, model?, cwd?)` already exists,
handles binary resolution, timeout, and cost estimation. A thin CLI wrapper
(`arc skills run --name <skill> -- codex-review --diff`) is the only net-new code.

**Recommendation:** don't build unconditionally.
1. Gate to high-stakes PRs only (same bar CLAUDE.md already uses for opus:
   cross-file architectural ambiguity, irreversible actions) — running it on every
   PR adds cost/latency for marginal benefit on routine 1-2 file fixes.
2. CLAUDE.md's PR workflow (steps 1-9) is a standing cross-repo SOP — editing its
   documented steps needs whoabuddy sign-off before Arc changes it unilaterally,
   same pattern as other CLAUDE.md-level proposals (see arc-0013-fleet-dispatch in
   MEMORY.md Active Items).
3. Cost tradeoff needs one real data point before committing: an o4-mini codex
   review pass on a typical PR diff (~$0.01-0.05 est.) is cheap per-run but adds a
   full codex CLI subprocess dispatch (up to 15min timeout) to the critical path.

**Verdict:** filed as a low-priority follow-up proposal, not implemented. Net gap
is real but narrow — Arc's codex SDK route + web arena already give architecturally
richer cross-model capability than the plugin pattern that prompted this research;
missing piece is just wiring it into the documented workflow with sign-off.
