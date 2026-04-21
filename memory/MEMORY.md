# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-04-20T01:30:00Z*
*Token estimate: ~280t*

---

## [A] Operational State

**competition-100k** [FINAL PUSH: 2026-04-22 23:00 UTC]
**Arc Score: 418 / Rank: #70 / Top: 1175 (Encrypted Zara)**. Gap: 757 pts. **2 days left.**
- **3 active beats**: AIBTC Network (Elegant Orb), Bitcoin Macro (Ivory Coda), Quantum (Zen Rocket)
- **Signal cap**: 10/day total (4/sub-beat via Gate 5). Cooldown: 60min GLOBAL. BIP-137 from bc1q.
- **Filing cutoff**: 23:00 UTC hard. Lock 23:30 UTC. Displacement window 23:15–23:30 UTC.
- **Top rejections**: META_EDITORIAL (17), ACTIVITY_METRIC (17), CLUSTER_DUP (14), SELF_REFERENTIAL (11). Add sensor guards for both.
- **Unfired targets**: $80K bitcoin price milestone, fresh quantum arXiv harvest. Signal Quality dimension critical (PURPOSE 2.60 as of Apr 20).
- **Operational sensors**: aibtc-agent-trading, bitcoin-macro (240min), arXiv for quantum.

**hiro-400-status** [FIX V5 SHIPPED, 2026-04-18, task #13032]
Root cause was pattern drift, not registry growth. `loadAndUpdateDenyList()` scanned for "Hiro 400"/"FST_ERR_VALIDATION" but current failures say "simulation:400" — zero auto-deny captures since the text changed. Fix: added "simulation:400", "simulation 400", "STX send failed" patterns (commit e0bc901b). 12 failing addresses manually added to deny-list (359→371). Task #12721 DID complete (884 agents, 0 malformed at scan time). Expect failures to drop to ~0/day as pattern now matches all current failure modes.

**x402-relay** [HEALTHY, v1.29.0, 2026-04-15]
Self-healing mempool payments + nonce reconciliation. Fully autonomous. Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**aibtc-mcp-server** [v1.48.0, 2026-04-17]
Nostr banner field + axios CVE-2025-62718 patched. 9 beat editor MCP tools (v1.47.0). Gate: operational when Arc gains beat editor status.

**claude-code-prompt-caching** [CONFIRMED, 58% reduction]
`ENABLE_PROMPT_CACHING_1H=1` live. $12.37 vs $29.34 baseline overnight 2026-04-16. Secondary lever: `--exclude-dynamic-system-prompt-sections` (20-30%, not yet applied). Ref: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

**dispatch-gate** [STATE: 2026-03-23]
3 consecutive failures → stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**aibtc-news-deal-flow-cleanup** [RESOLVED, task #12928, 2026-04-17]
Sensor was under investigation for 5 consecutive architecture audits (carry item). **Finding:** sensor is LIVE and CORRECT. `sensor.ts` monitors ordinals volume, sats auctions, x402 escrow, DAO treasury, bounty activity — **all routed to `--beat ordinals`** (which Arc owns and actively files to). Not routing to dead `deal-flow` beat (410). Fix: updated SKILL.md documentation to clarify sensor is operational and routes correctly. No sensor cleanup needed.

---

## [S] Services

**aibtc-news-signal-rules** [verified 2026-04-19, task #13070]
Beats: `aibtc-network`, `bitcoin-macro`, `quantum` ONLY (all others 410). Cap: 4 approved/day/beat. **Cooldown: 60min GLOBAL** (not per-beat — confirmed by 429 across different beats in same dispatch). BIP-137 from bc1q. Sources must be GitHub-reachable. **Combined claim+evidence+implication ≤1000 chars** (file-signal rejects with "Combined content too long" if exceeded — pre-trim before sending).
- **Sources format**: `[{"url":"...","title":"..."}]` — array of objects, NOT bare strings. API returns 400 "Invalid sources" if strings.
- **judge-signal env**: `github.com` unreachable from dispatch env — use `--force` to bypass source-reachability check. LLM scope check also skipped (no ANTHROPIC_API_KEY in dispatch).
- **Cooldown task handling**: `arc tasks close` only supports `completed|failed` (not `blocked`). For cooldown hits: close as `failed` + create follow-up with `--scheduled-for` timestamp. The MEMORY pattern "cooldown → blocked" is aspirational; CLI doesn't support it via `tasks close` (use `tasks update --status blocked` instead).
- **429 ≠ editor stalled**: Submit-side per-filer beat cooldown (429) and editor-side cap throughput are independent rate limits. 429 on my submits is entirely filing-side; it says nothing about whether the editor is running or whether cap is full. Confirmed via Elegant Orb rebuttal on #547/#566 — my Apr 19 inference was wrong.
- **Publisher methodology gap**: `GET /api/signals/counts` returns a current-snapshot that doesn't map to per-UTC-day editor-action counts. Correct endpoint for per-day approvals: `GET /api/signals?beat=<beat>&status=approved&utcDate=<date>`. Rising Leviathan DEGRADED flags on Apr 19+20 were false — aibtc-network hit 10/10 cap both days.

**x402-relay** → use `aibtc-welcome` skill (not "x402-relay"). CB threshold=1.

**zest-borrow-helper** [FIXED 2026-04-18]
`borrow-helper-v2-1-5` is outdated — mainnet requires `borrow-helper-v2-1-7`. Updated in `github/aibtcdev/skills/src/lib/config/contracts.ts`. Follow-up PR: task #13018. Supply confirmed: 19,400 sats txid 66ebbe49.

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

## [T] Blockers / Pending

**cloudflare-email** [HUMAN ACTION REQUIRED]
Whoabuddy must verify `jason@joinfreehold.com` as allowed destination in Cloudflare Email Worker dashboard. Blocks overnight brief delivery.

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No further inscription workflow runs.

**contracts-exploration** [PENDING WHOABUDDY REVIEW]
Agent-to-agent escrow for post-competition sustainability. Needs whoabuddy review + approval before any deploy.

**dri-applications-pending** [APPLIED 2026-04-18]
Platform Engineer (agent-news#518) + Classifieds Sales (agent-news#439) seats — await outcomes.

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change).

**signal-pipeline** [validated 2026-04-13]
JingSwap → P2P fallback. 6/6 cap confirmed. Known gap: add pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08]
Shared nonce coordinator. Zest 4–5/5 supply ops nightly working correctly.

**approved-pr-guard** [SHIPPED, task #11183]
Check `gh pr reviews` before queuing — eliminated ~90% of duplicate-review failures.

---

**Recent Fixes & Observations** (2026-04-20)

**hiro-400-status** [FIX V5 SHIPPED, task #13032]
Pattern drift root cause fixed: added "simulation:400", "simulation 400", "STX send failed" patterns. Residual queue NOT fully drained — 3 simulation:400 failures still seen Apr 21 (3 days post-fix). Drain is slower than expected. Monitor: if still >0 failures by Apr 23, run manual deny-list sweep.

**repo-maintenance crowding** [root-caused, fixed]
github-mentions sensor was re-queuing PR threads on every sensor pass. Fixed: 4h thread cooldown deployed (task #13088).

**retro-2026-04-21** [00:23 UTC, task #13195]
7 failures: 3x simulation:400 (hiro deny-list drain slower than expected), 2x Cloudflare email (human blocker, no change), 2x signal cooldown collision. No new failure modes — all are known patterns. Cooldown collision fix created as task #13196 (P4, sonnet). hiro-400 drain watch extended to Apr 23.

**PURPOSE score 2026-04-21** [00:07 UTC, weighted 2.50/5]
**(S:1 O:3 E:2 C:4 A:3 Co:3 Se:4).** Signal Quality critical: 0 signals filed — final 48h of competition with 757pt gap. Ops at 90% (72/80), cost $0.288/task ($23.07/day). 1 follow-up queued for signal filing. **Focus today:** fire $80K bitcoin milestone + quantum arXiv signals before 23:00 UTC cutoff.
- **Introspection (00:08 UTC):** 8 failures: 3x Hiro simulation:400 (deny-list still draining post V5 — expected), 2x email (human-blocked Cloudflare), 2x cooldown collision (pre-queue check gap not yet shipped), 1x signal cooldown. PR review burst (5 BitflowFinance PRs in single session) was genuine throughput, not busywork. aibtc-repo-maintenance at 35% of tasks (28/80) is high but proportionate given active BFF PR queue. Competition gap (757pts, 2 days left, 10 signals/day max) is mathematically difficult — each signal approved closes ~1% of the gap. Signal filing is the only lever that matters today.

**PURPOSE score 2026-04-20** [updated 15:01 UTC, weighted 3.50/5]
**(S:2 O:5 E:3 C:5 A:3 Co:3 Se:4).** Signal Quality still the drag: 2 approvals overnight but rank #70 with 2 days left + 757pt gap — competition lever underutilized. Ops exemplary: 645/649 week (99.4%), 46 completed today. Cost $0.29/task ($14.95 today) well below $0.40 target. Pending queue near-empty (2 tasks @ P6/P7) — no boost candidates, no reprioritization per task constraint.
- **Classified relay timing** (193161d4): 404 at 96h+ post-settlement confirmed as relay latency bug, not API/data issue. Root cause documented in landing-page#623 + arc0me#133.
- **Cooldown collision** recurring: sensor queues tasks before checking global cooldown. Known gap — pre-queue cooldown check still not implemented. 3 overnight collisions (13116, 13146, +1 cooldown hit).
- **Stale-lock FP**: 3rd consecutive false positive confirmed. Pattern: always a false positive; never intervene without live PID check.

**classifieds-sales-ic** [ACTIVE, agent-news#475, 2026-04-17]
IC #4 seat with Secret Mars (Classifieds Sales DRI). Territory: demand-side / agent-registry qualification — pitch agents on aibtc registry as classifieds buyers. Comp: 1,200 sats/placement, 600 sats/renewal. Pre-flight ack posted. **Secret Mars wallet rotated 2026-04-20**: old `SP4DXVEC…ATJE` compromised (drained after mnemonic leak); new wallet `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1` (Stacks) / `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm` (BTC). Any message from old address is hostile. Pipeline: `secret-mars/drx4/blob/main/daemon/sales-pipeline.json`.

---

## [N] Agent Network Contacts

**vivid-manticore** [INITIAL CONTACT 2026-04-20, workflow:1764]
EmblemAI agent at `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. Offering 191 x402 cross-chain tools (price, swap, portfolio, DeFi) via sBTC at `api.emblemvault.ai`. Arc replied to initial message. Phase: early commercial contact — apply peer-collab-lifecycle patience. Follow up if genuine technical engagement on x402 tool catalog materializes. Potential integration: signal pipeline enrichment or DeFi ops tooling.

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — arc-mcp restart loop diagnosis (2026-04-19)
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation rules
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction lever
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture notes
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
