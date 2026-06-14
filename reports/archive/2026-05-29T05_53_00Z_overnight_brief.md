# Overnight Brief — 2026-05-28

**Generated:** 2026-05-29 05:53 UTC
**Overnight window:** 2026-05-28 20:00 MDT → 2026-05-29 06:00 MDT (2026-05-29 02:00–12:00 UTC)
*Note: Generated at 05:53 UTC — 4 hours into the overnight window.*

---

## Headlines

- **Dispatch resurrection bug fully patched** — Three re-dispatch incidents on task #17797 (5 total cycles, 2 days) traced to two independent bugs. Both fixed: catch-block guard (af5c6ac2) prevents LLM-closed tasks from re-entering pending; DB-layer guard in `requeueTask` (78408d07) adds `WHERE status != 'completed'` so no caller can ever resurrect a terminal task. Race-safe. Also fixed: rate_limit_event parser was discarding informational events (status='allowed') as denials, aborting valid cycles — now short-circuits correctly (510b9e67 + 1d0395c0).
- **Email dedup guard shipped** — `arc-email-sync` now checks sent folder (last 60 min, same to+subject) before any send. Directly closes the bug that caused whoabuddy to receive 3 identical research reports on May 28. Defense-in-depth for all future email tasks.
- **whoabuddy noted dispatch outage** — Emailed about "dispatch stopped." Arc self-recovered; task #17844 confirmed no action needed and replied accordingly.

---

## Needs Attention

- **4 pending dispatch-stale FP tasks** (#17847, #17855, #17876, #17883) — Accumulated during the rate-limit outage window. All are false positives (dispatch was running). Recommend closing as completed or letting them drain through the queue; they don't represent real incidents.
- **#17870: Fix dispatch-gate default** (P3, human-queued) — Rate-limit outage caused gate confusion. Queued for follow-up.
- **#17872: arc0btc.com health issues** (P3, workflow) — Health check flagged issues overnight. Needs investigation.
- **RFC 0007–0010 implementation** (P3-P4, #17857–17860) — 4 tasks queued by whoabuddy last evening. Significant work: Verification Layer, reference skills, Lessons Layer. Not yet started.
- **X API credits still depleted** — #17796 parked at P9. No recovery until whoabuddy tops up.
- **amber-otter credential exposure** (11 days stale) — No autonomous path. Awaiting whoabuddy direct outreach.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed today | 6 |
| Failed today | 1 (task left active from crash recovery) |
| Cycles run today | 8 |
| Total cost today (actual) | $1.41 |
| Tokens today | 1.4M in / 9.6K out |
| Pending queue | 70 tasks |

### Completed overnight tasks

| ID | Subject | Summary |
|----|---------|---------|
| #17797 | Aggregate research batch 2026-05-27 | Final close — idempotent NO-OP. Report already sent 3× earlier. Resurrection loop ended. |
| #17845 | Root-cause: dispatch re-selects completed tasks | Root-caused + fixed. Two commits shipped. |
| #17844 | Email from whoabuddy: dispatch stopped | Dispatch self-recovered; confirmed no restart needed. |
| #17836 | Add sent-folder dedup guard to arc-email-sync | Shipped — checks 60-min sent window before sending. |
| #17820 | health alert: dispatch stale | FP — dispatch running normally at check time. |
| #17830 | health alert: dispatch stale | FP — lock PID live, last cycle current. |
| #17837 | health alert: dispatch stale | FP — lock file belongs to current cycle. |
| #17841 | health alert: dispatch stale | FP — dispatch running at check time, 71 pending. |

### Failed or blocked tasks

- **#17797** (5:46 UTC): Failed with "task was left active from previous cycle (crash recovery)" — expected after the resurrection loop. Already had completed status from prior run; this cycle cleared the active state.

---

## Git Activity

```
651120e6  feat(arc-email-sync): add sent-folder dedup guard to send path
510b9e67  fix(dispatch): don't classify informational rate_limit_event as failure
1d0395c0  fix(dispatch): log full rate_limit_event payload before extracting reset
3d886088  chore(loop): auto-commit after dispatch cycle [1 file(s)]
e098e7cf  chore(loop): auto-commit after dispatch cycle [1 file(s)]
dcceb73f  chore(loop): auto-commit after dispatch cycle [1 file(s)]
410b8cd0  chore(loop): auto-commit after dispatch cycle [1 file(s)]
58051735  chore(loop): auto-commit after dispatch cycle [1 file(s)]
0880da05  chore(loop): auto-commit after dispatch cycle [1 file(s)]
```

Earlier today (pre-overnight, same May 28 session):
```
af5c6ac2  fix(dispatch): don't requeue tasks the LLM already self-closed
78408d07  fix(db): requeueTask must never resurrect a completed task
```

---

## Partner Activity

- **whoabuddy** emailed about "dispatch stopped" — resolved, no action needed.
- whoabuddy queued RFC 0007–0010 implementation tasks (#17857–17860, #17866–17869) — 8 tasks in total. Significant scope: verification layer, reference skills, Lessons Layer, SkillOpt survey, skills linting, RFC 0011 sketch. These are human-initiated and not yet started.

---

## Sensor Activity

- **Dispatch-stale sensor** fired 4× overnight with FPs — accumulated during rate-limit outage window. Dispatch was running in all cases. This is the "dispatch-stale alerts: always FP" pattern confirmed again.
- **New AIBTC agents**: 3 welcome tasks queued overnight (#17854 Little-Marten, #17871 Huge-Kappa, #17880 Fair-Otter).
- **Blog draft**: `arc0.me` freshness sensor queued #17877/#17878 (generate + publish blog post).
- **arXiv digest** still pending (#17840) from yesterday.
- **New Claude Code release** detected (#17879, anthropics/claude-code).

---

## Queue State

**70 pending tasks.** Top priorities:

| Pri | Count | Subject |
|-----|-------|---------|
| P2 | 4 | Dispatch stale FPs (clear these) |
| P3 | 3 | RFC review/publish, dispatch-gate fix, arc0btc.com health |
| P4 | 5 | RFC impl, security vulns in aibtcde repos |
| P5 | 8 | PR reviews, self-review, arXiv digest, PR assessments |
| P7+ | 50 | Retrospectives, welcomes, housekeeping, introspection |

---

## Overnight Observations

- **The resurrection loop is over.** Three days and 5+ dispatch cycles were consumed by a single completed task (#17797) that kept being resurrected. Both root causes are now patched at appropriate layers (catch block + DB invariant). Total corrective cost: minimal — the fixes themselves were quick. The lesson (already in memory) is that after shipping a resurrection-guard, sweep for tasks already stuck in the bad state.
- **FP health alert accumulation** is a recurring dispatch-stale pattern. During the ~9h rate-limit outage, sensors queued 4 stale-alerts that are now clogging P2. Consider a smarter dedup in the stale-alert sensor or a bulk-close CLI.
- **rate_limit_event parser bug** had been silently dropping diagnostic information. The fact that "resets unknown" appeared in logs but no payload was logged meant incidents were flying blind. Now fixed — future rate-limit events will log the full payload and route informational events correctly.
- **Email dedup guard** took one incident to ship. The sent-folder check is a clean, low-overhead safeguard. Any new side-effecting task type (STX sends, x402 payments) should get equivalent idempotency guards.

---

## Morning Priorities

1. **Clear the 4 dispatch-stale FP tasks** (P2) — they're false positives from the rate-limit outage. Quick closes.
2. **#17872 — arc0btc.com health issues** (P3) — investigate what the health check flagged.
3. **#17870 — Fix dispatch-gate default** (P3) — follow through on the rate-limit gate improvement.
4. **RFC 0007–0010 work** (P3-P4) — whoabuddy queued these last night; #17857 (review + publish) is the entry point.
5. **PR reviews** (#17835, #17839) — aging, should not slip another day.
6. **Blog post** (#17877/#17878) — arc0.me freshness monitor has been firing; a post clears it.
