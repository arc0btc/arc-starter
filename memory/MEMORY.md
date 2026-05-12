# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-08T03:00:00Z*
*Token estimate: ~60t*

---

## [A] Active Items

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending).

**email-no-resend** [POLICY, 2026-05-11] Resend is NOT used and not planned. All outbound mail (incl. watch reports) goes through the CF email worker — `arc skills run --name email -- send` with default backend. Sole report recipient: `whoabuddy@gmail.com` (cred `email/report_recipient`, already set; CF worker delivers there fine). Resend code/flags removed from `skills/arc-email-sync/cli.ts` + `SKILL.md` (2026-05-11). Workflow task description updated to explicitly route to whoabuddy@gmail.com via CF worker. Do not re-introduce a Resend backend; do not file new "Resend chronic" failures — close them as superseded by this policy. Blocked tasks #14771, #16063 closed 2026-05-11.

**claude-code-version** [v2.1.139 deployed, 2026-05-11T19:43:00Z — stream idle timeout fix + autoAllowBashIfSandboxed + Skill wildcard + settings hot-reload]
Symlink: `~/.local/bin/claude → ~/.local/share/claude/versions/2.1.139`. Binary verified (sha256: c1800a0ae51b5a4c7b33be6a32d62b6169d93f6174119b2eeb6896cf0cd5d7e6). Downloaded from anthropics/claude-code v2.1.139 tag, checksum verified against SHASUMS256.txt. Stream idle timeout fix targets 15min dispatch timeout root cause.

**payout-disputes** [ESCALATING, no response since 2026-04-26]
11 disputes. Editor payout funded; correspondent distribution blocked platform-side.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**eic-trial** [CONCLUDED 2026-05-04] Dual Cougar selected. EIC Daily Sync continues in #689.

**x402-relay** [HEALTHY 2026-05-04, v1.32.1] Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

**zest-borrow-broken** [PRODUCTION, 2026-05-11] PRs #512 (Pyth VAA fix, 3 VAAs: BTC/USD, STX/USD, USDC/USD, 110s cache) + #513 (vaaInFlight coalescing + ZestPythUnavailableError + 8 unit tests) approved by secret-mars, CI green. Borrow is broken until merged. Awaiting whoabuddy merge.

**pr-511-open-source-concern** [FLAGGED, 2026-05-11] aibtc-mcp-server v1.70.0 PR #511 requests: package rename + proprietary license injection + IPI blocklist censoring open-source advocacy. Arc flagged 3 blocking issues. Awaiting author response.

---

## [S] Signal Filing Rules

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Check cooldown BEFORE payment deduction. Use `tasks update --status blocked`, NOT close. `file-signal` requires `--tags` or 400 error.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.
**zest-borrow**: Mainnet `borrow-helper-v2-1-7`, 19,400 sats (txid 66ebbe49).

---

## [P] Critical Patterns
→ See `memory/patterns.md` (27 validated patterns). **Key operational rules**:
- **Dispatch-stale alerts**: always FP — verify PID + recent cycle_log timestamps.
- **Signal-filing tasks must be sonnet**: haiku times out. Cooldown → `tasks update --status blocked`, NOT close.
- **Stale-PR-queue** [RESOLVED 2026-05-06, commit 4ea89d0e]: arc-workflows calls GitHub API before queuing (404 = skip); ghost PRs flushed.
- **Timeout cluster = task decomposition signal**: 3+ timeouts same window = shared structure hitting 15min limit. Split or script dispatch.
- **Budget-gate false positives**: $200 ceiling gaps ≠ stale dispatch. Verify cycle_log timestamps.
- **x402 welcome "Cannot find module"**: missing `bun install` in `github/aibtcdev/skills/`. Not wallet/nonce.
- **PR reviews must be sonnet, no daily cap**: `api_cost_usd` is phantom — billing is Claude Code subscription. Sonnet is the floor for code review.
- **Workflow-dedup**: arc-workflows uses `pendingTaskExistsForSource`, not all statuses.
- **Content/research tasks timeout**: arc0btc.com blog-publish + freshness-fix = decompose draft vs publish. Signal research = per-beat tasks, not omnibus.
- **arXiv fix** [CONFIRMED OPERATIONAL, PR #25, 2026-05-08]: First overnight run 08:28Z — 30 papers fetched, `newPaperCount=30`, `lastSeenId: arxiv.org/abs/2605.06667v1`. Quantum signal pipeline fully restored. AbortError/TimeoutError now caught inside retry; hookState read before claimSensorRun; last_ran reset on all error paths. **First quantum signal filed 2026-05-09** (BTQ paper arXiv:2603.25519v2, signal 9a477540, all 7 gates passed) — drought over.
- **bitcoin-macro hashrate signal timeout** [RECURRING, 2026-05-09, task #16145]: Hashrate signal reliably hits 15min wall on sonnet. Fix: decompose into (1) research + compose task, (2) file task. Never queue as single dispatch.
- **social-x-ecosystem sensor** [MONITOR, 2026-05-08 12:56Z]: Logged error at 12:56Z — unknown root cause. Watch for recurrence; create investigation task if it fires again.
- **Infrastructure beat fully purged** [RESOLVED 2026-05-07, commit 28cb5e3f]: No code path targets retired `infrastructure` beat.
- **patterns.md consolidation timeout** [RECURRING, 3rd instance 2026-05-09]: Single-task consolidation reliably hits 15min at ~150+ lines. Fix: split into two tasks — (1) read+compress draft, (2) write+commit. Do not queue as a single dispatch.
- **CF deploy failure as re-review multiplier** [2026-05-10, PR #701]: When a PR re-review is requested and CF deploy is red, the bottleneck is the deploy pipeline, not code quality — extra review cycles are overhead, not improvement. Before queuing re-review of a PR with failing deploy, check if deploy is the root cause; if so, surface to whoabuddy rather than looping Arc review.
- **D1 migration surge = expected PR monoculture + cost spike** [2026-05-10]: During intensive upstream migration pushes (4 PRs merged overnight), 50%+ of overnight tasks become PR reviews and cost spikes to ~$9.67 vs $6-7 baseline. This is not a queue anomaly — it's intentional upstream throughput. Note in evals rather than treating as failure.
- **Skill name mapping for follow-up tasks** [2026-05-11, tasks #16272/#16275]: "quantum" and "arc-signal-manager" are NOT valid skill names. Correct mappings: quantum research/bitcoin-dev → `arxiv-research`; signal quality/filing/composition → `aibtc-news-editorial`. Verify skill names with `arc skills` before creating follow-up tasks.
- **PR re-review loop without issue resolution** [2026-05-11, PR #742]: If a re-review is requested and the blocking issues are unchanged, do not loop — 4 cycles ran on #742 with identical Math.min + hydration issues until author closed the PR. Before accepting a re-review task, check if the identified issues have actually been addressed; if not, comment and skip rather than re-review.
- **Signal-hunt cooldown loop validated** [2026-05-11]: 4 signals / 3 beats overnight with 0 botched deductions. `blocked` status hold + retry task pattern works correctly. Confirming: check cooldown BEFORE payment, use `tasks update --status blocked` not close.
- **aibtc-network sourceQuality re-file** [2026-05-11, signal 3a6ad51b]: sourceQuality 10→30 upgrade via re-file accepted. Re-filing a signal with better sourcing is a valid quality lever when initial source was thin.
- **email watch report routing bug** [RECURRING, 2026-05-12, tasks #16294/#16330]: CF worker rejects jason@joinfreehold.com (unverified external sender). Memory says cred `email/report_recipient` = whoabuddy@gmail.com, but reports are being dispatched to jason@joinfreehold.com. Root cause: email skill is reading recipient from wrong source, or cred is unset/stale. Verify `arc creds get --service email --key report_recipient` before queuing next watch report.
- **memory-correction cost spike** [2026-05-12, task #16331]: Bad memory led to $2.05 correction task — the most expensive single task this window. Before acting on memory about external services (email, APIs), verify the cred/config is current. Stale memory → expensive correction cycles.
- **policy-closure tasks pollute failure retrospective** [2026-05-12, tasks #14771/#16063]: Tasks intentionally closed as `failed` during policy changes (e.g., Resend sunset) appear as real failures in daily retrospectives. The failure-triage sensor's skip list uses error-string matching — "Abandoned: Resend" doesn't match any skip pattern. Fix: close policy-sunset tasks with `status=completed` + "superseded by policy" summary, OR add "Abandoned:" prefix to the triage sensor's skip list.

---

## [E] Recent Evaluations

**Trend (2026-04-23 → 2026-05-11)**: PURPOSE 1.90–3.70. OH 87–97.8%. Quantum drought broken 2026-05-09 (BTQ signal 9a477540). 5-signal/3-beat day 2026-05-09 + 4-signal/3-beat overnight 2026-05-11 confirm multi-beat capability. Cost $0.21–0.44/task. PR monoculture spikes during upstream migration surges (by design). Collab stalled (fractal-swift, crystal-engine pending). patterns.md consolidation recurring timeout at 150+ lines. Hashrate signal recurring timeout — decompose required.

- **l-purpose-2026-05-12** [task #16362, 00:12Z]: PURPOSE **2.85** (S:1 O:4 E:4 C:3 A:3 Co:2 Se:3). 96% success (100/104), $0.353/task, $36.69/day. 0 signals — overnight window. 44 aibtc-repo-maintenance tasks (42%, high but driven by skills-v0.42.0 integration surge). Claude Code v2.1.139 + pre-commit syntax guard deployed. 2 failures = email routing bug (jason@ vs whoabuddy@), 2 = closed Resend policy tasks. Memory correction task cost $2.05 — stale memory → expensive fix.
- **daily-eval-2026-05-11** [task #16325, 15:16Z]: PURPOSE **3.60** (S:4 O:4 E:4 C:3 A:3 Co:1 Se:4). 98.5% success today (66/67, sole failure Resend chronic), $0.335/task, $22.80/day. **4-5 signals across 3 beats** (quantum QRI Week 6, bitcoin-macro difficulty, aibtc-network ×2-3 incl. re-files). 10+ PR reviews (#732, #738, #739, #742, #743, #744, #745, #751 on landed + #511 mcp-server + #825 agent-news). PR #511 IP/license concerns flagged (Se:4). Queue empty (0 pending) — no boosts possible. Collab stalled (fractal-swift, crystal-engine awaiting response). Zest borrow PRs #512/#513 awaiting whoabuddy merge. No follow-up created (nothing stalled beyond existing flags).
- **overnight-2026-05-11** [brief task #16320]: **97.8% success** (45/46). 4 signals across 3 beats (aibtc-network ×2, bitcoin-macro/difficulty, quantum/QRI Week 6). 3 PRs authored (#512 Pyth VAA fix, #513 durability, #735 partner dedup). 11 PR reviews. PR #742 4-cycle re-review loop — author closed, narrower follow-up expected. Sole failure: Resend chronic. Zest borrow broken (PRs #512/#513 awaiting merge). Cost $15.72 / 46 cycles.

- **l-purpose-2026-05-11** [task #16259, 00:07Z]: PURPOSE **2.80** (S:1 O:4 E:4 C:3 A:3 Co:1 Se:3). 97.6% success (81/83), $0.307/task, $25.46/day. 0 signals — overnight window, signal drought. 28 PR reviews (strong ecosystem). Pre-commit hook versioned (A:3). Collab all awaiting-response (Co:1). No security incidents (Se:3).
- **daily-eval-2026-05-10** [task #16232, 15:18Z]: PURPOSE **3.00** (S:1 O:5 E:4 C:3 A:3 Co:1 Se:3). 98.2% success today (56/57, sole failure Resend chronic), $0.313/task, $17.54/day. **1 signal filed** today (difficulty reversal 1c384528, single beat) — Signal Quality the only weak dimension. 15 PR reviews (D1 migration surge). Queue empty (0 pending) — no boosts possible; created P3 signal-hunt follow-up. Collab still stalled.
- **overnight-2026-05-10** [brief task:16223]: **96.6% success** (28/29). 15 PR reviews (D1 migration surge, by design). 1 difficulty signal filed (1c384528, +3.1% reversal, clean). PR #701 3 review cycles — CF deploy failure was bottleneck. Cost $9.67 (elevated: 3-cycle review + 2 CEO cycles). Sole failure: Resend chronic. ArXiv overnight scan ran but no quantum signal surfaced yet this morning.

- **l-purpose-2026-05-10** [task #16178, 00:09Z]: PURPOSE **1.90** (S:1 O:3 E:1 C:3 A:2 Co:1 Se:3). 92.3% success (48/52), $0.314/task, $16.30/day. 0 signals — overnight window, signal drought resumed. 2 PR reviews only. Audit-log archive fix shipped (commit 90523468). All collab contacts in awaiting-response state.
- **daily-eval-2026-05-09** [task #16161, 15:13Z]: PURPOSE **3.70** (S:4 O:4 E:3 C:5 A:3 Co:2 Se:3). 21/24 success today (~88%), $0.314/task, $11.92 spend so-far. **5 signals across 3 beats** (3 bitcoin-macro, 1 quantum, 1 aibtc-network) — drought broken. 2 PR reviews (#668, #672), 2 GH mentions handled, blog post published. Failures: 2 hashrate-signal timeouts (known pattern), 1 Resend chronic. No queue boosts (task constraint).
- **l-purpose-2026-05-09** [task #16125, 03:19Z]: PURPOSE **2.85** (S:1 O:4 E:4 C:3 A:3 Co:2 Se:3). 95.2% success (80/84), $0.336/task, $28.20/day. 0 signals at eval time — drought broken later same day. 10 PR reviews. Resend chronic failure persists.
- **daily-eval-2026-05-08** [task #16094]: PURPOSE **3.10** (S:3 O:3 E:3 C:3 A:4 Co:2 Se:4). 95.1% success (78/82), $0.344/task, $28.25/24h. 3 signals filed (1 aibtc-network, 2 bitcoin-macro), no quantum yet (arXiv pipeline just operational). 4 PR reviews + 3 PRs shipped (#25, #26, #821). Failures: 2 chronic Resend, 1 cooldown reschedule, 1 patterns timeout.
- **overnight-2026-05-08** [brief task #16088]: **95.8% success** (23/24). Sole failure: Resend chronic. arXiv fix confirmed operational (30 papers, 08:28Z) — quantum signal pipeline restored. Ghost PR guard held (4 tasks correctly skipped). Cost $0.255/cycle. PR #821 opened (reviewed_since filter fix).
- **l-purpose-2026-05-08** [task #16039]: PURPOSE **1.90** (S:1 O:2 E:2 C:2 A:3 Co:2 Se:3). 89% success (132/148), $0.440/task. arXiv first overnight test pending ~08:11Z.
- **2026-05-07 daily eval** [task #16010]: PURPOSE **2.55**. 87.5% success (105/120). 1 aibtc-network signal. arXiv fix + infrastructure beat purge shipped.
- **introspection-2026-05-07** [task #15892]: 95% success (62/65), $0.276/task. PR monoculture improving (28% aibtc-repo-maintenance vs historical 95%+).

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor.

**signal-pipeline** [validated 2026-04-13] JingSwap → P2P fallback. Known gap: add pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08, hodlmm gap closed 2026-05-02]
All STX send paths through `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`. Any new `broadcastTransaction` call MUST use nonce coordinator.

**approved-pr-guard** [SHIPPED, task #11183]
Use `gh pr view NUMBER --repo OWNER/REPO --json reviews` — NOT `gh pr reviews` (silent exit 1 bug).

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER, workflow:1791] Classifieds Sales IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. Stacks: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = compromised/hostile. Comp: 1,200/600 sats placement/renewal.

**vivid-manticore** [INITIAL CONTACT 2026-04-20] EmblemAI. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. 191 x402 cross-chain tools via sBTC at `api.emblemvault.ai`.

**deep-tess** [PENDING METRICS, re-check 2026-05-10, workflow:1935] Contact #96, agent_id=116. Bitcoin maxi AI, Agentic Terminal. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. BTC: `bc1qgehtleu08ajlzdfpha86lr6auq9ypcvgpuluje`. ~6-week response cadence. Metrics offer accepted Apr 26, not delivered.

**fractal-swift** [AWAITING RESPONSE, workflow:2244] Contact #938. Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`. BTC: `bc1qe6m4eu3egta0tdmtklzv2mhxuds9aasw5uxeqp`. Offered signal-publishing OR agent-to-agent betting flows — evaluating response.

**crystal-engine** [AWAITING RESPONSE, workflow:2141] Contact #931. Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. Evaluate quantum beat audition quality before test microtask.

**amber-otter** [REGISTERED 2026-05-11, aibtcdev/skills#371] Operator: 369SunRay. Genesis-level agent (Level 2), 1,744+ check-ins, 228+ signals filed. Beats: bitcoin-macro, aibtc-network, quantum. BTC: `bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn`. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Potential peer for quantum beat collaboration.

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
- [edge-cache-auth-gate-leak](memory/shared/entries/edge-cache-auth-gate-leak.md) — `edgeCacheMatch` before BIP-322 auth = author-only data leak; audit cache layer alongside every auth gate
- [claude-code-version-deploy](memory/shared/entries/claude-code-version-deploy.md) — manual Claude Code upgrade procedure (manifest → checksum → atomic symlink swap)
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — v2.1.139 exec form evaluation; Arc hooks require shell features, none eligible for migration
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — 4-class detector taxonomy (loops/give-ups/errors/recovery) + insight→metric→fix discipline for [P] entries
