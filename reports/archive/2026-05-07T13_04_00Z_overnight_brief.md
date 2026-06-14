# Arc Overnight Brief — 2026-05-07

**Window:** 2026-05-07 03:00Z – 13:04Z (10h, morning session)
**Generated:** 2026-05-07T13:04Z

---

## Summary

Strong overnight. 78 tasks completed, 15 failed (84% success). $47.26 spent across 95 tasks. The dominant workload was whoabuddy's 26-link research batch — fully processed, synthesized, and emailed. Two significant infrastructure fixes shipped: arXiv sensor timeout/interval bug and self-healing beat detection. Five new agents welcomed.

---

## Task Stats

| Status | Count | Cost |
|--------|-------|------|
| Completed | 78 | $41.47 |
| Failed | 15 | $5.79 |
| Pending | 1 | — |
| **Total** | **95** | **$47.26** |

---

## Key Accomplishments

### 1. arXiv Sensor Fix (PR #25)
Two bugs fixed in `arxiv-research/sensor.ts`:
- `fetchArxivWithRetry` now catches `AbortError`/`TimeoutError` inside the retry loop (previously these escaped the loop entirely)
- `hookState` read *before* `claimSensorRun`; `last_ran` reset to epoch on all error paths so a timeout no longer locks out the sensor for 12h

PR reviewed by secret-mars, feedback addressed (commit `1c3ef3ed`), CI running. This was the #1 lever identified for restoring quantum signal flow.

### 2. Self-Healing Beat Detection
Replaced manual `ACTIVE_BEATS` constants in arxiv-research, bitcoin-macro, and aibtc-agent-trading sensors with live `/api/beats` API call via `fetchActiveBeatSlugs()`. Beat retirement is now automatic — no manual patching required on the next lifecycle event.

### 3. SIP-018 VRS Tolerance (PR #369)
Audited `x402-sponsor-relay` `verifySip018` — found RSV-only acceptance. PR adds VRS+raw+recovery-id 27/28 tolerance + dual mainnet/testnet address check, mirroring the `mailslot/sip018.ts` reference implementation. 8 new tests green.

### 4. arc memory recall CLI
`arc memory recall --query TEXT [--limit N]` implemented — SQLite LIKE search across `tasks.subject`, `result_summary`, `description`. Addresses the "recall tier" gap identified in Letta/MemGPT research.

### 5. arc-link-research Path Bug Fixed
Reports were writing to `./arc-link-research/` instead of `./research/`. Fixed `RESEARCH_DIR` and `CACHE_DIR`, moved 30 orphan stubs + 190 archive files + 453 cache entries to correct locations.

### 6. Research Batch: 2026-05-06 Links (26 items)
Processed all 26 links from whoabuddy's email:
- 21 individual link tasks + 2 META fanout tasks (awesome-harness-engineering, awesome-autoresearch)
- Key findings: OAP spec (Ed25519 policy gate, not secp256k1-native), Cloudflare sandbox/CodeMode, Azure SRE agent (5 tools beat 100+), Sakana Conductor architecture
- HTML synthesis emailed via in-reply-to (`id=c40c995e`)
- Top actionables: PIVOT/REFINE failure ladder, arc memory recall CLI, Mailslot RSV/VRS hardening, MEMORY.md token-cap precommit

### 7. Design Docs Produced
- `research/arc-action-gate-design.md` — two-stage pre-action classifier (TS fast + LLM CoT on flag), ~$0.05/day estimated cost
- `research/2026-05-07T06-08-30Z_arc-iterate-design.md` — arc-iterate skill spec (autoresearch loop primitives)
- `research/proposals/2026-05-07_memory-plans-cascade.md` — MISSION/quarterly/weekly planning cascade proposal

### 8. Agent Welcomes
5 new agents onboarded: Fierce Hawk, Vigilant Roc, Opal Bear, Lasting Hydra, Little Squid.

### 9. Architecture Catalog Updated
74 sensors, 115 skills documented. Beat hygiene pass: 4 sensor files patched to remove retired beat references.

---

## Failures

| Task | Subject | Root Cause |
|------|---------|------------|
| #15913 | Email watch report | Resend credentials missing (chronic) |
| #15920–#15931 (10 tasks) | Research: X posts | X API returned empty — tweets deleted/protected |
| #15946 | File infra signal | 4h cooldown after same-beat signal filed 13min earlier; **100 sats lost** |
| #15947 | Research: Beyond Permission Prompts | URL 404 — post may not exist |
| #15958, #15972 | File infra signal | Beat retired (`infrastructure`) — sensor was still targeting it; **fixed** |

**Chronic failures**: Resend (1). **External/transient**: 10 deleted tweets (whoabuddy batch contained many inaccessible links). **Now fixed**: stale beat references in aibtc-news-editorial sensor.

**100 sats lost** on task #15946 — cooldown logic should check per-beat cooldown before deducting payment. Follow-up opportunity.

---

## Signals Filed

| Beat | Count | Notes |
|------|-------|-------|
| aibtc-network | 1 | Cloudflare 13 MCP servers + x402 support (ID: `110d25c4`) |
| bitcoin-macro | 0 | No new signals this window |
| quantum | 0 | arXiv manual run found 0 quantum papers |

Retry for harness-engineering signal queued as task #15970 (pending, fires after 4h cooldown ~08:51Z).

---

## Commits (03:00Z–13:04Z)

```
a6e15387  chore(memory): consolidate patterns.md to 145 lines
85c58350  chore(loop): auto-commit after dispatch cycle
1c3ef3ed  fix(sensors): address secret-mars review feedback on PR #25
69441884  chore(loop): auto-commit after dispatch cycle
4b7c7cf9  fix(arxiv-research): retry on timeout + release interval on failure
036bc2ab  fix: stale beat references in aibtc-news-editorial sensor (inferred)
0d84bf9e  fix: arxiv-research auto-queue sensor listed wrong active beats
e87f6e83  chore(memory): auto-persist on Stop
```

---

## Open Items

| Item | Status | Next Action |
|------|--------|-------------|
| Resend credentials | Blocked (#14771) | Whoabuddy must complete signup |
| PR #25 (arXiv fix) | CI running | Merge when green |
| PR #369 (SIP-018 VRS) | Open | Review + merge |
| Task #15970 | Pending | Harness-engineering signal retry ~08:51Z |
| Quantum signal drought | Ongoing | arXiv fix first real test at 20:11Z (next sensor window) |
| Payout disputes (11) | Escalated | No response since 2026-04-26 |

---

## Cost Efficiency

$47.26 for 95 tasks = **$0.497/task** — elevated due to research batch (many $0.5–1.0 tasks). Excluding the 26-item batch, core dispatch is on track at ~$0.26/task.
