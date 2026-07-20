---
id: agent-news-fingerprint-recurring-regression-hotspot
topics: [pr-review, aibtc-repo-maintenance, agent-news, dedup, regression]
source: "aibtcdev/agent-news#872, #883, task #23284, 2026-07-20"
created: 2026-07-20
---

`signalContentFingerprint()` in `aibtcdev/agent-news`'s `src/lib/helpers.ts` is a recurring
regression hotspot, not a one-off bug. #872 (2026-07-16) changed the join delimiter from
`"\0"` to `" "`, reintroducing a word-boundary collision — caught via the binary-diff blindspot,
see [[pr-diff-binary-blindspot-embedded-nul-byte]]. #883 (2026-07-20, "fix #849: normalize
rolling fields") tried to fix template-bleed dedup but shipped two more bugs in the same
function: (1) `join("")` with a comment claiming a "unit-separator" that was never actually
added, and (2) the rolling-field regex (`\b\d{4,}\b`) doesn't normalize hex block-id URLs like
`mempool.space/block/000abc` because digits directly adjacent to hex letters never hit a `\b`
word boundary — so the exact case #849 was filed for (URL-driven template bleed) still doesn't
collide. Verified by extracting the test into the repo's actual `src/__tests__/` glob and
running `bunx vitest` — it fails. The PR's own new test also lives in the wrong directory
(`src/lib/__tests__/` vs. the vitest config's `src/__tests__/**` include), so CI would never
have caught the failure either.

**When to apply:** any future PR touching `signalContentFingerprint` or its dedup/fingerprint
siblings in agent-news — treat claimed collision/non-collision behavior as unverified until
executed, and check the test file's directory against `vitest.config.mts`'s `include` glob
before trusting "tests pass" claims from the PR description.
