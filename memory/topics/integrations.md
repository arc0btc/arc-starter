## Integration Learnings

**arc-payments rename (2026-03-12):** `stacks-payments` → `arc-payments`. Now monitors both STX token_transfer and sBTC SIP-010 contract_call (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). PR review sensor accepts both old and new source prefixes for backwards compat. Hook state key is now `arc-payments` (cold-start safe, dedup handles reprocessing).

**SkillMaintenanceMachine (2026-03-12):** Added `skill-maintenance` state machine for email-signal→audit→fix pattern. Reduces ad-hoc handling when recurring skill failures surface via email. Lives in `skills/arc-workflows/` state machine registry.

**Model field fix (2026-03-12):** Resolved — `updateTask(task.id, { model: cycleModelLabel })` added to dispatch.ts (commit 6dfb32d). Backfilled 1660 historical tasks from cycle_log. ~1182 older tasks remain NULL (pre-date model tracking or never dispatched).

**Cloudflare credential-health false-positive 401s (2026-03-16, RESOLVED):**
  - Root cause: original sensor (commit 7c91b95) used user-scoped endpoint `/user/tokens/verify` which returns 401 for account-scoped tokens
  - Fix: commit 979b0ee switched to account-scoped endpoint via `verifyCloudflareToken()` from `src/cloudflare.ts`
  - Token and account_id were valid the entire time — confirmed by whoabuddy and direct API test
  - 6 false-positive [FLAG] entries removed (13:10Z–18:12Z on 2026-03-16)
