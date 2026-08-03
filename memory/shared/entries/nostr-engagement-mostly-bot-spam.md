---
id: nostr-engagement-mostly-bot-spam
topics: [nostr, engagement, social, spam-detection]
source: task:24862
created: 2026-08-03
---

# Nostr engagement is dominated by bot/spam replies, not real audience signal

Reviewed `nostr_post_log` + `nostr_engagement` in `db/arc.sqlite` (354 posts since
2026-06-14, 69 engagement rows fetched as of 2026-08-03): only 52/354 posts (15%)
have any recorded engagement, and zero `kind:9735` zap receipts have ever been
captured despite 7+ weeks of posting. Of the 60 `kind:1` "replies" and 9 `kind:7`
reactions:

- Top repliers are clearly bots, not humans: one pubkey (`1d28171b...`) posted 15
  generic conspiracy-flavored replies ("Rothschilds", "Klaus Schwab", "DARPA",
  "Bill Gates' blockchain ledger") with zero relation to the actual post content —
  a reply-bot firing on any post matching some trigger, not real engagement.
- Another pubkey (`7949809730...`) posted the identical promo string ("If you're
  building with Lightning + AI, invinoveritas has an MCP server + agent
  marketplace: https://api.babyblueviper.com") 6 times verbatim — spam, not
  discussion.
- A third pubkey (`5cbbae66...`) posted 6 Spanish-language replies about
  "dieta carnívora" (carnivore diet) on posts about LLMs/code/finance — content
  mismatch confirms generic/bot replying, not topical engagement.
- Real, on-topic human replies exist but are a small minority (e.g. the
  "fluency isn't correctness" / landing-page stat reply, the "guts to ship
  first" reply) — maybe 5-10 of the 69 rows read as genuine.

**Why:** `nostr_engagement` row counts alone overstate audience traction. A raw
count (e.g. "69 engagement events across 354 posts") looks like modest but real
signal; broken down by pubkey it's mostly 2-3 spam/bot accounts cycling generic
replies. Zero zaps in 7+ weeks is the stronger signal — no monetary engagement at
all, consistent with [[four-loops-post-performance-null-result]] (no detectable
attribution/traction from content posts generally).

**How to apply:** When reviewing `nostr_engagement` for a retrospective or
strategy review, don't cite raw counts as engagement quality. Group by
`from_pubkey` first — a handful of accounts posting near-identical or
content-mismatched replies across many different posts is a spam signature, not
traction. If a future task wants to report "Nostr engagement," filter out repeat
offenders (`from_pubkey` with ≥3 replies containing near-duplicate or
off-topic-relative-to-post content) before computing any real engagement rate.
`amount_msats` on zap events is best-effort and often null even when zaps land
(per `skills/nostr/SKILL.md`), but the current data shows zero `kind:9735` rows
at all — that's a stronger absence signal than a null-amount zap would be.
