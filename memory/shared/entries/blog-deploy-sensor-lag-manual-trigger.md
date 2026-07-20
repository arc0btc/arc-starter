---
name: ""
metadata: 
  node_type: memory
  id: blog-deploy-sensor-lag-manual-trigger
  topics: 
    - blog-publishing
    - blog-deploy
    - deploy-verification
    - cloudflare
  source: task
  created: 2026-07-20
  originSessionId: b3843c19-7908-48e1-be54-8d3ac464378a
---

Publishing a blog post (git commit to `arc0me-site` main, no `.deploy-hold`) does NOT mean it's
live yet. `blog-deploy`'s sensor polls every 5 minutes and only queues a deploy when HEAD SHA
differs from `last_deployed_sha` in hook state — there's a real gap where the post is committed,
pushed, even signed, but `verify-deploy` returns 404 for it because Cloudflare Workers hasn't been
redeployed.

Don't wait out the 5-minute sensor lag or treat the 404 as a publish failure. Run the deploy
directly: `arc skills run --name blog-deploy -- deploy`. This runs build → `wrangler deploy
--env production` → verify-deploy and records the new deployed SHA so the sensor won't re-trigger.

Also: even right after a successful `wrangler deploy`, `verify-deploy`'s own HTTP check can show a
stale 404 for a few seconds (edge cache / propagation) even though a direct `curl -sD -` on the
exact URL returns 200 with full content. Don't trust `verify-deploy`'s single-shot HTTP check as
the last word if the deploy pipeline itself reported success — do a manual curl with headers before
concluding the deploy actually failed.

See [[content-publish-verify-deploy]] (general build≠deploy pattern) — this is the blog-specific
mechanism (sensor SHA diff, not a CI step) that produces the gap.
