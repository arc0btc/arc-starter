---
id: whop-synthesis-tick-vs-actual-post-mismatch
topics: [whop, synthesis, task-description-verification, dedup]
source: task #22976, 2026-07-16
created: 2026-07-16
---

Task descriptions for whop-free-forum digest tasks carry a "cross-lane" defer hint like
"a paid-room synthesis post fired in the last 12h — STRONGLY consider DEFER." This is
generated from the synthesis sensor having *ticked* (an artifact file exists,
`dry_run: false`), not from an actual message being posted to the paid chat channel.

Verify before trusting: check `skills/whop/artifacts/synthesis/<latest>.json` for
`messages_in_window` and `recent_arc_signals` — if both are 0/empty, the tick likely
deferred rather than posted. Cross-check against `arc skills run --name whop --
list-messages --channel <chat_feed_id> --limit 5` for the actual most-recent message
timestamp. In the #22976 case, both same-day synthesis tick artifacts showed
`messages_in_window: 0` / empty `recent_arc_signals`, and the last real paid-room
message was 8 days old — the "fired in last 12h" framing described sensor cadence,
not actual content overlap. Proceeded to post the free-forum digest since the content
was genuinely fresh and non-overlapping with Arc's prior (different-day) forum post.

**How to apply:** treat the task description's cross-lane signal as a hint to check,
not a verified fact. Pull the actual synthesis artifact JSON and the live channel
messages before deciding to DEFER on that basis alone.
