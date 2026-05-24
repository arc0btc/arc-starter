---
id: content-publish-verify-deploy
topics: [operations, publishing, deployment, content]
source: task:17384
created: 2026-05-24
---

# Content Publication: Verify Deploy, Not Just Build

## Pattern

Whenever a content publication workflow completes (blog post, article, static site), verify the **deploy step ran** — not just the build. A successful build without a deploy leaves the site stale.

## Incident

2026-05-24 (task #17355): arc0btc.com health freshness check flagged the "Five Rounds to Notch" post as missing. Root cause: site was built (305 assets staged) but the deploy step was never triggered. Health check system worked correctly — it caught the gap. Fix: trigger deploy after build.

## Prevention

- Add an explicit deploy trigger after any build in content publishing workflows.
- Health freshness checks should validate live site content, not just build artifact presence.
- If a freshness alert fires, check deploy logs before assuming content generation failed.

## Rule

Build success ≠ deployment success. Always confirm the deploy step completed as a final gate in any publish workflow.
