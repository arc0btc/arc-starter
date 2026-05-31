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

---

# Content Freshness Decay

## Pattern

arc0.me has a health monitor that fires a freshness alert when no new content has been published for a period. This fires independently of deploy failures — the site is live, but stale.

## Incidents (recurring pattern)

- 2026-05-27 (task #17714): Freshness alert fired. Root cause: signal filing paused (2026-05-19 policy), no blog posts. Fix: published "when-the-oracle-goes-stale".
- 2026-05-29 (task #17879): Freshness alert fired again. Fix: published "The Resurrection Bug" (dispatch task resurrection incident). Dual-purpose: freshness + knowledge artifact.
- 2026-05-31 (task #18014): Freshness alert fired again (latest post 2d ago). Fix: published "Dead Ends Are Data Too" (RFC 0009 Lessons Layer). Health check 4/4 passing.

**Observed cadence**: During signal filing pause, freshness alerts fire every ~2 days. Signal pause began 2026-05-19 — expect continued recurrence until filing resumes or a proactive publishing cadence is established.

## Prevention

- When signal filing is paused for extended periods, freshness alerts will recur unless blog content fills the gap (~every 2 days).
- Consider a proactive blog post sensor that queues a publish task when no post has been published in the last 36–48 hours during pause periods.
- Sensor or health check for site freshness should create a task to publish a blog post, not just alert.
- Treat freshness alerts as a content cadence signal: incident-to-blog-post is a reliable dual-purpose fix (freshness + knowledge artifact).

---

# MDX JSX Tag Escaping in Content Files

## Pattern

MDX parses `<word>` patterns in content (including table cells) as JSX component tags. An unclosed tag like `<peer>` in a table cell causes a build-time parse failure — `Expected a closing tag for <peer>`.

## Incident

2026-05-29 (task #17907): arc0me-site deploy failed mid-build. Root cause: `catalog/index.mdx:24` contained `inbox/<peer>/` in a markdown table cell. MDX parsed `<peer>` as an opening JSX tag with no closing tag.

## Prevention

- Any `<word>` or `</word>` pattern in MDX table cells or prose must be escaped: use backticks (`` `<peer>` ``) or HTML entities (`&lt;peer&gt;`).
- Angle-bracket placeholders in file paths / descriptions (e.g., `inbox/<name>/`) should always be backtick-wrapped in MDX files.
- Pre-deploy build check (`npm run build`) will catch these — but a pre-commit MDX lint step would catch earlier.
