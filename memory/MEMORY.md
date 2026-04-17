# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-04-14T01:15:00Z*
*Token estimate: ~450t*

---

## [A] Operational State

**competition-100k** [2026-04-14] [EXPIRES: 2026-04-22]
Active. **Arc Score: 418 / Rank: #70 / Top: 1175 (Encrypted Zara)**. Gap: 757 pts.
- 3 beats only: **AIBTC Network** (all 10 former domains), **Bitcoin Macro**, **Quantum**. Old 12-beat model INVALID.
- Editors: AIBTC Network = Elegant Orb; Bitcoin Macro = Ivory Coda; Quantum = Zen Rocket.
- Correspondents earn 30k sats/signal included. File 4-gate quality signals (source/quantitative/temporal/red-flags). No external market data. No circular refs.
- Sensors: aibtc-agent-trading (JingSwap/PSBT/registry); ordinals-market-data SUSPENDED. arXiv for quantum.
- Signal pipeline VALIDATED 2026-04-13 (6/6 cap hit). arXiv 26/50 relevant — synthesis task pending.

**dispatch-gate** [STATE: 2026-03-23]
Rate limits or 3 consecutive failures → stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**x402-relay-v1.29.0** [HEALTHY, 2026-04-15]
v1.29.0: self-healing mempool payments (PRs #334/#335) + proactive nonce reconciliation (#337). nonce=2,660, missingNonces=[], mempoolCount=0. Fully autonomous — no manual intervention needed. Health check: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**aibtc-mcp-server-v1.48.0** [2026-04-17]
v1.48.0: Nostr banner field added to `nostr_set_profile` + axios CVE-2025-62718 patched. No breaking changes. v1.47.0: 9 beat editor MCP tools (news_review_signal, news_compile_brief, etc). Integration gate: tools operational when Arc gains beat editor status.

**stale-lock-detection** [PATTERN, 2026-04-03]
Every stale-lock alert to date was a false positive — always verify lock PID is live before intervening. Outage-queued retrospectives can fire days later during recovery.

**hiro-400-status** [FIX V4 SHIPPED, 2026-04-14]
Fix v3 (c32 regex) catches format-invalid (~95%). Fix v4 (#12560): FST_ERR_VALIDATION added to deny-list query for broadcast-invalid class. Still seeing ~2-3 failures/day (Tiny Fenn SP3G8K2F5…, Tidal Sprite SP2DP8XYN5… overnight 2026-04-16). Down from 54/day peak. **Next action: proactive registry cleanup scan — malformed SP addresses persist in registry, v4 deny-list defers rather than prevents.**

**claude-code-prompt-caching** [CONFIRMED, 2026-04-16]
Upgraded v2.1.81→v2.1.108 (task #12587). `ENABLE_PROMPT_CACHING_1H=1` live in .env — 1-hour TTL keeps static dispatch context cached across cycles. **Confirmed overnight 2026-04-16: $12.37 vs $29.34 baseline = ~58% reduction (exceeds 20-40% estimate).** Secondary lever: `--exclude-dynamic-system-prompt-sections` (20-30%, additive, not yet applied). Analysis: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

---

## [S] Services

**aibtc-news-signal-rules** [2026-04-06, verified 2026-04-16]
Active beats: ONLY 3 — `aibtc-network`, `bitcoin-macro`, `quantum`. All others (infrastructure, agent-trading, etc.) are RETIRED (410). Beat `aibtc-network` = unified AIBTC Network beat covering all former domains. Cap: 4 approved/day per beat. Cooldown: 60 min/signal per beat (separate counters). BIP-137 from bc1q address. Sources must be GitHub-reachable (mainnet.stx-sponsor.com not reachable from dispatch env).

**x402-relay** [SKILLS: aibtc-welcome]
x402-relay.aibtc.com. CB threshold=1. NOT a valid skill name — use `aibtc-welcome` skill for relay-touching tasks.

**shared-refs** [2026-03-23]
bare-flag-exclusion: dispatch never uses --bare flag. Runtime state files → .gitignore. v7: tasks/sensors/workflows require ≥1 skill.

---

## [T] Temporal Events

**t-competition-active** [2026-03-23 → 2026-04-22]
$100K competition. Score 418, rank #70. 6 signals/day filing cap. Streak: check daily — Claude usage-limit gaps break streaks.

---

## [P] Patterns
→ See `memory/patterns.md` for complete reference (27 validated patterns).

---

## [L] Recent Learnings

**l-collab-archive** [ARCHIVED]
Ionic Nova, Tiny Marten, Graphite Elan, Rising Leviathan, Flaring Leopard (pre-Apr-04). Flying Whale (Genesis, ecosystem contributor). Ionic Anvil ("Operation Satoshi's Stash" — monitoring Satoshi UTXO for quantum threat). Hermes/Lumen collab (whoabuddy local Qwen3.5 — Arc as signal scout). Details in git history.

**l-outage-pattern** [VALIDATED]
Bulk failure spikes (>200 tasks with identical "bulk triage"/"force killed" summaries) = single outage event, not individual bugs. Claude usage-limit gaps produce same stale-task flood. Treat as single event. Introspection sensor should detect and suppress outage-artifact analysis.

**l-hiro-400-history** [RESOLVED-MOSTLY, 2026-04-12]
9-day saga. Root cause: agent registry contains malformed SP-addresses (wrong-network or truncated). Fix evolution: v1 (sensor-time, wrong) → v2 (wrong file) → v3 (stx-send-runner.ts at transferStx call — correct). Broadcast-invalid bypass remains (task #12499). Pattern confirmed 3×: "shipped" ≠ "working" — verify by checking if post-fix task IDs appear in failure list.

**l-nonce-serialization** [SHIPPED, 2026-04-08]
STX sender-side concurrency fixed: shared nonce coordinator in stx-send-runner.ts + tx-runner.ts. Zest mempool-depth guard added — skip supply if active STX welcome tasks in mempool. TooMuchChaining resolved 2026-04-09. Zest 4–5/5 supply ops nightly since.

**l-signal-pipeline** [VALIDATED, 2026-04-12/13]
JingSwap 401 fallback (faktory-dao-backend requires API key — use P2P fallback) + sensor state corruption fix. 6/6 cap hit 2026-04-13. Dedup gap: sensor can create 2 tasks before cooldown propagates — add pending-task check before queuing.

**l-approved-pr-guard** [SHIPPED, 2026-04-08, task #11183]
Before queuing PR review, check if Arc already has an approved review via `gh pr reviews`. Eliminated ~90% of duplicate-review failures (was 30+/day). Guard catches same-notification dedup; round-based dedup for iterating PRs still needed.

**l-contracts-exploration** [ACTIVE, 2026-04-14]
Agent-to-agent escrow for post-competition financial self-sustainability. Phase 1: bilateral service escrow → Phase 4: marketplace. **Phase 0 PR #10 reviewed 2026-04-14** (agent-contracts repo: on-chain agent registry + escrow core contracts). Feedback: add is-active flag + emit events. Author may push updates. Needs whoabuddy review before any deploy.

**l-loom-spiral** [ESCALATED, 2026-04-11/12/13]
Inscription workflow 23 hitting ~1.1–1.2M tokens (×2 per night). Circuit breaker (#12238) split multi-state workflows but token spiral persists. Escalated to whoabuddy. No further inscription workflow runs until resolved.

**l-purpose-recent** [2026-04-14 14:55 UTC]
PURPOSE score 2.95 (S:2 O:3 E:4 C:3 A:3 Co:3 Se:3). 24h: 94.8% (127/134), $44.76/$0.334/task. 6/6 signal cap hit but all AIBTC Network beat — zero Bitcoin Macro/Quantum = beat diversity gap. 18 PR reviews across 5 repos. Hiro 400 fix v4 shipped (FST_ERR_VALIDATION). arXiv 30-paper digest compiled but no Quantum signal filed from it. Focus: beat diversity (2 Bitcoin Macro + 2 Quantum + 2 AIBTC Network) to break past 3.0.

**l-purpose-2026-04-16** [2026-04-16 14:57 UTC] PURPOSE score 3.50 (S:4 O:3 E:4 C:3 A:4 Co:2 Se:3). 6/6 cap hit across 3 beats (agent-trading + bitcoin-macro hashrate ATH + quantum). 154/189 tasks (81.5% raw, ~96% excluding 21 outage artifacts). 29 PR reviews. $56.78/$0.369/task. Bitcoin Macro sensor deployed + first signal filed. arXiv digest fix shipped (haiku model). Beat diversity gap CLOSED (3/3 beats). Focus: sustain 3-beat diversity, drive Quantum sensor auto-queuing, keep cost/task under $0.35.

**l-arxiv-digest-timeout** [FIXED, 2026-04-16, task #12705]
arXiv digest timed out twice at 15min on sonnet — 30-paper digest too large. Fix shipped: digest model → haiku, instructions reduced to pure CLI commands (`fetch` + `compile`, no LLM synthesis). Quantum/infra signal tasks now work from paper list in task description, not file dependency. Unblocks Quantum beat filing.

**l-cooldown-as-failed** [PATTERN, 2026-04-16]
Signal tasks that hit beat cooldown are closed as `status=failed` — this inflates the daily failure count (~3 tasks/day). They're expected-blocked states, not bugs. The 60min cooldown is correctly enforced; follow-up retry tasks are queued. Consider: (a) check cooldown in sensor before creating dispatch task, or (b) close with status=blocked not failed. Follow-up: task #12709 to add sensor-side cooldown guard.

**l-bitcoin-macro-sensor** [SHIPPED, 2026-04-16, task #12742]
Bitcoin Macro beat now has a dedicated sensor at `skills/bitcoin-macro/sensor.ts`. Runs every 240min (4×/day). Signal types: price-milestone (round-number crossings $50K–$200K, one-time), price-move (>5% in 4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks to retarget + ≥3% change). Data sources: blockchain.info/ticker (price), mempool.space hashrate+difficulty. First-run guard: pre-populates firedMilestones from current price so stale milestones never fire retroactively.

**l-arc-starter-classified** [2026-04-16, task #12736]
arc-starter services classified live on aibtc.news (id: 6565d96e, 7-day). First externally-visible commercial listing. Triggered by @Secret Mars mention on arc0btc/arc-starter#18. Confirms classified skill is production-ready and arc-starter has a public service offering in the AIBTC marketplace.

**l-beat-diversity-progress** [2026-04-16]
Bitcoin Macro beat activated overnight: sensor shipped (task #12742) + first signal filed (hashrate ATH 972.3 EH/s, id: 13f3d03e, task #12744). Beat diversity now 1/3 active (AIBTC Network + Bitcoin Macro, Quantum still 0). arXiv digest unblocked (haiku model, #12705) — 25 relevant papers compiled but no Quantum signal auto-queued overnight. Quantum sensor should queue today; if not, file manually from digest.

**l-compliance-recurring** [PATTERN, 2026-04-16]
Compliance scan 2026-04-16 found 4 findings — same 2 recurring patterns (3rd+ occurrence each): (1) `metadata.tags` nested frontmatter instead of top-level `tags:` (defi-portfolio-scanner, hodlmm-move-liquidity, sbtc-yield-maximizer, zest-auto-repay — all fixed); (2) abbreviated sensor variables `const res` in bitcoin-macro/sensor.ts (introduced by task #12742 same day — fixed). Both documented in `memory/shared/entries/skill-frontmatter-compliance.md`. These fire every compliance scan — new skill authoring consistently reintroduces them. Consider adding pre-commit lint check.

**l-permission-analysis-v2.1.111** [2026-04-16, task #12785]
v2.1.111's new `/less-permission-prompts` feature analyzed. Result: Arc's existing `--permission-mode bypassPermissions` is optimal for 24/7 autonomous operation. Granular allowlist offers no practical benefit for Arc's 68+ skills using diverse tools (git, bash, network, creds). Bypass mode is explicit in code (auditable), interactive features are not applicable to agent loops. Reference allowlist documented in `memory/shared/entries/arc-permission-model.md` for future multi-agent or regulated deployments. No settings.json changes needed. Full analysis: `research/permission-analysis-12785.md`. Pattern documented: `p-autonomous-permission-bypass`.

**l-purpose-2026-04-17** [2026-04-17 00:31 UTC] PURPOSE score 2.45/5 (S:1 O:2 E:4 C:3 A:3 Co:2 Se:3). 0 signals filed (overnight gap), 84.4% ops success, 10 PR reviews. Signal Quality at 1/5 is critical gap — sensor fired before morning signal cycle. Follow-up signal task auto-created. Focus: file across 3 beats today to recover.

**l-quantum-gate-framework** [2026-04-16, issue aibtcdev/agent-news#497]
Zen Rocket published full 7-gate framework for Quantum beat. Key: cluster cap (~65% of rejections, 2-signal limit per cluster), ≥3 quantum keywords (Gate 5), ≥500 chars + ≥1 specific number (Gate 6). Gate 0 April 16 update: specific data claims require specific URL (arxiv.org/abs/ID, not arxiv.org). Score threshold: 75 standard, 65 for dark domains. "harvest" keyword underused — harvest-risk angle on dormant UTXOs is open cluster. Full framework: `memory/shared/entries/quantum-gate-framework.md`.

**l-retro-2026-04-17** [2026-04-17, task #12823]
19 failed tasks. 3 systemic patterns extracted:
1. **Cap-hit signal waste** — 2 signal tasks dispatched after daily 6/6 cap already exhausted (tasks #12787, #12796). Cycles wasted composing valid signals that couldn't file. Sensor must check remaining daily cap before queuing. Follow-up: task #12841.
2. **Flat-data signal waste** — P2P sensor queues when all metrics unchanged (7→7 trades, 5000→5000 sats, 413→413 agents) AND strength ≤45/100. No incremental change = not newsworthy. Sensor should add delta guard: skip if all deltas=0 AND strength<50.
3. **Hiro FST_ERR_VALIDATION persists** — 3 STX welcome failures (#12803, #12802, #12782) from malformed SP addresses still in registry. Fix v4 defers them at dispatch time but registry itself has not been cleaned. Task #12721 (registry cleanup scan) — check if it ran.
Unblocked items requiring human action: Cloudflare Email Worker destination `jason@joinfreehold.com` not verified — blocks overnight brief emails. Whoabuddy must add as allowed destination in Cloudflare dashboard.
