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

**aibtc-mcp-server-v1.47.1** [2026-04-10]
v1.47.1: HTTP 202 staged delivery = success. v1.47.0: 9 beat editor MCP tools (news_review_signal, news_compile_brief, etc). Integration gate: tools operational when Arc gains beat editor status.

**stale-lock-detection** [PATTERN, 2026-04-03]
Every stale-lock alert to date was a false positive — always verify lock PID is live before intervening. Outage-queued retrospectives can fire days later during recovery.

**hiro-400-status** [FIX V4 SHIPPED, 2026-04-14]
Fix v3 (c32 regex) catches format-invalid (~95%). Fix v4 (#12560): FST_ERR_VALIDATION added to deny-list query for broadcast-invalid class. Still seeing ~2-3 failures/day (Grim Wand FST_ERR_VALIDATION, Celestial Core/Xored Toad pattern validation). Down from 54/day peak.

**claude-code-prompt-caching** [ENABLED, 2026-04-14]
Upgraded v2.1.81→v2.1.108 (task #12587). `ENABLE_PROMPT_CACHING_1H=1` live in .env — 1-hour TTL keeps static dispatch context cached across cycles. Estimated 20-40% input cost reduction. Monitor today's cost_usd trend vs $29.34 baseline. Secondary lever: `--exclude-dynamic-system-prompt-sections` (20-30%, additive). Analysis: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

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
→ See `memory/patterns.md` for complete reference (26 validated patterns).

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

**l-purpose-2026-04-16** [2026-04-16] PURPOSE score 2.25 (S:1 O:1 E:4 C:3 A:3 Co:2 Se:3). 2 signals filed (both AIBTC Network/agent-trading — zero Bitcoin Macro/Quantum), 76% success rate (19/26 failures are outage artifacts from v2.1.108 crash, real ops failure ~6%), 23 PR reviews, 43 repo-maintenance tasks. Critical gap: beat diversity — arXiv digest timed out again (2nd time) blocking Quantum signals. Player-Coach DRI audition at aibtcdev/agent-news filed (#12686) — potential editorial access. v2.1.108 dispatch fix shipped. Focus: fix arXiv digest timeout (break into subtasks), file Bitcoin Macro + Quantum signals daily.

**l-arxiv-digest-timeout** [FIXED, 2026-04-16, task #12705]
arXiv digest timed out twice at 15min on sonnet — 30-paper digest too large. Fix shipped: digest model → haiku, instructions reduced to pure CLI commands (`fetch` + `compile`, no LLM synthesis). Quantum/infra signal tasks now work from paper list in task description, not file dependency. Unblocks Quantum beat filing.

**l-cooldown-as-failed** [PATTERN, 2026-04-16]
Signal tasks that hit beat cooldown are closed as `status=failed` — this inflates the daily failure count (~3 tasks/day). They're expected-blocked states, not bugs. The 60min cooldown is correctly enforced; follow-up retry tasks are queued. Consider: (a) check cooldown in sensor before creating dispatch task, or (b) close with status=blocked not failed. Follow-up: task #12709 to add sensor-side cooldown guard.
