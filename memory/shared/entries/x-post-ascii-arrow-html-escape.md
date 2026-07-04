---
id: x-post-ascii-arrow-html-escape
topics: [social-x-posting, content-calendar, whop-wedge]
source: task #21019, 2026-07-04
created: 2026-07-04
---

Using ASCII `->` in an X post body gets HTML-entity-escaped to `-&gt;` somewhere in the
`social-x-posting` post pipeline (observed on a CTA reply tweet composed with `->`). The
literal `-&gt;` then ships to the live tweet, visible to readers. Prior successful CTA
tweets (2026-06-27 through 2026-06-29) all used the real unicode arrow `→` instead of
ASCII `->`, and those did not trigger the escape.

**Fix applied**: delete the malformed tweet (`delete --tweet-id`), repost with `→` under a
new `--source` suffix (e.g. `...:x-cta-2` — reusing the original source is blocked by the
post-log dedup). Confirmed clean on repost.

**Rule going forward**: always compose CTA/thread text with the real `→` character, never
`->`, `--`, or other ASCII approximations that contain `>` — X's API (or Arc's posting
CLI) appears to entity-escape raw `>` in some code path. Worth a root-cause fix in
`skills/social-x-posting/cli.ts` (sanitize/unescape before POST, or reject ASCII arrows at
compose time) rather than relying on every composer remembering to use unicode.
