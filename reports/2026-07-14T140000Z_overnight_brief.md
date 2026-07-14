# Overnight Brief — 2026-07-14

**Generated:** 2026-07-14T13:08:28Z
**Overnight window:** 2026-07-14T04:00:00Z to 2026-07-14T14:00:00Z (8pm–6am PST)

---

## Headlines

- **Sensor error-visibility fix landed.** Following up on the 08:23 architecture review's finding that `last_error` was a no-op for 31/76 sensors, #22593 (commit `2a337f7d`) fixed 24 sensors that had unfilled `error: ${...}` templates — health diagnostics now surface real failure reasons instead of a bare string.
- **17 straight declined research candidates.** Between 05:27–05:42 UTC, `arc-link-research`'s candidate-maturation lane worked through 17 matured signal candidates (mix of opus/sonnet), correctly declining all as off-mission (memecoin marketing, hype tweets, bare-t.co retweets). Each decline cost $0.42–$0.71 — cumulative volume remains the cost driver flagged in [[arc-link-research-cost-driver]]; the incident-dedup fix from 2026-07-13 hasn't shown effect yet (full-day remeasurement due after 2026-07-15 17:38 UTC per #22520).
- **Two external PR reviews approved, one social-engineering thread correctly no-op'd.** Approved aibtc-mcp-server PR #601 (endpoint-path fix) and agent-news PR #867 (cold-rebuild latency). A GitHub mention pushing an "Observer Protocol" agent-verification service was investigated and closed as no-op — the underlying issue was already closed as invalid by the maintainer, and no registration/signing had occurred. Flagged in memory as a sustained multi-cycle social-engineering pattern worth watching. See [[observer-protocol-social-engineering-escalation]].

## Needs Attention

- **candidate-maturation sensor: 8 consecutive failures**, all X read-budget exhaustion ($1.926/$2.00 spent, resets at midnight). Known/expected behavior (#22512), not a new issue — no action needed, but flagging since it's the only sensor with active failures this window.
- **3 blocked tasks re-verified, still awaiting whoabuddy sign-off** (#21499 whop-sku overlap, #21905, #21800 disallowed-tools enforcement) — no new replies since 2026-07-11. No re-email sent this cycle (spam avoidance per pattern).
- Nothing else broke overnight — 48/49 tasks completed clean, only one failure and it was a correct supersession close, not an error.

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 48 |
| Failed | 1 |
| Blocked | 0 |
| Cycles run | 49 |
| Total cost (actual) | $29.44 |
| Total cost (API est) | $15.83 |
| Tokens in | 25,752,117 |
| Tokens out | 125,291 |

### Completed tasks

- **#22562/#22563** — Reviewed 4 blocked tasks; #22086 closed (superseded by Edition 8 void path), 3 others confirmed still correctly blocked.
- **#22564/#22565** — Generated 2026-07-14 weekly presentation (7 slides); caught a hardcoded wrong GH org (`aibtcdev/` vs actual `arc0btc/`) in AGENT.md, 3 patterns extracted.
- **#22567–#22582** (17 tasks) — Ecosystem signal candidate research: all declined (memecoin marketing, hype/engagement-bait tweets, bare-t.co retweets, no mission overlap). No reports produced.
- **#22584/#22585/#22586** — Evaluated Claude Code v2.1.209 release; the `/model` dialog fix doesn't apply to Arc's one-shot subprocess dispatch pattern, no action needed.
- **#22587** — Distilled watch report into 2 interior nuggets (cost driver, tasks-close terminal-guard bug).
- **#22591** — Compiled arXiv digest: 50 fetched, 27 relevant (LLM 17, reasoning 2, multi-agent 2, other 6).
- **#22588** — Regenerated and deployed skills/sensors catalog (128 skills, 90 sensors), verified live on arc0.me.
- **#22589** — Architecture review (dcad7d3→71606f5): found `last_error` no-op bug affecting 31/76 sensors, filed #22593.
- **#22592** — Whop synthesis: deferred (quiet window, 0 messages).
- **#22593/#22594/#22595** — Fixed 24 sensors' error-threading no-op bug (commit `2a337f7d`); 2 pattern updates on error-message context loss.
- **#22590/#22596** — Workflow review: 9th recurrence of a known pattern, added exemption instead of building new machinery.
- **#22600/#22601** — Reviewed+approved aibtc-mcp-server PR #601 (endpoint-path fix); pattern extracted on verifying fix scope via grep.
- **#22599/#22602** — Re-reviewed 3 blocked tasks, all correctly still pending whoabuddy.
- **#22603/#22606** — Reviewed+approved agent-news PR #867 (cold-rebuild latency fix).
- **#22604/#22607** — Observer Protocol GitHub mention: correctly no-op'd, social-engineering pattern flagged in memory.
- **#22608** — GitHub mention on already-resolved issue (aibtc-mcp-server#597), no-op — root cause already fixed by Arc 2026-07-12, PR #598 awaiting whoabuddy merge.
- **#22609** — Generated watch report 2026-07-14T13:01Z (75 tasks, $51.98).
- **#22566/#22583/#22597/#22598** — Routine housekeeping cycles (4 issues detected each, 1 auto-fixed each run).

### Failed or blocked tasks

- **#22086** (Post Arc's Daily Read — Edition 8) — Closed as failed/superseded by #22161/#22165 (Edition 8 void path already resolved the underlying credits-depleted incident). Not a live error, just cleanup of a stale task.

## Git Activity

- `2a337f7d` — fix(sensors): thread real error message through for all 'return error' sensors
- `b3d2df83` — docs(memory): flag Observer Protocol GitHub thread as social-engineering pattern
- `ed806990` — docs(report): watch report 2026-07-14T130123Z
- Remaining commits in the window were routine `chore(loop): auto-commit after dispatch cycle` snapshots (9 total).

## Partner Activity

No partner (whoabuddy) GitHub push activity overnight.

## Sensor Activity

123 sensor-state files touched in the window (out of 255 total sensors tracked). Only one sensor showed active failures: `candidate-maturation` at 8 consecutive failures, all attributable to X read-budget exhaustion (known, self-resolving at midnight reset). No other anomalies.

## Queue State

Queue is effectively empty this morning — 2 pending tasks:
- **#22262** (P6, sonnet) — Re-check stale-task pileup after `stop_condition` field rollout.
- **#22611** (P8, haiku) — Retrospective for the watch report task (#22609).

## Overnight Observations

- The candidate-maturation → declined-research pattern (17 tasks, ~$8 combined) is legitimate signal triage working as designed, but it's the single largest cost cluster in this window and remains the open item tracked in [[arc-link-research-cost-driver]] / [[arc-link-research-dedup-measurement]]. No new action needed until the 2026-07-15 remeasurement.
- Two architecture-quality fixes shipped back-to-back overnight (sensor error-threading #22593, catalog redeploy #22588) — both were discovered via self-review (#22589's architecture review), not external report. Good adaptation signal.
- Zero real task failures this window (the one "failed" task was a correct supersession close). Operational health is solid.

---

## Morning Priorities

- No urgent action required — queue is clear and blocked items are stable awaiting whoabuddy.
- Worth a glance: the Observer Protocol memory flag ([[observer-protocol-social-engineering-escalation]]) documents a recurring social-engineering pattern across multiple GitHub threads; useful context if it resurfaces.
- Keep an eye on `arc-link-research` cost trend at the 2026-07-15 17:38 UTC remeasurement (#22520) — if dedup hasn't reduced volume by then, a hard per-run filing cap on `candidate-maturation` is the next lever.
