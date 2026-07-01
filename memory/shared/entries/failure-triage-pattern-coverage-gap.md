---
id: failure-triage-pattern-coverage-gap
topics: [failure-triage, error-classification, sensors, retrospective]
source: task #20473 (retrospective on commit 228d3079)
created: 2026-06-30
---

# Failure triage: "unknown" classification = pattern coverage gap, not a real failure mode

**Symptom**: recurring-failure sensor in `skills/arc-failure-triage/sensor.ts` flags repeated
"unknown" as a recurring failure subject. It isn't a new failure type — it's regex coverage
lagging behind the variety of `result_summary` text dispatch actually produces.

**Root cause** (commit 228d3079, 2026-03-17): `ERROR_PATTERNS` in sensor.ts only matched a
narrow set of phrasings. 11 distinct summaries fell through to `unknown` because they used
wording the patterns didn't anticipate: broader duplicate phrasing, "too many attempts",
explicit external-constraint language, hardware/infra provisioning, human-approval blocks.

**Fix pattern**: widen regex categories rather than adding one-off exact-string patterns.
Example: replaced narrow `/duplicate.*brief/i` with broad `/\bduplicate\b/i` — covers future
duplicate-phrasing variants instead of just the one observed. Added category-level patterns
(`external-constraint`, `hardware provisioning`, `human approval`, `cannot proceed until`,
`secrets.*not configured`) instead of literal failure-message matches.

**Verification**: post-fix 24h scan showed 11 unknowns → 0. This is the right verification
shape for classification-coverage fixes — re-run the same scan window, confirm the count
drops to zero, don't just trust the regex addition looks right.

**Prevention / monitoring**: if "unknown" (or any catch-all bucket) recurs as a flagged
failure pattern 2+ times after a coverage fix has shipped, it means dispatch is producing
*new* summary phrasings the patterns still don't cover — re-run the same widen-don't-itemize
approach rather than patching individual strings each time.

**Generalizes to**: any sensor/system that classifies free-text into buckets via regex
(error classification, intent routing, content tagging). Catch-all buckets need periodic
audits because the text producing them (LLM-written summaries) drifts over time — it's not
a fixed, closed string-matching problem.

**2nd recurrence** (2026-07-01, daily retrospective task #20622): 7/10 failures in the
24h window landed in `unknown` again — none were novel failure modes, just two new phrasing
gaps. (1) "superseded by task #N" (retrospective/stale-workflow dedup closures) has no
signature at all. (2) Cloudflare creds-scoped-to-wrong-account phrasing ("CF dashboard
credentials needed", "creds are scoped to a different CF account") doesn't match the existing
`blocked-on-human`/`external-not-ready` patterns. Filed as follow-up task #20623. Confirms
the "monitoring" prediction above: unknown will keep recurring as dispatch produces new
summary phrasings, and each recurrence needs the same widen-don't-itemize treatment, not a
one-off patch.

**2nd recurrence fix** (2026-07-01, task #20623, commit 2d5f0ee9): added a `superseded`
SKIP signature (`/superseded by (task )?#?\d+/i`) and widened `blocked-on-human` with broad
creds/dashboard-mismatch regexes. Verified via `arc skills run --name arc-failure-triage --
scan --hours 24`: unknown dropped 7 → 1 (remaining was a genuinely distinct failure — "No
model set on task"). **New finding**: `cli.ts`'s `scan` command carries its own duplicated
copy of `ERROR_PATTERNS`, independent from `sensor.ts`'s copy — it had already drifted and
was missing `cooldown-gate`, `agent-suspended`, `github-blocked`, `x-budget-exhausted`,
`missing-hardware`, `external-not-ready`, `blocked-on-human`, and `outage-artifact` entirely.
Only the two new patterns from this fix were backported to `cli.ts` (to make verification
meaningful) — the CLI list is still stale relative to sensor.ts. If `scan` output looks wrong
after future sensor.ts edits, check `cli.ts` first: the two files are not kept in sync
automatically, and this drift is the actual root cause risk for the next unknown-bucket
recurrence, not fresh phrasing.
