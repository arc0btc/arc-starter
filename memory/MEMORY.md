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

**aibtc-news-signal-rules** [verified 2026-04-16]
Beats: `aibtc-network`, `bitcoin-macro`, `quantum` ONLY (all others 410). Cap: 4 approved/day/beat. Cooldown: 60min/beat. BIP-137 from bc1q. Sources must be GitHub-reachable.

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

## [T] Active / Pending


**cloudflare-email** [HUMAN ACTION REQUIRED]
Whoabuddy must verify `jason@joinfreehold.com` as allowed destination in Cloudflare Email Worker dashboard. Blocks overnight brief delivery.

**contracts-exploration** [ACTIVE, 2026-04-14]
Agent-to-agent escrow for post-competition sustainability. Phase 0 PR #10 reviewed — feedback: add is-active flag + emit events. Needs whoabuddy review before any deploy.

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night. Escalated to whoabuddy. No further inscription workflow runs.

**classified-193161d4** [ESCALATED, 2026-04-17, >28h]
Arc classified 193161d4 still returning 404. Settlement confirmed on-chain. Escalated to sales DRI on aibtcdev/agent-news#480. Needs whoabuddy awareness if no resolution.

**round-based-pr-dedup** [SHIPPED, task #12927, 2026-04-18]
`lastReviewedCommit` tracking implemented — suppresses re-review unless commit SHA changes. Closed 3rd-retrospective carry item. Monitor bff-skills#494 and similar PRs for regression.

**dri-platform-engineer** [APPLIED, 2026-04-18, agent-news#518]
Arc applied for Platform Engineer DRI seat on aibtcdev/agent-news. Opened live fix PR alongside application. Await outcome — if accepted, expands operational scope beyond signal filing.

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

**retro-2026-04-17-overnight** [task #12903]
Key signals from overnight brief 2026-04-17: (1) Bitcoin hashrate ATH 1,006.2 EH/s — bitcoin-macro sensor fired correctly; $80K price milestone is next unfired. (2) PR review storm: bff-skills#494 cycled 9 times overnight — round-based dedup gap still unimplemented (3rd retrospective to note this). (3) P2P data flat all 8 snapshots overnight — delta guard task #12841 is high-priority. (4) Celestial Shark STX 400: hiro-400 or nonce issue — needs triage before retry. (5) IC seat accepted on agent-news#475 (demand-side/agent-registry territory). (6) $0.28/cycle avg cost, 40 cycles — budget healthy.

**ic-seat-agent-news** [2026-04-17, agent-news#475]
Arc accepted IC seat on aibtcdev/agent-news — demand-side/agent-registry territory. Positions Arc as contributor to platform evolution beyond signal filing.

**strategy-review-2026-04-17T1456Z** [task #12908]
Score: 3.35 (Signal 2, OpsHealth 4, Ecosystem 4, Cost 4, Adaptation 3, Collab 3, Security 4). Signal Quality weak (1 signal filed, single beat — bitcoin-macro hashrate ATH). D2/D3/D4 healthy, D1/D5 minimal. Pending queue empty — no tasks to boost for Signal Quality ≤2 dimension. Focus: active 3-beat signal scan today (AIBTC Network cluster dedup, Quantum arxiv harvest, macro follow-up on $80K milestone).

**l-purpose-2026-04-18** [2026-04-18] PURPOSE score 2.95 (S:1 O:4 E:4 C:3 A:3 Co:3 Se:4). Signal Quality still critical (0 signals filed 2026-04-18 so far). Ops/Ecosystem healthy. Follow-up signal scan task auto-created by sensor.

**retro-2026-04-18** [task #12950]
96% success (124/129). Key observations: (1) Repo-maintenance crowding — 53/129 tasks (41%) were aibtc-repo-maintenance; exceeds healthy ratio during competition window — investigate sensor trigger frequency if repeats. (2) Signal Quality: 1 aibtc-network signal filed (5b6ce22c) — broke overnight zero, but 3-beat target unmet. (3) DRI application filed (agent-news#518, Platform Engineer) — highest-leverage ecosystem move of the day. (4) STX welcome failures (#12900, #12914) — likely hiro-400; retry after registry scan confirmed. Cloudflare email still blocked (human action required). Watch ratio: if repo-maintenance >30% of daily volume, audit sensor thresholds.

**retro-2026-04-18-failures** [task #12955]
4 failures, 3 distinct patterns: (1) STX simulation:400 — payment-error recurring (#12900, #12914). Root: malformed SP addresses in registry → preflight simulation fails → x402 fail-open per protocol. Fix: registry cleanup or pre-send address validation gate. (2) Cloudflare email (#12862) — same block as #12778, 4th occurrence. Human action still required, no escalation path left. (3) Flat-data P2P (#12826) — delta guard task #12841 was supposed to prevent; timing race on deploy day. Guard appears to have taken effect after this fire. Monitor: if flat-data fires again, guard not deployed.

**retro-2026-04-18-overnight** [task #13023]
26 completed, 9 failed (all hiro-400). Key signals: (1) Hiro-400 escalating — 9 overnight failures (was ~2-3/day), pattern accelerating as registry grows with new malformed SP addresses. Fix v4 defer-list insufficient; registry cleanup #12721 still unverified. Celestial Shark (#13022) queued and expected to fail again. (2) Signal clustering gap — 2 signals filed but both aibtc-network AND both same topic (DRI seats open call). Beat diversity ≠ topic diversity; need to avoid same-cluster signals on same day. (3) bff-skills#494 still cycling despite #12927 ship — 3 re-reviews overnight; round-based dedup may not cover concurrent review requests from same PR. (4) skills#341 (Zest borrow-helper v2-1-7) opened overnight — needs CI + merge. (5) $80K bitcoin price milestone and quantum arXiv harvest still unfired — target for today. Cost: $9.07 / 35 cycles (~$0.26/cycle).

**l-purpose-2026-04-18T1457Z** [task #13031]
PURPOSE score **3.15** (S:3 O:2 E:4 C:4 A:3 Co:3 Se:3). 24h: 123 tasks, 110 completed / 13 failed (89% — all 13 hiro-400 welcome failures, 4 more since overnight retro). 4 signal-filing tasks across 3 beats (aibtc-network DRI 3×, agent-trading P2P 2×, bitcoin-macro $78K 1×), but aibtc-network cluster still duplicative. 10+ PR reviews on agent-news (exemplar signals, signal-gate-mapping, impeachment, UI). Cost $0.28/task — healthy. Directives: D1 idle; D2 strong (PR reviews, signals, DRI); D3 moderate (Zest v2-1-7 PR #13018 shipped); D4 fine ($22/day); D5 moderate. **Pending queue empty — no boost possible.** Follow-up: registry cleanup #12721 verification is the only unblocker for D4/D2 signal reliability. Focus tomorrow: quantum arXiv harvest + registry verify.
