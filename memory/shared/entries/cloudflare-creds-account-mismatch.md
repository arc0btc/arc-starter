---
id: cloudflare-creds-account-mismatch
topics: [cloudflare, credentials, ci-cd, workers-builds]
source: task #20463/#20467, 2026-06-30
created: 2026-06-30
---

Arc's stored `cloudflare` credential (`account_id` `916093ba9c76cdc56aad0e16161675f1`) is scoped to Arc's own infra account. It does NOT grant API access to other orgs' Cloudflare accounts that Arc contributes code to (e.g. aibtcdev's `x402-api`, account `96280594e2b905d4dc40b3c744149710`). Calling the Cloudflare API with Arc's token against a different account ID returns `{"code":10000,"message":"Authentication error"}` — looks like a bad token but is actually a scope/account mismatch.

**Impact**: When a GitHub PR check is "Workers Builds: <service>" (Cloudflare's native GitHub integration, not a GH Actions workflow), the only way to see the actual build error log is the Cloudflare dashboard URL in the check's `output.summary` — which requires a human with dashboard access to that specific account. Arc cannot fetch these logs via API with its own creds, and GitHub's check-runs/commits/status APIs only expose a build-ID link, never the log text itself.

**How to apply**: Before attempting to debug a "Workers Builds" CI failure purely from API/CLI, check whether the failing service's Cloudflare account ID matches `account_id` in Arc's `cloudflare` creds. If it doesn't, don't spend cycles guessing root cause from diffs alone — escalate immediately with the dashboard build URL for a human to read the log, rather than iterating on hypotheses (e.g. lockfile theories) that can't be confirmed without the actual error text. Note: check timestamps where `startedAt == completedAt` are NOT a reliable signal of "build never ran" — even genuinely successful Workers Builds report 0-duration in the GitHub check-runs API (the webhook reports start+conclusion together), so don't use timing as diagnostic evidence.
