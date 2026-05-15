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
- **Integration workflow flood** [2026-05-13, 41 no-op tasks]: Integration sensors must gate on `pendingOrCompletedTaskExistsForSource` for the same release version before queuing. Without this check, each sensor cycle queues a new integration task for an already-integrated version — 41 tasks, ~$5-6 wasted, 47% of overnight cycle capacity. Fix: add version-scoped completed-task check to integration sensor (same `pendingTaskExistsForSource` pattern as workflow-dedup).
- **Signal cooldown check must happen at sensor time** [2026-05-14, tasks #16576/#16577]: Signal filing sensors queued tasks during active cooldown windows → dispatch fails with "cooldown active." Sensors must call the cooldown API (or check last filed timestamp from cycle_log/tasks) before queuing. Failing at dispatch wastes a full cycle; failing at sensor is free.
- **Stacks address prefixes — SP vs SM vs ST** [CORRECTED 2026-05-14, BFF #517]: SP = standard mainnet, SM = multisig mainnet. Both are mainnet. Only ST and SN are testnet prefixes. Prior arc0btc review incorrectly flagged SM as testnet — caused author to introduce malformed SP address. Verify: `curl https://api.hiro.so/v2/contracts/source/<addr>/<contract>` → 200 = valid, 400 = malformed.
- **Cooldown at dispatch = schedule-for-later, not immediate requeue** [2026-05-14, tasks #16576/#16577; updated #16688]: When a signal task hits cooldown at dispatch time, do NOT create an immediate follow-up task (it will also fail). CLI CONSTRAINT: `tasks update --status blocked` is NOT supported — only `--status pending` works. Correct flow: (1) close current task as `failed` with cooldown explanation, (2) create new task with `--scheduled-for <cooldown-clear-time+5min>`. Sensor-generated signal tasks: sensor will re-queue naturally, so just close. Orchestrator-generated tasks: use `--scheduled-for`.
- **Claude usage quota = 19h dispatch outage** [2026-05-14, task #16675]: Extra-usage quota hit at 03:00Z → dispatch-gate STOPPED, no auto-recovery. Manual `arc dispatch reset` required. Fix: parse "resets HH:MM (TZ)" from stop_reason in `checkDispatchGate()` and auto-reset when past reset time. Safe only for rate_limited class. See `p-claude-usage-quota-outage`.
- **Batch-fail on dispatch restart after long gap** [2026-05-14, overnight brief]: When dispatch resumes after a long outage (19.5h), tasks queued by sensors during the gap batch-fail due to lock-gate conflicts. 13 tasks dropped including CEO review, arXiv digest, watch report, and health alerts. Time-sensitive tasks (P2–P4) are the highest-loss category. Investigation: consider auto-rescheduling CEO review + watch report tasks rather than dropping them on restart.
- **PR review pre-flight: check merged state before reviewing** [2026-05-15, tasks #16628/#16629/#16640/#16658]: 4 of 20 failures were PR review tasks that ran against already-merged PRs. Sensor queues review → PR merges before dispatch picks it up → wasted cycle. Fix: at start of any PR review task, run `gh pr view NUMBER --repo OWNER/REPO --json state --jq '.state'`; if `MERGED` or `CLOSED`, close the task as `completed` ("PR already merged/closed — no review needed") without reviewing.
- **Bounty-farming PR flood: escalate, don't review in loop** [2026-05-15, landing-page #854–#865]: 12 consecutive PRs, all HTML comment chains with no implementation, consumed 38% of overnight cycles. Pattern: PRs keep arriving faster than reviews can reject. Correct response after 3+ rejections of identical pattern: stop reviewing, create escalation task for whoabuddy, flag for policy change. Reviewing each one wastes a cycle; policy fix stops the flood.
- **Sensor health audit → same-night fix** [2026-05-15, task #16708→#16716]: Proactive sensor health review (P6, every N days) found beat-inactive dedup bug, enabling same-night fix (ab1273d0). Pattern validated: sensor health audit catches bugs that sensor self-monitoring misses. Schedule this audit regularly.

---

## [E] Recent Evaluations

**Trend (2026-04-23 → 2026-05-13)**: PURPOSE 1.90–3.70. OH 87–100%. Quantum drought broken 2026-05-09. 5-signal/3-beat days confirm multi-beat capability. Cost $0.21–0.44/task. Hashrate signal + patterns.md consolidation = recurring decompose targets.

- **daily-eval-2026-05-15** [task #16752]: PURPOSE **3.60** (S:2 O:5 E:4 C:4 A:4 Co:3 Sec:3). 67 completed / 2 failed (97% success), $22.86 / $0.327/task, 70 cycles. Quality 4.5/5 (rated 2). Queue empty (pending+blocked=0) → no boosts possible. Signal Quality remains weakest dimension (recurring); created 1 follow-up to research+file 1 bitcoin-macro or quantum signal candidate.
- **daily-eval-2026-05-13** [task #16573]: PURPOSE **3.45** (S:1 O:5 E:5 C:5 A:2 Co:2 Sec:3). 158 tasks/24h, 100% success (0 failures), $39.57 cost / $0.25/task. 1 signal (bitcoin-macro fee floor #16454), 26 PR reviews — ecosystem strong. Pending queue empty → no boosts possible. Signal Quality remains the single weak dimension; queued 1 follow-up for signal research.
- **overnight-2026-05-13** [task #16569 retro]: **100% success** (87/87, $18.05, $0.21/task). Bun 1.3.14 upgrade, 8+ PR reviews, blog published, arch docs updated. Integration workflow flooded 41 no-op tasks (~$5-6 waste). 29 arXiv relevant papers — below 35 threshold, no manual follow-up. arc-mcp restart loop RESOLVED (auth_key configured 2026-05-12; v2.1.141 token rotation fix additive, not causal).
- **daily-eval-2026-05-12** [task #16414]: PURPOSE **3.00** (S:1 O:5 E:3 C:5 A:2 Co:1 Sec:3). 53 tasks today, $13.21 ($0.249/task — score 5). Signal Quality=1 (1 signal, single beat). Pending queue empty → no boosts possible; queued #16415 quantum manual triage (arXiv 35-relevant rule).
- **overnight-2026-05-12** [task #16405]: **100% success** (30/30, 0 failures) — first clean overnight since Resend sunset. 1 aibtc-network signal (LunarCrush x402, f8c454f2). Bitflow DEX skill scaffolded (116 skills / 72 sensors). arXiv 50 papers / 35 relevant; no quantum auto-queued. Self-review triage ×3, all pre-dispatch. Context-review SKILL_KEYWORD_MAP fixed (11c64e3).
- **introspection-2026-05-14** [task #16611]: 99% success (159/161), $36.51/$0.227/task. arc-skill-manager 81/161 (50%) driven by PR maintenance surge. 0 signals filed. Both failures were cooldown violations at dispatch time — sensor should gate on cooldown before queuing. Signal Quality remains the single weakest dimension.
- **l-purpose-2026-05-15** [task #16685]: PURPOSE **2.35** (S:1 O:1 E:3 C:5 A:3 Co:2 Se:3). 73.6% success (53/72), $0.197/task, $14.17/day. 5 PR reviews, 0 signals. Dispatch outage cascade driving ops failure. Signal Quality + Ops both at floor.
- **l-purpose-2026-05-14** [task #16613]: PURPOSE **3.30** (S:1 O:5 E:4 C:5 A:3 Co:1 Se:3). 98.8% success (159/161), $0.227/task, $36.51/day. 31 PR reviews, 0 signals. Signal Quality remains weak link.
- **daily-eval-2026-05-14-pm** [task #16649]: PURPOSE **2.35** (S:2 O:1 E:2 C:5 A:3 Co:1 Se:3). 66% success (37/56, 19 failed), $10.04/day, $0.179/task — cost score is offset by **dispatch 19h outage overnight** that cascaded 12+ FP failures (missed overnight brief/watch report/arXiv digest + stale dispatch health alerts). Only 2 signals (bitcoin-macro difficulty #16618, aibtc-network mcp-server #16612), 2 PR reviews. Below 3.0 trip — dispatch reliability is the dominant driver, not signal quality.
- **l-purpose-2026-05-13** [task #16451]: PURPOSE **3.20** (S:1 O:5 E:4 C:4 A:3 Co:2 Se:3). 98.9% success (89/90), $0.291/task, $26.19/day. 17 PR reviews, 0 signals. Bitflow DEX scaffolded, SKILL_KEYWORD_MAP fixed.
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

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = hostile. Comp: 1,200/600 sats. Last contact: 2026-05-14 (info message re trading competition on aibtc.com/leaderboard — replied, flagged to whoabuddy, no ops). Relationship: healthy.

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
- [shai-hulud-npm-worm-class](memory/shared/entries/shai-hulud-npm-worm-class.md) — recurring npm CI-takeover worms (TanStack CVE-2026-45321, Nx, tinycolor); kill dead-man's switch BEFORE rotating creds
