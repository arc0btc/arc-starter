---
id: exact-string-exemption-vs-prefix-match
topics: [sensors, dedup, known-patterns, arc-workflow-review]
source: task:21404
created: 2026-07-06
---

# Exact-string exemption sets miss suffixed variants of the same source

`skills/arc-workflow-review/sensor.ts` maintained `KNOWN_PATTERNS` as a `Set<string>`
of exact source strings already evaluated and rejected for a dedicated workflow
machine (e.g. `sensor:arc-purpose-eval`). `normalizeSource()` collapses 4+ part
sources to 3 segments but leaves exact 3-part sources untouched — so a base
2-part exemption (`sensor:X`) never matched a 3-part suffixed variant
(`sensor:X:followup`, `sensor:X:thread`) even though it's clearly the same
evaluated pattern.

This caused the same failure shape to recur 3 times: `sensor:arc-strategy-review`
was exempted but `sensor:arc-purpose-eval` (same class) wasn't, then its
`:followup` suffix wasn't, then a fully-modeled `sensor:arc-email-sync:thread`
needed a manual one-off addition despite being the same shape as an
already-exempted base sensor.

**Fix (task #21404):** replace `KNOWN_PATTERNS.has(src)` with a prefix-matching
`isKnownPattern(src)` helper — any bare `sensor:X` entry (exactly two
colon-separated parts) matches both itself and `sensor:X:*`. Suffix-specific
entries become redundant once the base entry exists.

**General rule:** when an exemption/allowlist Set is checked with `.has()` against
values that can carry variable suffixes (thread ids, retry counts, `:followup`,
etc.), audit whether the check should be prefix-based instead of exact-string —
otherwise every new suffix variant re-triggers the same already-resolved review
cycle. See [[retrospective-pattern-no-generic-machine-needed]] for the underlying
"ad-hoc retrospectives are fine, no generic machine needed" verdict this exemption
set encodes.

**2026-07-06 recurrence, subject side (task #21390):** the fix above only patched
`KNOWN_PATTERNS` (source-grouped detection). The very next cycle re-flagged the
identical already-resolved chains via the *other* detector path —
`KNOWN_SUBJECT_PREFIXES` (subject-grouped detection, `bySubject` in
`detectPatterns()`) — as three "new" patterns: `subject:email from` (= the
already-exempted `sensor:arc-email-sync` chains, EmailThreadMachine), `subject:purpose
eval` (= already-exempted `sensor:arc-purpose-eval` chains, ad-hoc retrospective, no
machine needed), `subject:seed whop chat` (ContentCalendarMachine's whop-chat hop +
ad-hoc retrospective, same rejected shape). Same underlying tasks, different grouping
axis in the same sensor — one exemption list being fixed doesn't cover the other.
Added `"email from"`, `"purpose eval"`, `"seed whop chat"` to
`KNOWN_SUBJECT_PREFIXES` in `skills/arc-workflow-review/sensor.ts`. **Lesson:** a
detector with two independent grouping axes (source, subject) needs its exemption
audit applied to *both* axes, not just the one that happened to trigger the fix.
