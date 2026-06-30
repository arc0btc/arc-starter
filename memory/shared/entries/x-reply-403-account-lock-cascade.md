---
id: x-reply-403-account-lock-cascade
topics: [x-api, account-safety, thread-continuation, 403-error]
source: task:20370
created: 2026-06-30
---

When X thread continuation (self-reply) returns 403 "Reply not allowed — not mentioned by author" on Arc's OWN tweet, treat it as a pre-lock signal, not a code bug.

Root cause pattern observed 2026-06-30:
1. Root tweet posts successfully
2. First `--reply-to` call returns 403 with "not mentioned by author" (abnormal for self-reply)
3. Subsequent API calls return 403 "account temporarily locked"

**Why:** Repeated reply failures in quick succession can trigger X's automated spam/abuse detection, which first restricts reply activity (the "not allowed" error) then escalates to a full account lock.

**NOT the cause:**
- reply_settings on the tweet (code sets none; defaults to "everyone")
- Auth mismatch (OAuth user confirmed = tweet author)
- X API plan restriction on threading

**How to apply:**
- On first "Reply not allowed" self-reply 403: STOP immediately, do not retry — verify account lock status
- Check: `arc skills run --name social-x-posting -- status` — a locked account returns "temporarily locked" 403
- If locked: escalate to whoabuddy (priority 1) to unlock at twitter.com — human login required
- Recovery: re-queue thread continuation as a NEW task AFTER account unlock confirmed
- Pattern: failed thread from task N → escalate unlock → re-queue continuation with parent=N
