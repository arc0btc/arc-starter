# Overnight Brief — 2026-05-21

**Generated:** 2026-05-21T13:08 UTC  
**Overnight window:** 2026-05-20 8pm PST → 2026-05-21 6am PST (04:00–14:00 UTC)

---

## Headlines

- **Second gregoryford963-sys attack blocked.** PR #391 on aibtcdev/skills posted another batch of amber-otter credential exposure. Arc posted CHANGES_REQUESTED blocking review — 7 files, same attack vector as PR #389. amber-otter creds are still live and compromised; whoabuddy must act.
- **Blog post published: "Ground Truth at Queue Time."** Documents the sensor preflight gating pattern — the operational lesson from the STX balance and X API pre-screen fixes. Shipped to arc0.me.
- **arXiv digest compiled.** 28 papers ingested from 50 fetched. Digest written; no quantum signals filed (policy pause still active).

## Needs Attention

1. **STX wallet — refill required.** Balance remains ~89k microSTX, below the 100k send threshold. New sensor gate prevents 6+ wasted dispatch cycles, but welcome-agent is effectively paused until refilled. Recommend ~500k microSTX top-up. _Human action needed._
2. **amber-otter credentials — rotation overdue.** Private key and mnemonic are public via GitHub PR diffs (#389, #391). A second attacker PR confirms active exploitation. amber-otter must rotate before any further interaction. _Human escalation needed._
3. **Payout disputes — 21+ days stale.** 11 disputes, no platform response since 2026-04-26. Editor payout funded; correspondent distribution blocked. _Human escalation needed._

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 11 |
| Failed | 0 |
| Blocked | 0 |
| Cycles run | 11 (+ 1 this brief) |
| Total cost (actual) | $3.56 |
| Tokens in | 5,083,845 |
| Tokens out | 41,763 |

### Completed tasks

| ID | Subject | Summary |
|----|---------|---------|
| #17201 | GitHub @mention: landing-page PR #815 | Reviewed trading competition week-1 rules gap analysis; posted operational context |
| #17202 | Health alert: dispatch stale | FP — PID 1627800 alive; new dispatch-stale sensor fix working as expected |
| #17203 | Generate blog post | Draft: "ground-truth-at-queue-time" — sensor preflight gating pattern |
| #17204 | Publish blog post | Published to arc0.me (4,860 chars) |
| #17205 | GitHub @mention: aibtcdev/skills PR #391 | CHANGES_REQUESTED — 2nd gregoryford963-sys attack blocked, 7 files flagged |
| #17206 | Architecture review | State machine + audit log updated for STX preflight gate + PID-alive fix |
| #17207 | Regenerate catalog | 119 skills, 73 sensors documented and deployed |
| #17208 | Deploy arc0me-site | Cloudflare deploy for commit 0d1945f3b60f |
| #17209 | Fetch arXiv digest | 28 papers compiled from 50 fetched, written to research/arxiv/ |
| #17210 | GitHub @mention: arc-starter issue | Stale classifieds issue closed; Secret Mars partnership context noted |
| #17211 | Watch report 13:01 UTC | 17 tasks, $4.54 spent, report at reports/2026-05-21T13_01_02Z_watch_report.html |

### Failed or blocked tasks

Clean night — no failures.

## Git Activity

```
7673114b docs(report): watch report 2026-05-21T13_01_02Z
849aeedd docs(architect): update state machine and audit log — STX preflight gate + dispatch-stale PID-alive fix
```

## Partner Activity

No whoabuddy or arc0btc GitHub push activity in the overnight window.

## Sensor Activity

Sensors ran on normal cadence overnight. The dispatch-stale sensor fired once (task #17202) and correctly self-cleared using the new PID-alive guard — first overnight test of the fix, passed. The welcome-agent sensor is effectively paused via the new STX balance preflight gate (no wasted cycles queued). arXiv sensor ran and compiled a 28-paper digest.

## Queue State

Queue was clear at brief generation time. No pending tasks. The overnight flow was efficient — 11 tasks, 0 failures, clean handoff.

## Overnight Observations

- The second gregoryford963-sys PR (#391) appearing overnight confirms the attack is ongoing. The pattern: submit new PR with different file names, same credential content. Arc's blocker review fires each time via the @mention sensor, but the root problem (amber-otter must rotate) remains unresolved.
- Architecture review cycle cost $0.89 — the most expensive task overnight. Token overhead from loading all skill diffs. Acceptable for a weekly review.
- Dispatch-stale false positive at 05:50 UTC was the only oddity. New PID-alive guard resolved it in 39 seconds. No queue impact.
- Signal filing remains paused. Research (arXiv digest, beat monitoring) continues; nothing queued for filing. No revenue from signals until policy resumes.

---

## Morning Priorities

1. **STX wallet refill** — welcome-agent fully blocked until resolved. ~500k microSTX needed.
2. **amber-otter credential escalation** — two PRs now. The longer this waits, the more the account is at risk.
3. **Payout dispute follow-up** — 21 days is long enough to escalate to a second contact.
4. Signal filing re-enable decision — once EIC situation is clarified, this is a quick grep-and-flip.
