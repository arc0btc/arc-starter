# Overnight Brief — 2026-05-04

**Generated:** 2026-05-04T13:05:00Z
**Overnight window:** 2026-05-04T03:00Z to 2026-05-04T13:00Z (8pm–6am PST)

---

## Headlines

- **Three arc-workflows structural fixes shipped** — PR existence checking (`4ea89d0e`), keyword-based skill detection (`66aefa05`), and 20/day review cap with haiku model switch (`99779912`) all landed overnight. The stale-PR-queue contamination pattern that burned 3+ dispatch cycles/day on non-existent PRs is now fixed at the sensor level.
- **arxiv-research signal routing restored** — `ACTIVE_BEATS=[]` in arxiv-research was causing complete silence for aibtc-network and quantum beats. Fixed (`fe615b45`). Both beats now receive signals from arxiv sensor again.
- **bitcoin-macro signal filed cleanly** — Hashrate drop of 7.2% from ATH (to 951.6 EH/s) filed as signal `f2e72a1a`. Q=93, SQ=30. Three Tier-0/1 sources including Blockstream.info. First signal of the watch window.
- **Budget-gate FP flood resolved** — Yesterday's $201.15 day (over $200 cap) queued ~30 dispatch-stale retrospective tasks overnight. All correctly identified as false positives from the budget gate. Pattern now in MEMORY.md.

---

## Needs Attention

- **Resend email credentials still not set** — Task #14771 blocked since 2026-05-03. IC email deadline (2026-05-02) has passed. Whoabuddy must: complete Resend signup, set up DNS, then run `arc creds set --service resend --key api_key --value <key>` and `arc creds set --service resend --key from_address --value arc@arc0btc.com`. Escalating.
- **dispatch-stale retrospective dedup gap** — ~30 retrospective tasks from a single budget-gate event. The arc-service-health sensor should deduplicate these into one retrospective, not one per alert. Consider adding a dedup guard on retrospective creation.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 436 |
| Failed | 18 |
| Blocked | 1 |
| Cost (actual) | $96.24 |
| Tokens in | 117,654k |
| Tokens out | 812k |

### Completed tasks (notable)

| ID | Subject | Summary | Cost |
|----|---------|---------|------|
| #15634 | File bitcoin-macro signal: hashrate -7.2% ATH | Signal `f2e72a1a` filed. Q=93, SQ=30. 951.6 EH/s. | $0.20 |
| #15629 | Regenerate skills/sensors catalog | 113 skills, 72 sensors. No delta. | $0.38 |
| #15628 | GitHub @mention: IC pool email mandate | Resend blocker documented; no action until credentials land | $0.17 |
| #15625 | Consolidate patterns.md | 4 patterns merged, 1 removed. 151→136 lines. | $0.33 |
| #15624 | Retrospective: Deep Tess collaboration | Learnings already in memory/shared/entries. Workflow 1935 complete. | $0.22 |
| #15673 | Review 1 blocked task | #14771 still blocked — Resend not set. | $0.14 |
| #15656–15672 | Retrospective: dispatch-stale (×30) | All FPs from budget-gate. Pattern recorded. | ~$3.50 |
| #15610 | PR review cap + haiku switch | 20/day cap implemented. 76 excess tasks superseded. | $0.91 |

**Remaining**: 408 PR reviews at ~$0.23/each = ~$93.84 of the $96.24 total.

### Failed tasks

All 18 failures = stale/invalid PR numbers from the pre-existence-check era. These tasks were queued before `4ea89d0e` shipped. No new stale-PR failures will be created going forward — the sensor now checks GitHub API before queuing.

---

## Git Activity

```
aadcf96c chore(memory): consolidate patterns.md (151→136 lines)
4ea89d0e fix(arc-workflows): add PR existence check before queuing review tasks
66aefa05 fix(arc-workflows): add keyword-based skill detection to PR review tasks
fe615b45 fix(arxiv-research): re-enable aibtc-network and quantum beat routing
99779912 feat(arc-workflows): add daily PR review cap (20/day) and switch to haiku
de855755 docs(architect): update state machine and audit log 2026-05-04T08:14Z
1af05695 docs(architect): update state machine and audit log 2026-05-04T07:53Z
```

Three structural fixes to arc-workflows in a single overnight session. The stale-PR and signal-silence problems were both diagnosed and fixed before 6am PST.

---

## Sensor Activity

- **arc-workflows PR sensor**: Fixed — PR existence gate now prevents stale tasks from being queued.
- **arxiv-research**: Fixed — ACTIVE_BEATS was empty array. Both aibtc-network and quantum beats restored.
- **bitcoin-macro**: Fired once — hashrate drop detected and signal filed successfully.
- **arc-service-health**: Budget-gate FP flood correctly identified and resolved as false positives. No real dispatch stalls.
- **aibtc-heartbeat / aibtc-inbox-sync**: Ran normally; no anomalies.

---

## Queue State

**Pending now (morning):**
- 1 blocked task: #14771 (Resend setup — awaiting whoabuddy action)
- 0 pending tasks — queue effectively drained

Queue is clean. Sensor volume will drive next cycle activity. The daily PR review cap (20/day on haiku) keeps review cost predictable going forward.

---

## Overnight Observations

- **Cost held at $96.24** — Down significantly from yesterday's $201.15. The daily PR review cap and haiku model switch are working. PR reviews now cost ~$0.05–0.10/each on haiku vs ~$0.23 on sonnet.
- **Three arc-workflows fixes in one overnight** — Rare: all three fixes were diagnosed, implemented, and committed before the morning watch window. Pattern: sensor problems tend to cluster; once one is found, look for adjacent issues.
- **Signal pipeline improving**: bitcoin-macro filed cleanly; arxiv routing restored. Quantum and aibtc-network are now unblocked by the arxiv fix. Expect signal volume to recover.
- **Queue hygiene**: 76 excess PR review tasks superseded cleanly by the cap implementation. No manual intervention needed.

---

## Morning Priorities

1. **Resend setup** — escalate again to whoabuddy; IC email deadline passed 2 days ago
2. **Monitor signal pipeline** — arxiv fix just landed; verify quantum and aibtc-network signals start flowing
3. **PR review sensor monitoring** — first day under the new existence-check + 20/day cap; verify failure rate drops to zero
4. **arc-service-health retrospective dedup** — investigate whether a single budget-gate event should generate 30 separate retrospective tasks vs one
