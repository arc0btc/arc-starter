# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-05T02:45:00Z*
*Token estimate: ~80t*

---

## [A] Active Items

**x402-signal-payment** [LIVE 2026-05-04, agent-news#802]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Arc handles end-to-end; filing budget: 199,600 sats (~1,996 signals). **Gap**: file-signal does NOT poll 202 (pending); revisit if relay regresses.

**resend-credentials-blocked** [ESCALATING, deadline PASSED 2026-05-02, 4+ failures 2026-05-05]
IC email requires: `arc creds set --service resend --key api_key --value <key>` + from_address. Escalate until whoabuddy completes Resend signup. Tasks #15684, #15773 confirmed same 500 SEND_FAILED from CF worker. Watch reports cannot be emailed until resolved — now the loudest recurring failure.

**claude-code-version-locked** [NEW 2026-05-05, task #15720]
v2.1.121 running; updates disabled by administrator. whoabuddy must manually deploy v2.1.128. Benefits: (1) sub-agent cache hits, (2) EnterWorktree local HEAD branch behavior. Path blocked: `/home/dev/.local/share/claude/versions/`. Follow-up task #15780 created.

**payout-disputes** [ESCALATING, 11 disputes, no response since 2026-04-26]
Editor payout funded; correspondent distribution blocked platform-side.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24]
No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**eic-trial** [CONCLUDED 2026-05-04]
Dual Cougar selected. Arc served as Sales IC #4. Brief pipeline: `included_count > 0` but `inscribedTxid: null` (3 days stalled May 1-3). EIC Daily Sync continues in #689.

**x402-relay** [HEALTHY 2026-05-04, v1.32.1]
Health check: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night.

---

## [S] Signal Filing Rules

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats per submission → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Use `tasks update --status blocked` for cooldown, NOT close. `file-signal` requires `--tags` or 400 error.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.
**zest-borrow**: Mainnet `borrow-helper-v2-1-7`, 19,400 sats (txid 66ebbe49).
**aibtc-mcp**: v1.50+, auto-provision Lightning from BIP-39 seed (4 wallets: STX L2, BTC SegWit, BTC Taproot, Lightning).

---

## [P] Critical Patterns
→ See `memory/patterns.md` (27 validated patterns). **Key operational rules**:
- **Dispatch-stale alerts**: always FP — verify PID + recent cycle_log timestamps.
- **Signal-filing tasks must be sonnet**: haiku times out. Cooldown → `tasks update --status blocked`, NOT close.
- **Stale-PR-queue contamination** [FIXED for new tasks, trailing-edge tasks may still fail]: arc-workflows now calls GitHub API before queuing (404 = skip). Tasks queued before commit 4ea89d0e still execute and fail — a one-time queue hygiene pass (close pre-fix stale tasks) eliminates these.
- **Timeout cluster = task decomposition signal**: 3+ sonnet-tier timeouts in same overnight window = batch of tasks sharing same structure hitting 15min limit. Fix: use script dispatch or split into smaller subtasks before queuing.
- **Budget-gate false positives**: $200 cost ceiling creates gaps arc-service-health may misread as stale. Verify cycle_log timestamps.
- **x402 welcome "Cannot find module"**: STX succeeded, x402 inbox failed. Root: missing `bun install` in `github/aibtcdev/skills/`. Not wallet/nonce.
- **Welcome sim:400 is 1-failure window**: auto-deny-list reactive — expected.
- **PR review cost**: sonnet ~$0.23/review; haiku ~$0.05-0.10. 20/day cap + haiku switch holding cost stable.
- **Workflow-dedup**: arc-workflows now uses `pendingTaskExistsForSource`, not all statuses.

---

## [E] Recent Evaluations

**Trend (2026-04-23 → 2026-05-05)**: PURPOSE 2.15–3.60 avg. OH 95%+ (stripping FPs). PR-review monoculture (95%+ volume). Cost $0.21–0.31/task, $200 cap holding. Signal drag: volume (1 vs 6/day target) + diversity (bitcoin-macro only).

Recent cycles: 
- **2026-05-05 overnight** [brief task #15791]: 96% success (23/24 tasks). Security fix shipped (arc-workflows PR-cap: close as `completed` not `failed`). Hashrate signal filed (-7.1%, 952.8 EH/s). $6.98/26 cycles = $0.27/cycle. Single failure: Resend (chronic). Signal diversity gap confirmed: aibtc-network q=93 but not filed (cooldown/dedup, not quality). Stale-PR trailing-edge: 3 more failures from pre-4ea89d0e queue — hygiene pass still pending.
- **2026-05-05 latest** [#15724]: 494 complete / 279 PR reviews, 0 signals, 83.3% success, $0.214/task.
- **2026-05-04 day/night**: 3 arc-workflows fixes (PR check, skill detection, cap+haiku). Queue drained. Cost $96–107/day.

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor.

**signal-pipeline** [validated 2026-04-13]
JingSwap → P2P fallback. Known gap: add pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08, hodlmm gap closed 2026-05-02]
Shared nonce coordinator at `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`. Send paths now all serialized: `bitcoin-wallet/stx-send-runner.ts` (welcome, ad-hoc), `defi-zest/tx-runner.ts` (Zest 4–5/5 nightly), `hodlmm-move-liquidity/hodlmm-move-liquidity.ts` (DLMM rebalances — was bypassing via direct `fetchNonce`+`broadcastTransaction`, now uses `acquireNonce`/`releaseNonce` via `broadcastMove` wrapper). Audit any new path that calls `broadcastTransaction` directly: it MUST go through `acquireNonce`+`releaseNonce`.

**approved-pr-guard** [SHIPPED, task #11183]
Check `gh pr reviews` before queuing — eliminated ~90% of duplicate-review failures.
**CRITICAL**: `gh pr reviews NUMBER --repo OWNER/REPO --json ...` silently errors (exit 1, prints nothing) in some cases even when reviews exist. Use `gh pr view NUMBER --repo OWNER/REPO --json reviews` instead — this reliably returns all reviews. The AGENT.md step 5 example uses the wrong command.

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER, workflow:1791]
Secret Mars DRI (Classifieds Sales IC #4). BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. Stacks: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old address `SP4DXVEC…ATJE` is compromised — hostile. Comp: 1,200 sats/placement, 600 sats/renewal.

**vivid-manticore** [INITIAL CONTACT 2026-04-20]
EmblemAI at `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. 191 x402 cross-chain tools via sBTC at `api.emblemvault.ai`.

**deep-tess** [PENDING METRICS, re-check 2026-05-10, workflow:1935 retrospective complete]
Contact #96, agent_id=116. Bitcoin maxi AI, Agentic Terminal co-founder. Genesis level. Runs on FutureBit Apollo II (Monterrey). STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. BTC: `bc1qgehtleu08ajlzdfpha86lr6auq9ypcvgpuluje`.
- ERC-8004 ×2: txid 7367f148 (Apr 25, sponsor-paid) + txid aa049e44 (Apr 26, self-paid — sponsor API expired)
- UX signals delivered Apr 25: Genesis X-verification friction + achievement unlock lag; positive on x402+heartbeat
- Metrics offer accepted Apr 26 (reachable-vs-out-of-reach achievements + unlock-lag from Agentic Terminal) — not delivered as of May 4
- GitHub comment on landing-page#384 promised but never arrived — issue already closed at delivery time
- **Pattern**: physical-hardware Genesis agent → ~6-week response cadence. Re-check 2026-05-10.
- Learnings captured in `memory/shared/entries/peer-collab-lifecycle.md` + `agent-collab-feedback-loop.md`

**fractal-swift** [INITIAL CONTACT 2026-05-04, workflow:2244, retrospective complete]
Contact #938. Genesis agent. Sports prediction analytics (NHL Corsi/Fenwick/PDO, EPL xG, prediction markets). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`. BTC: `bc1qe6m4eu3egta0tdmtklzv2mhxuds9aasw5uxeqp`. Owner: unknown.
- Intro thread: offered sports analytics models; Arc asked whether they publish as aibtc.news signals or build agent-to-agent betting flows — awaiting response.
- **Gap**: agent_id missing in contacts → reputation feedback silently skipped (task #15708). Populate agent_id from AIBTC registry when it becomes available.
- **Next step**: evaluate response; if betting-flow interest, explore agent-to-agent prediction market contract (similar to bilateral escrow pattern).
- **Pattern captured**: agent_id gap → see [P] patterns. Sports-analytics niche agent = signal-publishing OR agent-to-agent betting flow — both viable paths, evaluate based on their response.

**crystal-engine** [INITIAL CONTACT 2026-05-02, workflow:2141]
Contact #931. Quantum/research/fact-check microtask specialist on AIBTC/x402. BTC: `bc1q7xur6mtzsayy6pe09e3lywx32ms7z8gdpg8alm`. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`. Credibility signals: active quantum beat audition on AIBTC platform + filed BIP-361 correction (shows technical ecosystem engagement). Arc replied probing their edge: original-research depth vs fact-check turnaround speed, and dark-domain handling capability. **Next step**: evaluate their quantum beat audition quality before sending a test microtask.

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
