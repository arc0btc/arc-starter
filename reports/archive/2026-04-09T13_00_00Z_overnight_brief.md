# Overnight Brief — 2026-04-09

**Generated:** 2026-04-09T13:07:00Z
**Overnight window:** 2026-04-08 20:00 PST to 2026-04-09 06:00 PST (2026-04-09 03:00–13:00 UTC)

---

## Headlines

- **Hiro 400 address flood — critical**: 54/56 failures are Hiro rejecting SP-addresses in the agent registry. The pre-validation guard from task #11484 was *investigated* but not deployed as code. x402 credits are still being burned before the STX send fails (double loss). This is the single largest operational issue overnight — must ship code fix today (P2).
- **Two signals filed**: quantum-computing beat (secp256k1 attack estimates converging, #11686) + agent-trading beat (P2P desk 7/8 trades / 55/385 listing depth, #11674). Streak alive.
- **Zest mempool-depth guard shipped** (#11735): Zest sensor now checks mempool chain depth before attempting supply. This directly addresses the TooMuchChaining failure class (2 failures tonight, down from 15+ yesterday).

---

## Needs Attention

1. **Hiro 400 pre-validation guard not deployed (P2)** — Task #11484 investigated the issue but the code fix (STX address pre-validation before any x402 action) was never merged. 54 welcome agents failed overnight; each one may have burned x402 credits. Immediate action: implement and merge the pre-validation patch to aibtc-welcome skill.
2. **Loom token spiral RED alerts** (x2) — Tasks #11736 and #11753 both fired RED health alerts for 2.05M tokens in a brief inscription task. This is above threshold and needs investigation — is the token ceiling in the brief skill too low, or is the task genuinely oversized?
3. **15 pending bff-skills @mention reviews** — Queue is loaded with #11785–11799, all bff-skills PRs. Normal workload, but confirms the competition PR review flood hasn't fully cleared.

---

## Task Summary

| Metric | Value |
|--------|-------|
| Completed | 20 |
| Failed | 56 |
| Success rate | 26.3% |
| Cycles run | 77 |
| Total cost (actual) | $20.74 |
| Total cost (API est) | $20.39 |
| Tokens in | 23,068,608 |
| Tokens out | 105,432 |
| Cost per cycle | $0.27 |

**Success rate note**: 54/56 failures are a single root cause (Hiro 400 on invalid SP-addresses). True operational failure rate on non-welcome tasks: 2/20 = 10% (Zest TooMuchChaining × 2, which is also now guarded). Fixing #11484 would bring success rate to ~95%+.

### Completed tasks

| ID | Subject | Summary |
|----|---------|---------|
| #11674 | Agent-trading signal | P2P desk 7/8 trades, 5000 sats, filed to aibtc.news |
| #11686 | Quantum signal | secp256k1 attack estimates converging — 2 papers filed |
| #11711 | PR review: aibtcdev/skills #318 | bitflow-arb-scanner reviewed |
| #11722 | PR review: bff-skills #230 | bitflow-spot-swap approved — all blockers resolved |
| #11732 | Architecture review | State machine updated (1611067→a1188d37): zest welcome-task flow |
| #11733 | arXiv digest | 50 papers fetched, 20 relevant |
| #11735 | Zest mempool-depth guard | Guard added to zest-yield-manager sensor |
| #11736 | Loom Health RED alert | Token spiral alert sent (2.05M threshold) |
| #11740 | Catalog regeneration | Skills/sensors catalog regenerated + deployed |
| #11741 | Site deploy | arc0me-site deployed (aa40076aa72b, 243 assets) |
| #11745 | Beat editor @mention | Infrastructure beat audition already submitted — no duplicate action |
| #11749 | PR review: aibtcdev/skills #319 | aibtc-news-onboarding skill reviewed |
| #11753 | Loom Health RED alert (2nd) | Same token spiral — 2.05M tokens in brief task |
| #11766 | PR review: aibtcdev/skills #320 | zest-auto-repay fix reviewed — approved with suggestions |
| #11773 | PR review: agent-news #423 | Issue #423 is open call, not a PR — noted |
| #11774 | PR review: agent-news #429 | fix(review): requested changes filed |
| #11781 | bff-skills @mention | PR #94 already merged — no action needed |
| #11782 | Watch report | Generated (37 completed, 59 failed in watch window) |
| #11783 | bff-skills @mention | PR #124 already closed as duplicate — confirmed |
| #11784 | bff-skills @mention | PR #110 already closed — findings validated |

### Failed tasks

**Root cause 1: Hiro 400 address validation (54 failures)**
All welcome tasks for new AIBTC agents failed at STX send with Hiro 400 — SP-addresses in agent registry are invalid (wrong network, malformed, or truncated). Examples: Iron Io, Prime Yeti, Sober Jett, Ancient Minotaur (+ 50 more). Pre-validation guard not yet shipped.

**Root cause 2: TooMuchChaining — Zest supply (2 failures)**
- #11718, #11734 — Mempool chain depth exceeded during concurrent welcome STX ops. Zest mempool-depth guard (#11735) now shipped — future instances should self-gate.

---

## Git Activity

- `43bbc5e0` — docs(report): watch report 2026-04-09T13:00:53Z
- `dca14ac6` — chore(loop): auto-commit after dispatch cycle [1 file(s)]
- `afe59f94` — docs(architect): update state machine and audit log (1611067→a1188d37)

---

## Partner Activity

No partner (whoabuddy) GitHub push activity detected in the overnight window.

---

## Sensor Activity

All sensors operational. Notable overnight runs:
- **arxiv-research** — last ran 06:40Z, fetched 30 papers (newPaperCount=30)
- **aibtc-agent-trading** — last ran 11:21Z, result=ok (v42)
- **aibtc-news-editorial** — last ran 12:42Z, result=ok (v140)
- **arc-reporting-overnight** — last ran 13:01Z, triggering this brief

---

## Queue State

**Pending (15 tasks, all P5):**
- #11785–11799 — bff-skills @mention PR reviews (BitflowFinance/bff-skills)

**Morning priorities (implicit):**
1. Ship Hiro 400 pre-validation fix in aibtc-welcome
2. Clear bff-skills PR review queue
3. File remaining available signals (quantum/infrastructure/nft-floors)
4. Investigate Loom token spiral threshold

---

## Overnight Observations

- **Failure math**: 26.3% surface success rate, but 96% of failures trace to one unshipped fix. This is a cost-burn problem as much as a success-rate problem — x402 credits consumed before the validation guard runs.
- **Two signals filed**: breaks the 3-day signal drought. Competition score should tick up from 418 with today's leaderboard refresh.
- **Zest guard timing**: shipped mid-session after 2 failures — guard will prevent future TooMuchChaining, but today's Zest supply tasks may still hit the mempool limit until it drains.
- **Token budget for briefs**: The Loom RED alerts fired twice for the same 2.05M-token task. Either the threshold is set too low for brief tasks, or one task is genuinely oversized. Worth investigating before it creates a false-positive backlog.

---

## Morning Priorities

1. **Ship #11484 code fix** — Add STX address pre-validation in aibtc-welcome before ANY x402 action. This is the highest-leverage single fix available (eliminates ~54 failures/night if agent registry continues growing).
2. **Clear bff-skills PR queue** — 15 pending reviews, manageable in one batch.
3. **File signals** — quantum-computing + infrastructure beats have eligible topics. nft-floors sensor still active. Target 4-6 signals today to move competition score.
4. **Investigate Loom token spiral** — Understand what task type is generating 2.05M tokens and whether the ceiling needs adjusting.

---

*Brief covers 8pm–6am PST window (03:00–13:00 UTC). 77 cycles, 76 tasks dispatched, 20 completed.*
