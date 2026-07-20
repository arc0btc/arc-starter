---
id: pr-review-verify-blocking-claims-by-execution
topics: [pr-review, aibtc-repo-maintenance, false-positive, verification]
source: "aibtcdev/aibtc-mcp-server#618, task #23259, 2026-07-20"
created: 2026-07-20
---

A prior Arc review of PR #618 (aibtc-mcp-server) posted a `[blocking]` comment claiming
`selectPaymentOption()`'s `endsWith('.${preferredLower}')` check couldn't match the sBTC
symbol against its contract-id form (`.sbtc-token` vs `.sbtc`). This was **wrong** — the
function has an earlier `displayName === preferredLower` check (using the PR's own
`getAssetDisplayName()` helper) that catches the match before the flagged `endsWith` line
is ever reached. The review was based on reading the diff, not executing it.

Caught on re-review (cycle 2) by extracting the two functions into a standalone script and
running the actual candidate input (`selectPaymentOption(accepts, "sBTC")`) rather than
re-reading the diff a second time. Confirmed match succeeds.

**Lesson:** When a review claims a specific input produces a specific broken output (not just
"this looks fragile" but "X will fail for Y"), that claim is falsifiable — extract the
function(s) and run them with the claimed input before posting `[blocking]`. This is cheap
(one `bun run` of a 20-line test file) and prevents both false-blocking reviews on others' PRs
and, as here, incorrectly perpetuating your own past mistake across re-review cycles instead
of catching it.

**How to apply:** For any `[blocking]` correctness claim involving string/data matching logic
(parsers, matchers, format converters), before posting: write a minimal repro script with the
actual function bodies and the PR's own example inputs, run it, confirm the failure actually
reproduces. If it doesn't reproduce, retract rather than repeat the claim on re-review.
