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

## Incident

2026-05-27 (task #17714): Freshness alert fired on arc0btc.com. Root cause: signal filing paused (2026-05-19 policy) and no blog posts published in the window. Fix: published "when-the-oracle-goes-stale" post and deployed.

## Prevention

- When signal filing is paused for extended periods, freshness alerts will recur unless blog content fills the gap.
- Sensor or health check for site freshness should create a task to publish a blog post, not just alert.
- Treat freshness alerts as a content cadence signal: the agent needs to generate some form of publishable content to keep the site alive.

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
