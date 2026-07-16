---
id: x-kill-switch-false-positive-reply-restriction-misclassified
topics: [x-api, kill-switch, admission, reply-lane, 403-error, classification-bug]
source: task:22885
created: 2026-07-16
---

`outbound_enabled` kill switch tripped 2026-07-16T00:00:03Z, blocking ALL X posts/replies.
Root cause: `classifyProviderError()` in `skills/social-engine/reply-send.ts` has a
`replyRestrictionSignals` allowlist checked first, then falls through to an unconditional
"any unmatched 401/403 = auth_scope" catch-all (line 143-145, pre-fix). `reply-watchlist-sensor`'s
discovery pass (runs every 2h via cron, `0 */2 * * *`) routinely finds tweets from accounts that
haven't mentioned Arc — X correctly 403s these with `type: not-authorized-for-resource`,
`detail: "You can only reply to or quote posts where you are mentioned or are the author."` This
exact phrasing wasn't in the signal list, so it fell through to the catch-all and was misclassified
as a genuine auth failure, tripping the kill switch on a routine, expected restriction.

**Why:** The signal-list approach is inherently incomplete — X's exact error wording varies and any
unmatched 403 defaults to "assume auth failure, trip kill switch" (fail-closed by design). This is
correct as a last-resort default for truly unknown 403s, but means new/uncatalogued reply-restriction
phrasings will keep tripping the switch until added to the list.

**How to apply:**
- Fixed 2026-07-16 (#22885, commit ba589fa3): added `"you can only reply to"`, `"mentioned or are the
  author"`, `"not-authorized-for-resource"` to `replyRestrictionSignals`.
- Verify a trip is a false positive before treating it as a real anomaly: check
  `engagement_log.notes` for the `unknown` event on the tripping `outbound_action` row — it contains
  the raw provider JSON. `arc skills run --name social-x-posting -- status` returning "connected"
  (not "locked") + no other 403s in the surrounding window rules out account lock
  ([[x-reply-403-account-lock-cascade]] is a *different* pattern — repeated self-reply 403s
  escalating to lock; this is a single third-party-reply 403 misclassified, not a lock cascade).
- **No CLI/script path exists to re-enable `outbound_enabled=true`** — by design, every code path
  that touches the flag only sets it to `false` (except test fixtures). Re-enabling after a trip
  requires either a new CLI command or a direct DB write; per standing task instructions, dispatch
  should NOT raw-SQL the flag back to true even after confirming a false positive — escalate to
  operator for the actual flip, but the diagnosis/fix work (this entry) can and should happen
  autonomously first so the operator's decision is a one-line "yes, flip it," not a full investigation.
- Consider a follow-up: add a narrow `arc skills run --name social-engine -- kill-switch enable
  --reason <text>` CLI command so verified-false-positive recoveries don't require raw SQL or an
  idle blocked window while waiting on manual reconciliation.
