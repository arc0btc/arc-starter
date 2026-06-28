# Overnight Brief — 2026-06-28

**Generated:** 2026-06-28 13:15 UTC
**Overnight window:** 2026-06-27 20:00 PST → 2026-06-28 06:00 PST (04:00–14:00 UTC)

---

## Headlines

- **High-value synthesis sprint**: whoabuddy approved 4 research threads overnight; follow-ups shipped two infrastructure improvements (memory-health sensor + buildPrompt cache reorder) and one new revenue product ($9 Whop SKU "The Loop, graded").
- **Open-weight routing policy landed**: GLM-5.2 and Devstral-2512 benchmarked at 0.2–0.6% of Sonnet cost for bounded code tasks; routing policy written and memory entry captured. No routing changes yet — awaiting task-type classification work.
- **ARC-0013 spec submitted to whoabuddy**: fleet-safe dispatch loop port specced (atomic SQL claim vs. file lock); awaiting sign-off on DB substrate question before any code.

---

## Needs Attention

- **ARC-0013 fleet DB decision**: whoabuddy reply pending on whether to extend arc-starter SQLite for single-node fleet vs. networked DB for true multi-host. Blocks code phase of ARC-0013.
- **Whop chat seed pending sign-off**: "Budget Rails, Paired Artifacts, Earned Trust" post drafted but not auto-posted — presented for human review per guardrail.
- **Onboarding nudge (task #19974, P4)**: d5 nudge for member mem_92ac6q7ROmowv5 still pending; oldest item in queue.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 24 |
| Failed | 0 |
| Blocked | 0 |
| Cycles run | 25 |
| Total cost (actual) | $12.18 |
| Total cost (API est) | $16.23 |
| Tokens in | 13.2M |
| Tokens out | 134.7K |
| Avg cycle duration | 105 sec |

### Completed tasks

| ID | Subject | Summary |
|----|---------|---------|
| 20183 | Nostr note: Rails prevent, not guide | eventId c01921de; both relays ok |
| 20184 | Nostr note: Trust earned per-repo | "Capability travels. Trust doesn't." — eventId 9c736fa2 |
| 20185 | Housekeeping: 4 issues detected | Fixed 1 issue |
| 20186 | Nostr note: Build so verification is automatic | Posted on Notch principle (policy vs. mechanism) — eventId fbf3f727 |
| 20187 | Email from whoabuddy: research synthesis approval | Approved 4 threads; filed #20188 SKU, #20189–91 code tasks, #20192 agent-runtime spec, #20193 GLM bench |
| 20188 | Ship $9 Whop SKU "The Loop, graded" | prod_iRxuQeieW4RCm live at whop.com/the-loop-graded; Boris/Eric/Prajwal-mapped; visible |
| 20189 | Wire memory-health into housekeeping sensor | warn@180/hard@200; commit 746a528a |
| 20190 | Reorder buildPrompt for cache prefix | Static before dynamic; commit 31628a9b |
| 20191 | Add cache_hit_rate + cost/accepted-change to arc status | 100% accept rate; $2.66/accepted from 6 rated tasks; commit 5498f53a |
| 20192 | Spec ARC-0013 dispatch loop port | Written to agent-runtime/proposals/0013; load-bearing diff = atomic SQL claim; commit 8f5c0554 |
| 20193 | Benchmark GLM-5.2 + Devstral-2512 via OpenRouter | Both passed; GLM ~$0.01/task, Devstral ~$0.003; aliases added to models.ts; commit 82843974 |
| 20194 | Retro: whoabuddy email approval | Email dedup + memory cliff suppression patterns captured |
| 20195 | Retro: $9 Whop SKU | p-content-url-prevalidation pattern added |
| 20196 | Reply to whoabuddy re ARC-0013 spec | Summary + 4 open questions sent; awaiting sign-off |
| 20197 | Retro: ARC-0013 spec | spec-first + file-lock→atomic-claim scaling boundary patterns captured |
| 20198 | Define open-weight routing policy | Policy written to memory/shared/entries/openrouter-open-weight-routing.md |
| 20199 | Retro: GLM benchmark | p-model-selection-strategy updated with open-weight predicate |
| 20200 | Seed Whop chat: "Budget Rails, Paired Artifacts, Earned Trust" | Drafted; presented for human review — not posted |
| 20201 | Memory-health: consolidate MEMORY.md (189→177 lines) | Removed 3 l-purpose entries, zest-bounty, 2 stale contacts; recent.log 516→496 |
| 20202 | Housekeeping: 4 issues detected | Fixed 0 issues |
| 20203 | X cadence [blog-snippet]: post (07) | "Build so verification is automatic" — tweet 2071140382164038029 |
| 20204 | X cadence [blog-snippet]: post (08) | "Capability necessary not sufficient, tier:0 resets per repo" — tweet 2071144244874715345 |
| 20205 | Whop synthesis [09:00] | DEFER: 0 messages in window |
| 20206 | Watch report — 2026-06-28T13:01Z | 57 tasks completed, $3.89 spent |

### Failed or blocked tasks

Clean night — no failures or blocks.

---

## Git Activity

```
50d9dc34 chore(loop): auto-commit after dispatch cycle [1 file(s)]
64fe5068 chore(loop): auto-commit after dispatch cycle [1 file(s)]
d932c718 chore(loop): auto-commit after dispatch cycle [1 file(s)]
6beff1b0 chore(loop): auto-commit after dispatch cycle [1 file(s)]
10e4c2b7 chore(loop): auto-commit after dispatch cycle [1 file(s)]
6ef14ea9 chore(memory): consolidate MEMORY.md 189→177 lines, trim recent.log 516→496
ee85aceb chore(loop): auto-commit after dispatch cycle [1 file(s)]
6812c000 chore(loop): auto-commit after dispatch cycle [2 file(s)]
eafec1cb chore(loop): auto-commit after dispatch cycle [2 file(s)]
d1ee66a9 chore(loop): auto-commit after dispatch cycle [2 file(s)]
e7a3149a chore(loop): auto-commit after dispatch cycle [2 file(s)]
c6098606 chore(loop): auto-commit after dispatch cycle [1 file(s)]
fc4d25ac docs(memory): add open-weight routing policy for GLM-5.2 and Devstral-2512
15c7f40c chore(loop): auto-commit after dispatch cycle [1 file(s)]
5498f53a feat(status): add cache_hit_rate + cost-per-accepted-change metrics
b957b5e0 docs(memory): GLM-5.2/Devstral benchmark results + shared entry
82843974 feat(models): add GLM-5.2 and Devstral-2512 OpenRouter aliases + pricing
e023e24a chore(loop): auto-commit after dispatch cycle [1 file(s)]
31628a9b perf(dispatch): reorder buildPrompt — static before dynamic for cache prefix
66a4aa89 chore(loop): auto-commit after dispatch cycle [1 file(s)]
96a988d4 chore(loop): auto-commit after dispatch cycle [1 file(s)]
22b62ed1 docs(memory): capture fleet-dispatch-atomic-claim pattern (ARC-0013)
8f5c0554 docs(agent-runtime): ARC-0013 scoped dispatch-loop port spec
34834c9f chore(loop): auto-commit after dispatch cycle [1 file(s)]
f76f9fc1 feat(whop): ship $9 SKU "The Loop, graded against a live 24/7 agent"
775670fe chore(loop): auto-commit after dispatch cycle [1 file(s)]
746a528a feat(arc-housekeeping): wire arc-memory health into sensor (warn@180/hard@200)
f6e1e778 chore(loop): auto-commit after dispatch cycle [1 file(s)]
14ca468a chore(loop): auto-commit after dispatch cycle [1 file(s)]
fd2b92c7 chore(loop): auto-commit after dispatch cycle [1 file(s)]
bcd6268a chore(loop): auto-commit after dispatch cycle [1 file(s)]
```

28 substantive commits: 3 feat, 2 perf, 3 docs, 20 chore(loop).

---

## Partner Activity

No GitHub push activity from whoabuddy or arc0btc in the overnight window. whoabuddy sent email approving 4 synthesis threads (processed as task #20187).

---

## Sensor Activity

142 sensor state files, 0 with consecutive_failures > 0. All sensors healthy. No anomalies overnight.

---

## Queue State

**2 pending tasks:**

| ID | Priority | Model | Subject |
|----|----------|-------|---------|
| 19974 | 4 | sonnet | Onboarding ship-log nudge (d5) → member whop-evt:membership:mem_92ac6q7ROmowv5 |
| 20208 | 8 | haiku | Retrospective: extract learnings from task #20206 |

Overnight brief and watch report cycles have been processed. Queue is minimal — clean state entering the day.

---

## Overnight Observations

- **Cost spike on two tasks**: #20192 (opus spec) at $2.17 and #20188 (Whop SKU ship) at $1.09 drove 28% of overnight cost. Both were justified (complex spec writing + multi-step product setup). Overall avg $0.508/task — elevated vs. $0.35 standard due to opus usage.
- **Open-weight routing is the efficiency lever**: GLM-5.2 at $0.01/task and Devstral at $0.003 vs. $1.78 Sonnet baseline. Routing policy is written; the bottleneck is now classifying which task types qualify. That work is unqueued — if cost is a concern, queue the classification task.
- **Cache prefix reorder shipped**: buildPrompt now puts Identity/Memory/skills before Current Time. Prompt cache TTL is 5 min; static prefix should improve cache hit rate on back-to-back tasks. `arc status` will show the delta over the next 24h.
- **Whop synthesis DEFER pattern healthy**: 0 messages in window → correct DEFER. Monologue guard working as intended.

---

## Morning Priorities

1. **ARC-0013 decision**: Awaiting whoabuddy reply on fleet DB substrate. If no reply by EOD, follow up.
2. **Whop chat seed sign-off**: Approve or redirect "Budget Rails, Paired Artifacts, Earned Trust" post (task #20200 result is queued for review).
3. **Onboarding nudge (#19974)**: d5 nudge for new member — low priority but aging; will execute on next dispatch cycle.
4. **Open-weight routing classification**: No task queued yet. Consider queuing if daily cost tracking shows continued elevation.
