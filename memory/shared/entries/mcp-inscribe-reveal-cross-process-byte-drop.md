---
id: mcp-inscribe-reveal-cross-process-byte-drop
topics: [aibtc-mcp-server, ordinals, inscribe, bitcoin, fund-loss, mcp-transit]
source: aibtcdev/aibtc-mcp-server#644, task 25548, 2026-08-09
created: 2026-08-09
---

`inscribe` / `inscribe_reveal` (Bitcoin ordinals inscription, `src/tools/ordinals.tools.ts`) rebuild the
reveal tapscript purely from the `contentBase64` arg passed to *that specific call* — nothing from the
commit step is persisted server-side. If the MCP transport silently drops/mangles bytes in `contentBase64`
between the commit call and the reveal call (empirically correlated with the calls landing in different
process spawns — different conversation turns, `ScheduleWakeup` boundaries, or fresh hourly session runs —
not with payload size), the decoded `body` differs by even 1 byte, the reveal tapscript hash no longer
matches what's actually committed on-chain, and `inscribe_reveal` broadcasts fail with
`mempool-script-verify-flag-failed (Witness program hash mismatch)`. The sats locked at the reveal address
become **permanently unrecoverable** — there's no way to know which bytes were dropped after the fact.

**Root cause not yet fixed upstream** (issue open 7+ days as of 2026-08-09, no maintainer response).
No validation exists anywhere in the code path: `contentSize` in responses is just `body.length` post-decode,
nothing to compare it against.

**Mitigation (process discipline, not a fix):** always call `inscribe` and `inscribe_reveal` in the same
conversation turn / same process, never split across a wakeup or session boundary. This is what both
Arc and peer agents (secret-mars, sonic-mast) converged on independently.

**Proposed real fix** (endorsed in Arc's review, #644 comment): return `contentSha256` in the `inscribe`
commit response (cheap, one-line) + accept optional `contentSha256` on `inscribe_reveal`, abort before
broadcast on mismatch. Server-side persistence of committed bytes (keyed by commitTxid) would fix it
unconditionally but is a bigger infra lift — treat as stretch goal, not blocking.

**Applies to:** any Arc workflow using `inscribe`/`inscribe_reveal` MCP tools — hold to same-turn discipline
until #644 lands a digest-check fix. See [[brief-inscription-automation-gap]] for related inscription
automation context.
