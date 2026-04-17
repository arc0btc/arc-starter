# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-04-17T01:20:00Z*
*Token estimate: ~380t*

---

## [A] Operational State

**competition-100k** [EXPIRES: 2026-04-22]
Active. **Arc Score: 418 / Rank: #70 / Top: 1175 (Encrypted Zara)**. Gap: 757 pts.
- 3 beats: **AIBTC Network** (Elegant Orb), **Bitcoin Macro** (Ivory Coda), **Quantum** (Zen Rocket). Cap: 4/day/beat (hard economic ceiling: 175k/30k=5.83). Cooldown: 60min/beat. BIP-137 from bc1q.
- Filing cutoff: **23:00 UTC hard** (post-cutoff → rejected, refile next day — orphaned utcDate risk). Lock: 23:30 UTC. Displacement window: 23:15–23:30 UTC.
- Top AIBTC Network rejection categories (Apr 16): NO_IMPACT_SCALE(44), CLUSTER_DUP(34), ACTIVITY_METRIC(20), ROUTINE_DEP_BUMP(16). Guard: delta check + pending-task dedup before queuing.
- Issue #502 (cedarxyz): proposal for machine-readable editor rubric JSON + pre-submit lint runner. If Elegant Orb publishes rubric, Arc can validate at sensor time.
- Purpose trend: 2.95 (Apr 14) → 3.50 (Apr 16) → 2.45 (Apr 17, 0 signals overnight gap). Focus: 3-beat diversity daily.
- Sensors: aibtc-agent-trading (JingSwap/PSBT/registry), bitcoin-macro (240min), arXiv for quantum.

**hiro-400-status** [FIX V4 ACTIVE, ~2-3 failures/day]
Fix v4: FST_ERR_VALIDATION + c32 regex deny-list. Root cause: malformed SP addresses in registry. **Next: task #12721 registry cleanup scan — check if it ran.** v4 defers, doesn't remove.

**x402-relay** [HEALTHY, v1.29.0, 2026-04-15]
Self-healing mempool payments + nonce reconciliation. Fully autonomous. Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**aibtc-mcp-server** [v1.48.0, 2026-04-17]
Nostr banner field + axios CVE-2025-62718 patched. 9 beat editor MCP tools (v1.47.0). Gate: operational when Arc gains beat editor status.

**claude-code-prompt-caching** [CONFIRMED, 58% reduction]
`ENABLE_PROMPT_CACHING_1H=1` live. $12.37 vs $29.34 baseline overnight 2026-04-16. Secondary lever: `--exclude-dynamic-system-prompt-sections` (20-30%, not yet applied). Ref: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

**dispatch-gate** [STATE: 2026-03-23]
3 consecutive failures → stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

---

## [S] Services

**aibtc-news-signal-rules** [verified 2026-04-16]
Beats: `aibtc-network`, `bitcoin-macro`, `quantum` ONLY (all others 410). Cap: 4 approved/day/beat. Cooldown: 60min/beat. BIP-137 from bc1q. Sources must be GitHub-reachable.

**x402-relay** → use `aibtc-welcome` skill (not "x402-relay"). CB threshold=1.

**shared-refs**: no --bare flag in dispatch. Runtime state → .gitignore. Tasks/sensors/workflows require ≥1 skill.

---

## [P] Patterns
→ See `memory/patterns.md` (27 validated patterns).
- Stale-lock alerts: always false positives to date — verify PID live before intervening.
- Outage spikes (>200 "bulk triage"/"force killed") = single event, not individual bugs.
- Signal cooldown → close as `blocked` not `failed` (prevents inflating failure count).
- Compliance recurrers: `metadata.tags` nested instead of top-level; abbreviated sensor vars (`const res`). Ref: `memory/shared/entries/skill-frontmatter-compliance.md`.
- "Shipped" ≠ "working" — verify by checking if post-fix task IDs appear in failure list. 3× confirmed (hiro-400).

---

## [T] Active / Pending

**hiro-registry-cleanup** [PENDING]
Task #12721 registry cleanup scan. Malformed SP addresses persist in registry — v4 defer-lists at dispatch time but doesn't remove them. Must verify #12721 ran.

**cloudflare-email** [HUMAN ACTION REQUIRED]
Whoabuddy must verify `jason@joinfreehold.com` as allowed destination in Cloudflare Email Worker dashboard. Blocks overnight brief delivery.

**contracts-exploration** [ACTIVE, 2026-04-14]
Agent-to-agent escrow for post-competition sustainability. Phase 0 PR #10 reviewed — feedback: add is-active flag + emit events. Needs whoabuddy review before any deploy.

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night. Escalated to whoabuddy. No further inscription workflow runs.

---

## [L] Key Learnings

**retro-2026-04-17** [task #12823]
3 systemic patterns: (1) Cap-hit signal waste — sensor queuing after 6/6 cap exhausted (tasks #12787, #12796); fix: check cap before queuing (task #12841). (2) Flat-data signal waste — P2P sensor queues on zero deltas; add delta guard (all deltas=0 AND strength<50 → skip). (3) Hiro registry not cleaned — fix v4 defers only.

**quantum-gate-framework** [2026-04-16, aibtcdev/agent-news#497]
7-gate framework. Cluster cap: 2-signal limit/cluster (~65% rejections). ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID URL required for data claims (Gate 0, Apr 16 update). Score: 75 standard, 65 dark domains. "harvest" cluster underused. Full: `memory/shared/entries/quantum-gate-framework.md`.

**bitcoin-macro-sensor** [SHIPPED, 2026-04-16, task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min. Signals: price-milestone ($50K–$200K), price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). Sources: blockchain.info/ticker, mempool.space.

**signal-pipeline** [VALIDATED, 2026-04-13]
JingSwap → P2P fallback (faktory-dao-backend needs API key). 6/6 cap confirmed. Dedup gap: add pending-task check before queuing (sensor can create 2 tasks before cooldown propagates).

**nonce-serialization** [SHIPPED, 2026-04-08]
Shared nonce coordinator in stx-send-runner.ts + tx-runner.ts. Zest mempool-depth guard added. TooMuchChaining resolved. Zest 4–5/5 supply ops nightly.

**approved-pr-guard** [SHIPPED, 2026-04-08, task #11183]
Check `gh pr reviews` before queuing — eliminated ~90% of duplicate-review failures. Round-based dedup for iterating PRs still needed.

**arc-starter-classified** [2026-04-16]
Live on aibtc.news (id: 6565d96e, 7-day). First commercial listing. Classified skill is production-ready.
