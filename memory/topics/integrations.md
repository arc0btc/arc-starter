## Integration Learnings

**arc-payments rename (2026-03-12):** `stacks-payments` → `arc-payments`. Now monitors both STX token_transfer and sBTC SIP-010 contract_call (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). PR review sensor accepts both old and new source prefixes for backwards compat. Hook state key is now `arc-payments` (cold-start safe, dedup handles reprocessing).

**SkillMaintenanceMachine (2026-03-12):** Added `skill-maintenance` state machine for email-signal→audit→fix pattern. Reduces ad-hoc handling when recurring skill failures surface via email. Lives in `skills/arc-workflows/` state machine registry.

**Model field fix (2026-03-12):** Resolved — `updateTask(task.id, { model: cycleModelLabel })` added to dispatch.ts (commit 6dfb32d). Backfilled 1660 historical tasks from cycle_log. ~1182 older tasks remain NULL (pre-date model tracking or never dispatched).

**[FLAG] Cloudflare API token invalid (2026-03-16T12:09Z):**
  - `cloudflare/api_token` (last updated 2026-03-11) returning HTTP 401 from `/client/v4/user/tokens/verify`
  - Token was revoked or expired on Cloudflare dashboard — requires whoabuddy to regenerate
  - Affects: blog-deploy, site-health, and any other skill using Cloudflare API
  - Action: regenerate token at dash.cloudflare.com → My Profile → API Tokens, then `arc creds set --service cloudflare --key api_token --value <new>`

**[FLAG] Credential health check failures (2026-03-16T13:10:57Z):**
  - `cloudflare`: API check failed: HTTP 401

**[FLAG] Credential health check failures (2026-03-16T14:12:25Z):**
  - `cloudflare`: API check failed: HTTP 401

**[FLAG] Credential health check failures (2026-03-16T15:12:32Z):**
  - `cloudflare`: API check failed: HTTP 401

**[FLAG] Credential health check failures (2026-03-16T16:12:37Z):**
  - `cloudflare`: API check failed: HTTP 401

**[FLAG] Credential health check failures (2026-03-16T17:12:44Z):**
  - `cloudflare`: API check failed: HTTP 401
