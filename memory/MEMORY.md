# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-12T03:27:00Z*
*Token estimate: ~48t*

---

## [A] Active Items

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**payout-disputes** [ESCALATING, 16+ days stale] 11 disputes; no response since 2026-04-26. Editor payout funded; correspondent distribution blocked platform-side. Human escalation required.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

**zest-borrow-broken** [PRODUCTION] PRs #512 (Pyth VAA fix) + #513 (vaaInFlight coalescing + 8 unit tests) approved, CI green. Awaiting whoabuddy merge.

**pr-511-open-source-concern** [FLAGGED 2026-05-11] aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. 3 blocking issues flagged. Awaiting author response.

---

## [S] Signal Filing Rules

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Check cooldown BEFORE payment deduction. Use `tasks update --status blocked`, NOT close. `file-signal` requires `--tags` or 400 error.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.

---

## [P] Critical Patterns
→ See `memory/patterns.md` (27 validated patterns). **Key operational rules**:
- **Dispatch-stale alerts**: always FP — verify PID + recent cycle_log timestamps.
- **Signal-filing tasks must be sonnet**: haiku times out. Cooldown → `tasks update --status blocked`, NOT close.
- **Timeout cluster = task decomposition signal**: 3+ timeouts same window = shared structure hitting 15min limit. Split or script dispatch.
- **Budget-gate false positives**: $200 ceiling gaps ≠ stale dispatch. Verify cycle_log timestamps.
- **x402 welcome "Cannot find module"**: missing `bun install` in `github/aibtcdev/skills/`. Not wallet/nonce.
- **PR reviews must be sonnet, no daily cap**: `api_cost_usd` is phantom — billing is Claude Code subscription.
- **Workflow-dedup**: arc-workflows uses `pendingTaskExistsForSource`, not all statuses.
- **Content/research tasks timeout**: decompose draft vs publish. Signal research = per-beat tasks, not omnibus.
- **arXiv/quantum pipeline**: OPERATIONAL (PR #25, 2026-05-08). First signal 2026-05-09 (BTQ arXiv:2603.25519v2, signal 9a477540).
- **bitcoin-macro hashrate signal timeout** [RECURRING]: Decompose into (1) research+compose, (2) file. Never single dispatch.
- **patterns.md consolidation timeout** [RECURRING]: Split into two tasks at 150+ lines — (1) read+compress, (2) write+commit.
- **CF deploy failure as re-review multiplier**: Before re-queuing PR review with failing deploy, check if deploy is the bottleneck; surface to whoabuddy instead.
- **Skill name mapping**: "quantum" and "arc-signal-manager" are NOT valid. Use `arxiv-research` (quantum/bitcoin-dev) and `aibtc-news-editorial` (signal filing). Verify with `arc skills`.
- **PR re-review loop**: If blocking issues unchanged, comment and skip rather than re-review. Confirmed by PR #742 (4 loops, author closed).
- **email watch report routing** [RECURRING 2026-05-12]: Verify `arc creds get --service email --key report_recipient` before queuing. CF worker rejects unverified senders (jason@joinfreehold.com).
- **Verify creds before acting on memory**: Stale memory → expensive correction (task #16331, $2.05). Always verify external service config before use.
- **Policy-closure tasks**: Close with `status=completed` + "superseded by policy" to avoid polluting failure retrospectives.
- **sourceQuality re-file**: Re-filing a signal with better sourcing (10→30) is a valid quality lever.
- **Self-review triage pattern** [VALIDATED 2026-05-12]: Pre-dispatch triage tasks (3 overnight) resolve issues before they hit dispatch — 0 wasted cycles. Correlates directly with 100% success rate. Pattern is operational; don't skip or defer triage tasks.
- **Context-review SKILL_KEYWORD_MAP discipline**: When scaffolding a new skill domain, update the SKILL_KEYWORD_MAP in context-review at the same time. Gaps cause dispatch mismatches where tasks run without correct skill context (fixed in commit 11c64e3 for email-routing + scaffold). Rule: scaffold task → keyword map update in same PR.
- **arXiv 35+ relevant papers with no auto-signal**: When overnight arXiv digest returns ≥35 relevant papers but no quantum signal is auto-queued, create a manual follow-up task (`--skills arxiv-research`) after 2 sensor cycles if nothing surfaces. Strong digest ≠ automatic signal — 7-gate framework is the bottleneck.

---

## [E] Recent Evaluations

**Trend (2026-04-23 → 2026-05-12)**: PURPOSE 1.90–3.70. OH 87–100%. Quantum drought broken 2026-05-09. 5-signal/3-beat days confirm multi-beat capability. Cost $0.21–0.44/task. Hashrate signal + patterns.md consolidation = recurring decompose targets.

- **daily-eval-2026-05-12** [task #16414]: PURPOSE **3.00** (S:1 O:5 E:3 C:5 A:2 Co:1 Sec:3). 53 tasks today, $13.21 ($0.249/task — score 5). Signal Quality=1 (1 signal, single beat). Pending queue empty → no boosts possible; queued #16415 quantum manual triage (arXiv 35-relevant rule).
- **overnight-2026-05-12** [task #16405]: **100% success** (30/30, 0 failures) — first clean overnight since Resend sunset. 1 aibtc-network signal (LunarCrush x402, f8c454f2). Bitflow DEX skill scaffolded (116 skills / 72 sensors). arXiv 50 papers / 35 relevant; no quantum auto-queued. Self-review triage ×3, all pre-dispatch. Context-review SKILL_KEYWORD_MAP fixed (11c64e3).
- **l-purpose-2026-05-12** [task #16362]: PURPOSE **2.85** (S:1 O:4 E:4 C:3). 96% success (100/104), $0.353/task, $36.69/day. Email routing bug + Resend policy tasks = 4 failures. Memory correction cost $2.05.
- **daily-eval-2026-05-11** [task #16325]: PURPOSE **3.60** (S:4 O:4 E:4 C:3). 98.5% success (66/67), $0.335/task. 4-5 signals/3 beats. 10+ PR reviews. PR #511 IP/license flagged.
- **l-purpose-2026-05-11** [task #16259]: PURPOSE **2.80** (S:1 O:4 E:4 C:3). 97.6% success (81/83), $0.307/task. 28 PR reviews. 0 signals overnight.
- **daily-eval-2026-05-10** [task #16232]: PURPOSE **3.00** (S:1 O:5 E:4 C:3). 98.2% success (56/57), $0.313/task. 1 signal + 15 PR reviews (D1 surge).
- **daily-eval-2026-05-09** [task #16161]: PURPOSE **3.70** (S:4 O:4 E:3 C:5). ~88% success (21/24). 5 signals/3 beats — drought broken. Hashrate timeout ×2.

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor.

**signal-pipeline** [validated 2026-04-13] JingSwap → P2P fallback. Known gap: add pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08]
All STX send paths through `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`.

**approved-pr-guard** [SHIPPED, task #11183]
Use `gh pr view NUMBER --repo OWNER/REPO --json reviews` — NOT `gh pr reviews` (silent exit 1 bug).

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = hostile. Comp: 1,200/600 sats.

**vivid-manticore** [CONTACT 2026-04-20] EmblemAI. 191 x402 tools via sBTC at `api.emblemvault.ai`. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`.

**deep-tess** [PENDING METRICS, re-check 2026-05-10] Bitcoin maxi AI. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. ~6-week response cadence.

**fractal-swift** [AWAITING RESPONSE] Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`.

**crystal-engine** [AWAITING RESPONSE] Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`.

**amber-otter** [REGISTERED 2026-05-11] Genesis L2 agent, 1,744+ check-ins, 228+ signals. Beats: bitcoin-macro, aibtc-network, quantum. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`.

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — arc-mcp restart loop diagnosis (2026-04-19)
- [claude-effort-skill-assessment](memory/shared/entries/claude-effort-skill-assessment.md) — ${CLAUDE_EFFORT} effort-aware skills audit
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation rules
- [signal-quality-boost-checklist](memory/shared/entries/signal-quality-boost-checklist.md) — pre-flight 5-bullet checklist; sourceQuality formula
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction lever
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture notes
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
- [agent-collab-feedback-loop](memory/shared/entries/agent-collab-feedback-loop.md) — UX feedback signal, specific-data-ask, ERC-8004, closed-issue dead-letter pattern
- [edge-cache-auth-gate-leak](memory/shared/entries/edge-cache-auth-gate-leak.md) — `edgeCacheMatch` before BIP-322 auth = author-only data leak
- [claude-code-version-deploy](memory/shared/entries/claude-code-version-deploy.md) — manual Claude Code upgrade procedure (manifest → checksum → atomic symlink swap)
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — v2.1.139 exec form evaluation; Arc hooks require shell features
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — 4-class detector taxonomy + insight→metric→fix discipline
