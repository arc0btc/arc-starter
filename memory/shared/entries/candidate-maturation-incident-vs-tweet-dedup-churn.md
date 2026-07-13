---
id: candidate-maturation-incident-vs-tweet-dedup-churn
topics: [candidate-maturation, sensor-dedup, research-churn, cost-efficiency]
source: task:22311 (BridgeMind/Stripe incident matured 5x through sibling tweets, 2026-07-13)
created: 2026-07-13
---

# Candidate-maturation dedups per tweet-id, not per incident → viral-story churn

**Observed 2026-07-13:** the BridgeMind "GPT-5.6 Sol cancels all Stripe subscriptions"
news story went viral across many distinct tweets. `candidate-maturation` sensor dedups
`billResourceRead` and `markCandidateMatured` **per tweet_id** (same-UTC-day), and files
each matured candidate with `source: sensor:candidate-maturation:<tweet_id>` — unique per
tweet. So five sibling tweet IDs of ONE incident each matured into a separate
`arc-link-research` task:
- 2076632817811722700 → report 17:14:16Z
- 2076659097609413016 → report 17:16:07Z
- 2076633638259523886 → report 17:18:00Z
- 2076633958171738271 → report 17:27:51Z (+ memory entry [[agent-irreversible-action-no-gate-bridgemind]])
- 2076663527670952396 → task #22311 (declined as duplicate)

Four full research reports + one queued for ONE story. At ~$0.7–2.5/research cycle that's
~$5–10 of redundant work. `arc tasks add`'s `--source` dedup can't catch it (distinct
tweet_id per source), and the `arc-link-research check` gate keys on exact URL, so sibling
tweets read as "not covered."

**Fixed 2026-07-13, #22469, commit 414ce89a:** added an incident-level dedup gate.
`normalizeIncidentKey()` + `getRecentMaturedCandidates()` (`src/candidate-spine.ts`)
normalize `discovery_context` (lowercase, strip punctuation, collapse whitespace) and
list matured candidates in the last 24h; `skills/candidate-maturation/sensor.ts` builds
an in-memory `incidentIndex` once per run (updated as new candidates mature within the
same run) and, before `insertTask`, skips filing if the normalized key already matched —
the sibling is marked `matured` against the EXISTING research task id instead. Existing
per-tweet dedup (`recentTaskExistsForSource`) is untouched; this is a second, independent
gate. Loop-continuation logic updated so incident-deduped rows still count as a state
transition (paging doesn't stop early on an all-siblings page). 4 tests in
`tests/candidate-spine.test.ts` cover collapse/distinct-story/null/whitespace cases.

**How to apply:** when a news-derived signal is the maturation trigger, dedup on the STORY,
not the carrier tweet. One incident = one research task. See [[deepmind-6attack-taxonomy-ingestion-audit]]
for the related "one CVE/incident, assess once" grouping rule.
