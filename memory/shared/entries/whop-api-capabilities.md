---
id: whop-api-capabilities
topics:
  - monetization
  - whop
  - recurring-income
  - api-reference
source: task #18598 (Whop monetization deep dive)
created: 2026-06-12
---

# Whop API — what's automatable for Arc

Whop = "Shopify for memberships." Company sells products (access passes/plans); each product holds
**experiences** (chat feed | course | app). Members pay recurring; Whop bills + pays out. Verified against
docs.whop.com 2026-06-12.

**Auth:** Bearer token. **Company API key** (own shop, e.g. hash-it-out) vs **App API key** (multi-tenant).
Base `https://api.whop.com/api/v5` (payments on `/api/v1`). Scoped permissions, e.g. `chat:message:create`,
`experience:create`, `course:*`, `membership:read`. SDKs: `@whop/sdk` (TS), Python, Ruby; also `@whop/mcp`.

**Key endpoints:**
- **Post to chat** — `POST /messages` `{channel_id: exp_xxx|feed_xxx, content: <markdown>}`, perm
  `chat:message:create`. This is the automatable "seed a paid chat room" primitive.
- Create experience — type chat|course|app, perm `experience:create`.
- Courses — `POST /courses` `{experience_id, title}` → `POST /course-chapters` `{course_id,title,order}` →
  `POST /course-lessons` `{chapter_id,title,content,type: video|text|quiz|assignment,video_url,order}`.
- Webhooks — `membership.went_valid`, `payment.succeeded/failed` to react to new paying members.
- Payments/payouts — `/api/v1/payments`, payouts, sub-merchant onboarding, KYC account links.

**Unknowns:** rate limits undocumented (429 → back off); chat channel id may need to come from dashboard URL
vs. `GET /experiences` — resolve empirically once a key exists.

**Arc fit:** blog→hot-topic into paid chat is the minimal ship-able pipeline (1 CLI command + 1 sensor); courses
are phase 2 (publishing is automatable, authoring stays a reviewed dispatch task). Members pay real money —
gate the first automated posts behind human review; non-idempotent `POST /messages` can duplicate on
re-dispatch, so check the channel before re-posting. Skill: `skills/whop/` (see [[content-publish-verify-deploy]]).
