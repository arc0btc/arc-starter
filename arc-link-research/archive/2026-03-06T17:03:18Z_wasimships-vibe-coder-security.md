# Research Report — 2026-03-06T17:03:18Z (re-run)

**Task:** 1707 — @Hartdrawss/@WasimShips vibe coding security article (re-run)
**Links analyzed:** 2 (1 article via X API article field, 1 tweet wrapper)
**Verdict:** medium — Practical security checklist; 6 rules directly applicable to Arc's operational security posture

---

## Tweet: @Hartdrawss amplifying @WasimShips

**URL:** https://x.com/Hartdrawss/status/2029812186097528959
**Relevance:** low (amplification only)

@Hartdrawss (Harshil Tomar, AI MVP builder) bookmarking @WasimShips' security article. Metrics: 321 likes, 476 bookmarks, 32 RTs, 29,802 impressions. High traction for a security checklist.

---

## Article: "30 Security Rules to be the Top 1% VIBE CODER" by @WasimShips

**URL:** https://x.com/i/article/2029805390586888193 (via twitter.com/WasimShips/status/2029811248012173658)
**Relevance:** medium — Security checklist for AI-assisted builders; 6 rules map directly to Arc's ops

### What It Is

A 30-rule security checklist from a founder who's shipped 50+ AI-powered MVPs. Targets developers who use AI (Cursor, Claude Code) to build products. Core thesis: "90% of vibe coded apps ship with security holes. Not because the builders are bad. Because nobody told them the rules."

### Rules Directly Applicable to Arc

**Rule 3 / Rule 4 — Secrets hygiene**
> "Never paste API keys into AI chats. Use process.env. .gitignore is your first file."

Arc uses `~/.aibtc/credentials.enc` (AES-256-GCM) and never stores secrets in plaintext. ✅ Already compliant. Worth periodically auditing that dispatch sessions aren't echoing credential values in logs.

**Rule 5 — Rotate secrets every 90 days**
> "Set a calendar reminder. Treat it like rent."

Arc has no automated rotation cadence. The credentials skill handles storage but not rotation scheduling. **Gap identified.** Consider a quarterly rotation task template.

**Rule 15 / Rule 16 — Rate limit everything from day one**
> "100 requests per hour per IP is a starting point."
> "Password reset routes get their own strict limit — 3 attempts per email per hour max."

Arc's X sensor has a ~4h patience strategy for rate limits. The credentials endpoint has no attempt-limit logic. Relevant if Arc ever exposes any HTTP endpoints publicly.

**Rule 17 — Cap AI API costs in dashboard AND in code**
> "Both. Not one or the other. The dashboard cap saves you from runaway spend. The code-level cap saves you from a misconfigured dashboard."

Arc hit $197.75/$200 daily cap on 2026-03-05. Cap is enforced at dashboard level only. No code-level enforcement in dispatch logic. **Gap identified.** Dual-layer protection is better.

**Rule 24 / Rule 25 — Use AI as security reviewer**
> "Ask the AI to act as a security engineer and review your code."
> "Ask the AI to try and hack your app."

Arc's AgentShield baseline is A (90/100) with two medium findings (permissions block, PreToolUse hooks). The "AI as attacker" pattern is underused — could be applied to Arc's sensor/dispatch attack surface during security reviews.

**Rule 26 — Log critical actions**
> "Deletions, role changes, payments, data exports. If something goes wrong, you need a trail."

Arc's `cycle_log` captures dispatch actions. Critical actions like credential updates, balance movements, and merge operations are not separately flagged for audit. **Minor gap.**

### Rules Not Applicable (Already Handled or Out of Scope)

- Rules 1-2 (session auth, JWT) — Arc has no user-facing auth layer
- Rule 9 (SQL injection) — Arc uses `bun:sqlite` with parameterized queries
- Rules 19-22 (storage buckets, file uploads, payments, email infra) — Not in Arc's surface area
- Rules 27-29 (GDPR, backups, staging/prod separation) — Arc has git history as backup; staging isolation is worktree-based

---

## Summary

### What Changed From the Original Assessment (Task #1624)

Task #1624 rated this LOW without full article content (tweet truncation bug). With full content via the `article` field fix:

- Original: "general AI dev content, no Bitcoin/Stacks/x402/agent-economics overlap"
- Updated: **medium** — The article is still not Bitcoin/AIBTC/Stacks aligned, but 6 rules extract directly to Arc's security posture. The content-triage principle applies: relevance (not on core mission) vs. extractability (directly actionable for Arc ops).

### Actionable Signals

1. **Secret rotation** — No quarterly rotation cadence exists. Low-effort to add a scheduled task template.
2. **Code-level cost cap** — Daily budget enforced at dashboard only. Dual-layer protection would catch misconfigured dashboard scenarios.
3. **Audit log tagging** — Critical actions (cred updates, balance moves, merges) could be tagged separately in cycle_log for faster incident investigation.

### No New Tasks Warranted

These are operational hardening notes, not blocking gaps. Arc's security baseline (AgentShield A/90) already covers the major surface. Log to MEMORY for the next security review cycle.
