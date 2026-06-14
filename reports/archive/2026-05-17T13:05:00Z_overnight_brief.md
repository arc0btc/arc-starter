# Overnight Brief — 2026-05-17

**Generated:** 2026-05-17T13:05:00Z  
**Overnight window:** 2026-05-17 03:00 UTC to 13:05 UTC (8pm–7am MDT)

---

## Headlines

- **Signal cooldown root cause fixed** — Task #16869 identified the bug: streak task subject "Maintain N-day streak on aibtc.news" didn't match BEAT_SUBJECT_PATTERNS, causing `isBeatOnCooldown` to return false for the target beat. Fix committed (d07db40a): streak tasks now use "File \<beat\> signal: maintain N-day streak". Validation utility added (9328f609) so sensors can assert at queue time. This is the recurring dispatch-time cooldown failure that cost cycles for the past 4 days.

- **3 signals filed, 3 beats active** — quantum (arXiv:2605.15090 energy efficiency), aibtc-network (Codex MCP installer), bitcoin-macro (CLARITY Act 15-9 vote + BTC 78K). Multi-beat day continues the signal quality recovery.

- **Quantum bounty claimed** — 1btc-news/news-client#33: IC Daily Beat Writer + Data Researcher roles. 250k sats on the table. First signal due within 24h of acknowledgment. Existing arXiv pipeline directly applicable.

- **Memory consolidated** — MEMORY.md trimmed from ~48t to ~32t (57b5ccac). 13 stale evaluations dropped, patterns reorganized. Context budget headroom recovered.

---

## Needs Attention

- **#16901 quantum signal pending (P4)** — arXiv:2605.06853 post-quantum Bitcoin tx size. Pre-composed and rescheduled; cooldown cleared, dispatch should pick it up next cycle. File this before the 1btc-news 24h window closes.
- **PR #525 aibtc-mcp-server at 3 review cycles** — BIP-137 signing blocker persists (secp256k1.recoverPublicKey not static, Signature object ≠ Uint8Array). Per policy: cycle 4 is a loop — wait for author to address before re-reviewing.
- **PRs #528/#529 aibtc-mcp-server** — requested changes filed: pipe injection in signature messages, deprecation completeness. Watch for author response.
- **PR #825 agent-news** — requested changes: envelope inconsistency and DOResult type mismatch. Blocking issues remain.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 40 |
| Failed | 1 |
| Blocked | 0 |
| Total cost (actual) | $12.89 |
| Avg cost/task | $0.322 |
| Tokens in | 18.1M |
| Tokens out | 186K |

### Completed tasks

| ID | Priority | Subject | Cost |
|----|----------|---------|------|
| #16859 | P5 | File quantum signal: arXiv:2605.15090 energy efficiency | $0.23 |
| #16862 | P5 | Review PR #527 aibtc-mcp-server: Codex installer | $0.28 |
| #16863 | P6 | Watch report — 2026-05-17T01:02Z | $0.46 |
| #16864 | P5 | Review PR #875 landing-page: Codex loop installer | $0.32 |
| #16866 | P5 | Self-review health check 2026-05-17 | $0.47 |
| #16867 | P5 | Review PR #528 aibtc-mcp-server: bounty tools | $0.29 |
| #16868 | P5 | Self-review triage: 1 issue found | $0.27 |
| #16869 | P4 | Signal cooldown: audit sensor paths without gate | $1.21 |
| #16870 | P8 | Retrospective: task #16869 cooldown learnings | $0.10 |
| #16871 | P5 | Auto-queue: 2 hungry domains need work | $0.25 |
| #16872 | P4 | Research bitcoin-macro signal: BTC/ETF update | $0.53 |
| #16873 | P4 | Research aibtc-network signal: MCP developments | $0.63 |
| #16874 | P4 | Research quantum signal: post-quantum Bitcoin threat | $0.56 |
| #16875 | P5 | Triage open issues/PRs across watched repos | $0.45 |
| #16876 | P5 | Review open PRs on aibtcdev/landing-page | $0.30 |
| #16877 | P5 | Review open PRs: aibtc-mcp-server + skills (9 PRs) | $0.71 |
| #16878 | P3 | File bitcoin-macro signal: CLARITY Act + BTC 78K | $0.23 |
| #16879 | P4 | CEO review — 2026-05-17T03:32 | $0.27 |
| #16880 | P4 | File aibtc-network signal: AIBTC MCP Codex installer | $0.18 |
| #16882 | P3 | Review PR #378 x402-sponsor-relay: PaymentRecord TTL fix | $0.20 |
| #16883 | P5 | Review PR #825 agent-news: company world model endpoints | $0.41 |
| #16884 | P4 | Email watch report to whoabuddy — 2026-05-17T03:32 | $0.19 |
| #16885 | P5 | Review PR #876 landing-page: live agents D1 mirror | $0.32 |
| #16886 | P6 | Generate blog post: "The Cost of Reading Everything" | $0.28 |
| #16887 | P6 | Publish blog post | $0.11 |
| #16888 | P6 | Publish blog post: The Cost of Reading Everything | $0.10 |
| #16889 | P5 | GitHub @mention: 1btc-news quantum bounty (250k sats) | $0.19 |
| #16890 | P5 | Review PR #529 aibtc-mcp-server: native bounty tools | $0.31 |
| #16891 | P7 | Welcome new AIBTC agent: Crimson Citadel | $0.00 |
| #16892 | P5 | Review PR #530 aibtc-mcp-server: bounty API redirect | $0.33 |
| #16893 | P5 | Review PR #877 landing-page: SWR 15-min cache DRY | $0.40 |
| #16894 | P7 | Architecture review — d07db40 changes | $0.59 |
| #16895 | P6 | fix(db): add BEAT_SUBJECT_PATTERNS validation utility | $0.29 |
| #16896 | P5 | Review PR #531 aibtc-mcp-server: replace dead bounty tools | $0.39 |
| #16897 | P7 | Regenerate and deploy skills/sensors catalog | $0.14 |
| #16898 | P7 | Deploy arc0me-site to Cloudflare (bf120fa2) | $0.00 |
| #16899 | P4 | Re-review PR #525 aibtc-mcp-server: bounty tools (cycle 2) | $0.60 |
| #16900 | P4 | Re-review PR #525 aibtc-mcp-server: bounty tools (cycle 3) | $0.42 |
| #16902 | P7 | Welcome new AIBTC agent: Ancient Pegasus | $0.00 |
| #16903 | P5 | (last cycle, 13:00Z) | $0.55 |

### Failed tasks

| ID | Subject | Root cause |
|----|---------|------------|
| #16881 | File quantum signal: arXiv:2605.06853 | Cooldown active at dispatch; rescheduled as #16901 |

One failure — cooldown timing. Pre-composed signal correctly queued as #16901. Recovery path working as designed.

---

## Git Activity

```
9328f609 fix(db): add validateSignalSubjectMatchesBeatPattern utility
9e13992c docs(architect): update state machine and audit log — streak beat encoding fix; BEAT_SUBJECT_PATTERNS ×10 follow-up; 119 skills / 73 sensors
56b33812 chore(memory): mark signal-cooldown-fix-incomplete RESOLVED — task #16869
d07db40a fix(aibtc-news-editorial): encode target beat in streak task subject
57b5ccac chore(memory): consolidate MEMORY.md — 5 days stale
```

5 commits: 2 fixes (cooldown root cause + validation utility), 1 docs update, 2 memory operations.

---

## New Agents

- **Crimson Citadel** — welcomed (STX tx e20af361)
- **Ancient Pegasus** — welcomed (STX tx 210a45e6)

---

## Sensor Activity

73 sensors, 119 skills. Signal sensors now gated on cooldown with matching subject patterns. Streak task root cause fix (d07db40a) closes the 4-day recurring failure class. Validation utility ensures future sensors can self-check at queue time.

---

## Queue State

1 pending task: **#16901** (P4) — quantum signal arXiv:2605.06853 post-quantum Bitcoin. Ready to file, cooldown cleared.

---

## Overnight Observations

- **Cooldown fix is the structural win**: d07db40a + 9328f609 close the recurring failure that caused 4+ dispatch wasted cycles over the past week. Root cause was subtle — `isBeatOnCooldown` only checked subject patterns, so a mis-encoded streak task subject bypassed the gate entirely.
- **Signal quality recovering**: 3 signals / 3 beats is the target multi-beat pattern. CLARITY Act + BTC 78K is high-relevance bitcoin-macro material; Codex installer is strong aibtc-network; quantum arXiv:2605.15090 validates the arXiv pipeline.
- **PR #525 review loop risk**: Cycle 3 of the same PR with the same blocking issue. Per policy, don't queue cycle 4 — wait for author action. BIP-137 signing is a real technical blocker, not cosmetic.
- **Quantum bounty is time-gated**: 1btc-news 24h window opens on committee acknowledgment. #16901 should file the next quantum signal to position for the bounty. Priority: file before arXiv competition does.
- **Cost efficiency holding**: $0.322/task vs $0.393 last night — token explosion fixes (from 2026-05-16) continuing to show savings.

---

## Morning Priorities

1. **File quantum signal #16901** — cooldown cleared, 1btc-news 24h window open. This is the highest-value action.
2. **Watch PR #525** — do not re-review until author addresses BIP-137 signing. Comment standing; wait.
3. **Monitor PRs #528/#529/#530 author response** — aibtc-mcp-server bounty tools family has pipe injection issues. Watch for fixes.
4. **PR #825 agent-news** — envelope inconsistency + DOResult type mismatch blocking. Wait for author.
