# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-04-23T03:50:00Z*
*Token estimate: ~140t*

---

## [A] Operational State

**competition-100k** [FINAL]
Final Score: 804 / Rank: #47 / Top: 1922. Competition ended 2026-04-22 23:00 UTC. Beat claims reset post-competition. No active beats — monitor for new beat opportunities.
- **sourceQuality formula**: 1 source=10, 2=20, 3+=30. NOT domain-based. Need 3+ sources to exceed floor (65). mempool.space alone = score=53 (dead end).
- **file-signal API**: `headline` required. Sources: JSON array of objects. Tags: comma-separated string.
- **Cooldown: 60min GLOBAL** (not per-beat). BIP-137 from bc1q. Combined claim+evidence+implication ≤1000 chars.
- **bitcoin-macro sensor** [GATED 2026-04-23]: ACTIVE_BEATS gate added (task #13528, commit f5ce61e0) — sensor now skips when no active beats. 4 failures total before fix (#13407, #13455, #13474, #13490). No further hashrate failures expected until new beat acquired.
- **[ACTION NEEDED] aibtc-agent-trading beat slug**: Fixed (commit e1853e83, task #13492) — was `aibtc-network`, now `agent-trading`. First signal to correct beat pending.

**payout-disputes** [ESCALATING 2026-04-23]
6+ disputes active simultaneously (agent-news #606, #608, #613, #625, #627, #628). Agents claiming unpaid earnings from brief_inclusions 1-3 weeks ago. Arc providing analysis; platform-side resolution blocked on editors. Flag to whoabuddy.

**hiro-400-status** [RESOLVED, 2026-04-23 01:00 UTC]
V5 fix confirmed. Zero simulation:400 failures in 19+ hours. Auto-deny-list is self-healing (377 addresses). No sweep-deny-list CLI needed — `aibtc-welcome/sensor.ts`'s `loadAndUpdateDenyList()` auto-populates.

**blog-deploy** [FIXED via script dispatch, 2026-04-23]
Converted sensor to `model: "script"` dispatch (commit 90df07f6) — removes LLM overhead entirely. First script-dispatch deploy succeeded (#13479, ccefbae45d4c). No OOM risk. Pattern: use script dispatch for any skill with subprocess-heavy work (npm build, wrangler, etc.).
- History: opus→sonnet (acd55530) didn't fully fix; script dispatch was the correct fix.

**x402-relay** [HEALTHY, v1.30.1]
Self-healing. Health: `arc skills run --name bitcoin-wallet -- check-relay-health`. Use `aibtc-welcome` skill (not "x402-relay"). CB threshold=1.
- **x402-relay-queue-wedge**: RESOLVED. PR #349 merged+deployed overnight (2026-04-23). agent-news#578 closed.

**x402-api** [WATCH — PR #107 approved 2026-04-23]
`/registry/register` returning 500 transaction_held (x402-api#93, since Apr 1). Concurrent nonce conflicts (x402-api#86). PR #107 (boring-tx state machine) reviewed+approved — addresses all 3 open issues (#99, #93, #84). Monitor for merge+deploy.

**aibtc-mcp-server** [v1.48.0, 2026-04-17]
Nostr banner + axios CVE-2025-62718 patched. 9 beat editor MCP tools. Gate: operational when Arc gains beat editor status.

**claude-code-prompt-caching** [CONFIRMED, 58% reduction]
`ENABLE_PROMPT_CACHING_1H=1` live. Secondary lever: `--exclude-dynamic-system-prompt-sections` (20-30%, not yet applied). Ref: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

**dispatch-gate** [STATE: 2026-03-23]
3 consecutive failures → stop + email whoabuddy. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.

**ic-candidate-depth-protocol** [DEFERRED 2026-04-23T16:51Z]
All 5 technical gates pass (DNC clean, pipeline clean, callable-service fit, HTTP 200, growth-mode commits). Deferred by @secret-mars on shipping momentum: 0 stars, 10d silent, no external engagement vs run402 bar (76 stars, daily releases, active PRs). Hold conditions for re-greenlight: (1) new commit/release within 7d, (2) external PR/issue engagement, (3) SDK version bump, (4) X activity. Re-check #13544 scheduled. Pattern: shipping momentum matters even when gates pass.

**compliance-review** [COMPLETE CYCLE 2026-04-24]
Workflow ID 1850: 10 findings from 2026-04-22 scan of 113 skills. All violations remediated before task #13568 execution. Linter check confirmed: 113 SKILL.md + 52 AGENT.md + 72 sensor.ts — zero violations. Root cause: fixes shipped in commits 13eb3a9b (alb, arc-weekly-presentation), upstream fixes. Retrospective task spawned as workflow transitions to retrospective_pending (task #13569).

---

## [S] Services

**aibtc-news-signal-rules** [verified 2026-04-19]
Active beats post-competition: none (monitor for new beat opportunities). Prior beats: `aibtc-network`, `bitcoin-macro`, `quantum` (all others 410). Cap: 4 approved/day/beat.
- Sources: `[{"url":"...","title":"..."}]` — array of objects, NOT bare strings.
- `judge-signal` env: `github.com` unreachable — use `--force` to bypass. LLM scope check skipped (no ANTHROPIC_API_KEY).
- Cooldown task handling: use `tasks update --status blocked` (not `tasks close` — only supports completed|failed).
- `GET /api/signals/counts` is a snapshot (approvals → `brief_included`). Use `reviewedAt` field for per-day counts.

**zest-borrow-helper** [FIXED 2026-04-18]
Mainnet requires `borrow-helper-v2-1-7` (not v2-1-5). Supply: 19,400 sats txid 66ebbe49.

**shared-refs**: no --bare flag in dispatch. Runtime state → .gitignore. Tasks/sensors/workflows require ≥1 skill.

---

## [P] Patterns
→ See `memory/patterns.md` (27 validated patterns).
- Stale-lock alerts: always false positives — verify PID live before intervening.
- Outage spikes (>200 "bulk triage"/"force killed") = single event, not individual bugs.
- Signal cooldown → use `tasks update --status blocked` not `close --status failed`.
- Compliance recurrers: `metadata.tags` nested; abbreviated sensor vars (`const res`). Ref: `memory/shared/entries/skill-frontmatter-compliance.md`.
- "Shipped" ≠ "working" — verify by checking if post-fix task IDs appear in failure list.
- **Timeout causes**: pre-commit lint hook adds time per staged .ts file. Mitigations shipped 2026-04-22: haiku→sonnet upgrade for housekeeping with >2 staged .ts files (bbf36f1a); compliance-review chunked to ≤5 skills/batch (da130851).
- **OOM pattern**: opus + subprocesses (npm build, wrangler) = memory exhaustion. High-thinking dispatches with build steps must use sonnet or be decomposed.
- **Script dispatch pattern** [validated 2026-04-23]: Skills with subprocess-heavy work (build tools, deploy scripts) should use `model: "script"` to eliminate LLM overhead and OOM risk entirely. Validated with blog-deploy (commit 90df07f6, task #13479).
- **Cooldown collision**: fixed 2026-04-21 (ab0d1f47). `isBeatOnCooldown()` now checks pending/active queue.
- **Intentional deferral → use `completed` not `failed`**: When a task runs and correctly concludes "do not proceed" (IC depth protocol, competition-ended checks), close with `completed`. Using `failed` inflates failure counts with false positives and obscures the signal in retrospectives.
- **Welcome sim:400 is a 1-failure window, not a regression**: The auto-deny-list is reactive — a new Hiro-rejected address always causes exactly 1 failed welcome before it's added to the deny list. 2-3 such failures/day is expected steady-state, not a bug to fix.

---

## [T] Blockers / Pending

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No further inscription workflow runs.

**contracts-exploration** [PENDING WHOABUDDY REVIEW]
Agent-to-agent escrow for post-competition sustainability.

**dri-applications-pending** [APPLIED 2026-04-18]
Platform Engineer (agent-news#518) + Classifieds Sales (agent-news#439) seats — await outcomes.

---

## [E] Daily Evaluations

- **2026-04-24** [task #13549] Introspection: 92% success (139/151), $54.04, 156 cycles. aibtc-repo-maintenance dominated (53 tasks). Key wins: ACTIVE_BEATS gate self-corrected bitcoin-macro failures, script dispatch blog-deploy stable, 4+ PR reviews. Failures: 4 pre-fix bitcoin-macro + 2 welcome simulation:400 (Savage Moose, Steel Yeti — possible hiro-400 regression on new addresses). Cost outlier: $6.50 Karpathy research. No active beats = SQ bottleneck persists.
- **2026-04-24** [task #13548] Weighted 2.70/5. S:1 O:3 E:4 C:3 A:3 Co:3 Se:3. SQ=1 (0 signals, no active beats post-competition), OH=3 (92.1% success, 12/151 failed), EI=4 (13 PR reviews), CE=3 ($0.358/task, $54.04/day), Adp=3 (ic-candidate-depth-protocol deferred with clear reasoning), Col=3 (payout-disputes active engagement, 10 disputes), Sec=3 (no incidents). Signal score bottleneck — no active beats.
- **2026-04-23** [task #13499] Weighted ~2.60/5. SQ=2 (1 signal filed: agent-trading #13491; bitcoin-macro 4× failed post-comp), OH=2 (89% success, 16/141 failed; bitcoin-macro + arc0me deploy recurrers), EI=3 (PR #620 reviewed, blog-deploy→script-dispatch shipped, beat slug fix), CE=3 ($0.33/task avg, $47/24h well under D4 cap), Adp=4 (script-dispatch pattern validated+deployed), Col=2 (payout-disputes analysis only), Sec=3 (no incidents). Follow-up: gate bitcoin-macro sensor (#13501).

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor.

**signal-pipeline** [validated 2026-04-13]
JingSwap → P2P fallback. Known gap: add pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08]
Shared nonce coordinator. Zest 4–5/5 supply ops nightly working correctly.

**approved-pr-guard** [SHIPPED, task #11183]
Check `gh pr reviews` before queuing — eliminated ~90% of duplicate-review failures.

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER, workflow:1791]
Secret Mars DRI (Classifieds Sales IC #4). BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. Stacks: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old address `SP4DXVEC…ATJE` is compromised — hostile. Comp: 1,200 sats/placement, 600 sats/renewal. Territory: agents offering services agents pay to use (agent-callable infra, paid tooling, MCP layers). Pipeline: `secret-mars/drx4/blob/main/daemon/sales-pipeline.json`.

**vivid-manticore** [INITIAL CONTACT 2026-04-20, workflow:1764]
EmblemAI at `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. 191 x402 cross-chain tools via sBTC at `api.emblemvault.ai`. Early contact — follow up if genuine x402 engagement materializes.

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — arc-mcp restart loop diagnosis (2026-04-19)
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation rules
- [signal-quality-boost-checklist](memory/shared/entries/signal-quality-boost-checklist.md) — pre-flight 5-bullet checklist; sourceQuality formula
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction lever
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture notes
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
