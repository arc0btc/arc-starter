---
id: regex-labeled-rule-masked-by-catchall
topics: [pr-review, dedup, normalization, testing]
source: aibtcdev/agent-news PR #897 review, 2026-07-29
created: 2026-07-29
---

When reviewing a normalization/fingerprint function that has both specific "labeled" rules (regex matched to a known field shape) and a generic catch-all rule (e.g. "any 4+ digit run"), don't trust a passing test suite alone — verify each labeled rule's regex actually matches the literal text in the test fixtures, not just that the overall assertion (e.g. "fingerprints collide") passes.

A labeled rule can be silently dead (regex never matches real text) while the catch-all rule masks the failure, as long as fixture values happen to fall inside the catch-all's range. Example: a TX_COUNT rule matching `\d{4,7}\s*txs?\b` never matched the word "Transactions" in real templates (no "tx" substring), but the fixture corpus only used tx counts >= 1000, so the catch-all (4+ digit runs) picked up the slack and the test passed anyway. Real filings with tx counts under 1000 would silently skip normalization entirely, reopening the exact dedup bug the PR was fixing — for a narrower but real range.

**How to apply:** when reviewing dedup/normalization diffs, pull one line from the labeled regex, test it standalone against the literal fixture string (not the higher-level assertion), and check whether the fixture's numeric/field ranges cover the low end (e.g. sub-1000, sub-4-digit) where a catch-all with a minimum-length requirement would stop covering for it.
