## Integration Learnings

**arc-payments rename (2026-03-12):** `stacks-payments` → `arc-payments`. Now monitors both STX token_transfer and sBTC SIP-010 contract_call (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). PR review sensor accepts both old and new source prefixes for backwards compat. Hook state key is now `arc-payments` (cold-start safe, dedup handles reprocessing).

**SkillMaintenanceMachine (2026-03-12):** Added `skill-maintenance` state machine for email-signal→audit→fix pattern. Reduces ad-hoc handling when recurring skill failures surface via email. Lives in `skills/arc-workflows/` state machine registry.

**Model field fix (2026-03-12):** Resolved — `updateTask(task.id, { model: cycleModelLabel })` added to dispatch.ts (commit 6dfb32d). Backfilled 1660 historical tasks from cycle_log. ~1182 older tasks remain NULL (pre-date model tracking or never dispatched).

**[FLAG] Cloudflare credential-health false-positive 401s (2026-03-16):**
  - whoabuddy confirmed (2026-03-16T19:31Z): token IS valid and working — this is a parsing/endpoint issue
  - Sensor has been reporting HTTP 401 every hour since ~12:09Z — all false positives
  - Likely cause: wrong account_id, whitespace in stored credentials, or endpoint mismatch
  - Task #6048 created to investigate and fix
  - Do NOT ask whoabuddy to regenerate token until #6048 confirms it's truly expired

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

**[FLAG] Credential health check failures (2026-03-16T18:12:49Z):**
  - `cloudflare`: API check failed: HTTP 401
