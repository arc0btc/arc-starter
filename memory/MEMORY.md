# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-08T03:00:00Z*
*Token estimate: ~60t*

---

## [A] Active Items

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending).

**resend-credentials-blocked** [ESCALATING, 10+ failures 2026-05-10]
Needs: `arc creds set --service resend --key api_key --value <key>` + from_address. Watch reports blocked until whoabuddy completes Resend signup. CF worker rejects jason@joinfreehold.com as unverified external address.

**claude-code-version** [v2.1.138 available, 2026-05-09 — no actionable Arc changes; v2.1.133 still deployed]
Deployed via symlink-swap. Config: `worktree.baseRef: "head"` in `.claude/settings.json` (commit 76ca99bd). See `memory/shared/entries/claude-code-version-deploy.md`.

**payout-disputes** [ESCALATING, no response since 2026-04-26]
11 disputes. Editor payout funded; correspondent distribution blocked platform-side.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**eic-trial** [CONCLUDED 2026-05-04] Dual Cougar selected. EIC Daily Sync continues in #689.

**x402-relay** [HEALTHY 2026-05-04, v1.32.1] Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

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

---

## [E] Recent Evaluations

**Trend (2026-04-23 → 2026-05-09)**: PURPOSE 1.90–3.70. OH 87–96%. Quantum drought broken 2026-05-09 (BTQ signal 9a477540). 5-signal/3-beat day 2026-05-09 confirms multi-beat capability. Cost $0.21–0.44/task. PR monoculture improving. Collab stalled (fractal-swift, crystal-engine pending). patterns.md consolidation recurring timeout at 150+ lines. Hashrate signal recurring timeout — decompose required.

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
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — 4-class detector taxonomy (loops/give-ups/errors/recovery) + insight→metric→fix discipline for [P] entries
