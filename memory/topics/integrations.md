## Integration Learnings

**arc-payments rename (2026-03-12):** `stacks-payments` → `arc-payments`. Now monitors both STX token_transfer and sBTC SIP-010 contract_call (SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token). PR review sensor accepts both old and new source prefixes for backwards compat. Hook state key is now `arc-payments` (cold-start safe, dedup handles reprocessing).

**SkillMaintenanceMachine (2026-03-12):** Added `skill-maintenance` state machine for email-signal→audit→fix pattern. Reduces ad-hoc handling when recurring skill failures surface via email. Lives in `skills/arc-workflows/` state machine registry.

**Model field fix (2026-03-12):** Resolved — `updateTask(task.id, { model: cycleModelLabel })` added to dispatch.ts (commit 6dfb32d). Backfilled 1660 historical tasks from cycle_log. ~1182 older tasks remain NULL (pre-date model tracking or never dispatched).

**Cloudflare credential-health false-positive 401s (2026-03-16, RESOLVED):**
  - Root cause: original sensor (commit 7c91b95) used user-scoped endpoint `/user/tokens/verify` which returns 401 for account-scoped tokens
  - Fix: commit 979b0ee switched to account-scoped endpoint via `verifyCloudflareToken()` from `src/cloudflare.ts`
  - Token and account_id were valid the entire time — confirmed by whoabuddy and direct API test
  - 6 false-positive [FLAG] entries removed (13:10Z–18:12Z on 2026-03-16)

**arc-email-worker (Cloudflare) verified-address restriction (2026-03-17):**
  - Cloudflare email workers can only send to *verified* destination addresses (set in Cloudflare dashboard)
  - Cannot send to arbitrary external recipients (e.g. support@moltbook.com) — task #6068 failed on this
  - Workaround: save composed email body to project scratchpad; whoabuddy sends manually or adds SMTP relay
  - For arbitrary external email, an SMTP relay skill (Resend/SendGrid/Postmark) is needed
  - Do NOT create tasks to send external email via arc-email-worker unless recipient is a known verified address

**Cloudflare API token rotation (2026-03-17):**
  - Token created 2026-03-11 returned 401 by 2026-03-17 (task #5908)
  - No automated rotation monitoring in place
  - Manual remediation: whoabuddy → dash.cloudflare.com → My Profile → API Tokens → regenerate → `arc creds set --service cloudflare --key api_token --value <new>`
  - Consider adding token-age monitoring to the credential-health sensor

**X Articles API — not available (2026-03-17):**
  - X Articles is a Premium UI-only feature (rich text, up to 100k chars)
  - No programmatic API endpoint exists — only `/2/tweets` for content creation
  - Cannot implement article publishing via API
  - Long-form content: use blog skill + X syndication for promotion
  - Do NOT create tasks to add X Articles API support — it doesn't exist

**ALB deployment — Arc can deploy (2026-03-17, whoabuddy confirmed):**
  - Arc has credentials for ALL arc0btc repos — deployment was never blocked by whoabuddy
  - Deploy should be part of Arc's process or handled through CI
  - Do NOT create tasks requesting whoabuddy to deploy arc0btc repos

**BIP-137 signing is legacy (2026-03-17):**
  - BIP-137 used compressed legacy Bitcoin addresses — do not implement new auth features against it
  - Use BIP-340/segwit (Taproot or native SegWit) for all new Bitcoin signing integrations
  - ALB and agentslovebitcoin.com auth uses segwit addresses (bc1q... format)
  - SIP-018 remains current for Stacks message signing

**Agent email domain migration (2026-03-17, whoabuddy):**
  - Agent emails moving from @arc0.me to @agentslovebitcoin.com
  - Arc: trustless_indra@agentslovebitcoin.com
  - Spark: topaz_centaur@agentslovebitcoin.com (was spark@arc0.me — decommissioning)
  - Other agents: aibtcName@agentslovebitcoin.com (lowercase identity name, spaces→underscores)
  - Update all references: sensor config, email routing, SKILL.md docs
  - arc0.me addresses will be decommissioned — do not create tasks using old addresses

**X Analytics dashboard — browser-only, no API (2026-03-17):**
  - analytics.x.com requires authenticated X Premium browser session
  - No programmatic API equivalent for engagement rate, impressions, profile visits, etc.
  - Tasks #6173 and #6174 both failed on this — confirmed external-constraint
  - Workaround: whoabuddy retrieves manually from dashboard; record in memory/topics/publishing.md
  - Do NOT create tasks to programmatically access X analytics — must be manual
