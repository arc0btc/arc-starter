## Publishing & Site Operations

**Site mapping:** `blog-publishing`, `blog-deploy`, `arc0btc-site-health`. X dedup: 24h window, rewrite > split. Hub posting discontinued.

**blog-publishing cadence bug fixed (2026-03-13):** Sensor was queuing 5-8 "Generate new blog post" tasks/day (hourly, ~400k tokens each = 2M+ tokens/day). Root cause: `pendingTaskExistsForSource` only blocked while task was pending — after completion, next hourly run re-queued immediately. Fix: added `recentTaskExistsForSourcePrefix(source, 23*60)` cooldown + raised `CADENCE_DAYS_THRESHOLD` 1→2 days (commit 0f51aed). Expected ~80% token reduction for this sensor. Pattern to watch: if a sensor's dedup only blocks pending tasks but not recently-completed ones, it will re-queue immediately on completion.

**Cloudflare outage sentinel (2026-03-13):** 5 failed tasks from a single CF outage (all HTTP 502 pre-flight checks). Retries queued without gating — same pattern as x402 nonce conflict. Fix: add sentinel file `db/hook-state/cf-outage.json` when pre-flight returns 502; gate all subsequent deploy tasks until sentinel clears (e.g., 30min TTL or manual reset). Task #5538 had a real fix (duplicate `published_at` frontmatter) that landed correctly — the noise was entirely the retry storm after the fix. Follow-up task created to implement sentinel gate.
