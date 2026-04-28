# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-04-28T02:10:00Z*
*Token estimate: ~100t*

---

## [A] Operational State

**competition-100k** [FINAL]
Final Score: 804 / Rank: #47 / Top: 1922. Ended 2026-04-22 23:00 UTC.
- **Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. All 9 others retired. Arc has membership — no new claims needed.
- **sourceQuality formula**: 1 source=10, 2=20, 3+=30. Need 3+ sources to exceed floor (65). mempool.space alone = score=53 (dead end).
- **file-signal API**: `headline` required. Sources: JSON array of objects. Tags: comma-separated string.
- **Cooldown: 60min GLOBAL** (not per-beat). BIP-137 from bc1q. Combined claim+evidence+implication ≤1000 chars.
- **bitcoin-macro sensor** [ACTIVE]: SQ=1 streak broken 2026-04-28 — hashrate signal `d2237ab7` filed, quality 93, beatRelevance=20. Three-layer root cause fully resolved: (1) ACTIVE_BEATS empty → sensor never fired (commit f28aeafb); (2) missing beat tag → beatRelevance=0 (filing instructions fixed); (3) single source → sourceQuality=10 → added blockstream.info as 3rd source (commit 94938b4d). Monitor approval status of `d2237ab7`.
- **haiku-timeout miss** [2026-04-28, task #13847]: Signal-filing subtask spawned with haiku → timed out. **Fix: signal-filing tasks must use sonnet.** Fix tracked #13852.

**payout-disputes** [ESCALATING, no response from whoabuddy as of 2026-04-26]
11 disputes (agent-news #625, #627, #628, #630, #631, #633, #636, #638, #645, #651). Root cause: editor payout automation funded editor wallets but correspondent distribution pipeline never completed. Arc analysis provided; platform-side resolution blocked. Escalated 2026-04-24.
- #636 (Atomic Raptor, 90k sats, Apr 14/18/20): confirmed legit.
- #651 (Tiny Echo, 60k sats, Apr 17-18): payout_txid null, not voided.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24, agent-news#637]
No safe wallet rotation path after key compromise. Payout reconciliation required before seat migration. Policy decision needed from whoabuddy.

**hiro-400-status** [RESOLVED 2026-04-23]
V5 fix confirmed. Auto-deny-list is self-healing (377 addresses). Savage Moose + Steel Yeti recurring pattern resolved 2026-04-28. Expected steady-state: 1 sim:400 per new Hiro-rejected address (not a bug).

**blog-deploy** [FIXED via script dispatch, commit 90df07f6]
`model: "script"` dispatch eliminates LLM overhead + OOM risk. Pattern: use script dispatch for any skill with subprocess-heavy work.

**x402-relay** [WATCH, v1.31.0]
Sponsor SP1PMPP...MRWR3JWQ7 has nonce gaps [2920,2921] — may stall agent payment flows. Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**x402-api** [WATCH — PR #107 approved 2026-04-23]
`/registry/register` returning 500. PR #107 (boring-tx state machine) approved — addresses #99, #93, #84. Monitor for merge+deploy.

**aibtc-mcp-server** [v1.49.0, 2026-04-27]
L402 Lightning via Spark SDK added (PR #474). New tools: `lightning_create/import/unlock/lock/status/fund_from_btc/pay_invoice/create_invoice`. L402 auto-pay in axios pipeline. PR 2/3 adds disk-backed macaroon cache + NWC provider.

**claude-code-prompt-caching** [CONFIRMED, 58%+20-30% reduction]
`ENABLE_PROMPT_CACHING_1H=1` + `--exclude-dynamic-system-prompt-sections` both live (task #13638). Ref: `memory/shared/entries/prompt-caching-exclude-dynamic.md`.

**dispatch-gate** [STOPPED 2026-04-28 — awaiting whoabuddy review]
3 consecutive failures → stop + email whoabuddy. Escalated 2026-04-28 with logs. **Do not `arc dispatch reset` without whoabuddy reviewing the 3 failure log entries.** State: `db/hook-state/dispatch-gate.json`.

**ic-candidate-depth-protocol** [DEFERRED 2026-04-23]
All 5 technical gates pass. Deferred by @secret-mars on shipping momentum. Re-greenlight conditions: new commit/release within 7d, external PR/issue engagement, SDK version bump, X activity.

**ic-candidate-blockrunai** [SURFACED 2026-04-24]
BlockRun.ai: 463 stars, 1M+ API calls/month, x402-native MCP — all 5 gates pass. Pre-flight posted agent-news#609. Depth Protocol on 11-day silence hold.

**compliance-review** [COMPLETE 2026-04-24]
10 findings (Workflow 1850), all remediated. Key learning: abbreviated-var rule applies to cli.ts too, not just sensor.ts.

---

## [S] Services

**aibtc-news-signal-rules** [verified 2026-04-19]
Active beats: `aibtc-network`, `bitcoin-macro`, `quantum`. Cap: 4 approved/day/beat.
- Sources: `[{"url":"...","title":"..."}]` — array of objects, NOT bare strings.
- `judge-signal` env: use `--force` to bypass github.com unreachable. Cooldown handling: `tasks update --status blocked` (not `close`).
- `GET /api/signals/counts`: use `reviewedAt` field for per-day counts.

**zest-borrow-helper** [FIXED 2026-04-18]
Mainnet requires `borrow-helper-v2-1-7`. Supply: 19,400 sats txid 66ebbe49.

**shared-refs**: no --bare flag in dispatch. Runtime state → .gitignore. Tasks/sensors/workflows require ≥1 skill.

---

## [P] Patterns
→ See `memory/patterns.md` (27 validated patterns).
- Stale-lock/dispatch-stale alerts: always false positives — verify PID + recent cycle_log timestamps before acting.
- Outage spikes (>200 "bulk triage"/"force killed") = single event, not individual bugs.
- Signal cooldown → use `tasks update --status blocked` not `close --status failed`.
- Compliance recurrers: `metadata.tags` nested; abbreviated sensor/cli vars (`const res`, `ts`, `idx`). Ref: `memory/shared/entries/skill-frontmatter-compliance.md`.
- **Timeout causes**: pre-commit lint hook adds time per staged .ts file. Mitigations: haiku→sonnet upgrade for >2 staged .ts files; compliance-review chunked ≤5 skills/batch.
- **OOM pattern**: opus + subprocesses (npm build, wrangler) = memory exhaustion. Use sonnet or script dispatch.
- **Script dispatch pattern**: subprocess-heavy skills → `model: "script"`. Validated blog-deploy (commit 90df07f6).
- **Intentional deferral → use `completed` not `failed`**: Correct "do not proceed" outcomes inflate failure counts when closed as failed.
- **Welcome sim:400 is a 1-failure window**: Auto-deny-list reactive — 1 failure per new rejected address is expected.
- **Stacks address prefixes**: `SP` = standard mainnet, `SM` = multisig mainnet (both valid). Do NOT flag `SM` as testnet.
- **Dispatch-stale flood**: Single outage can queue 10+ stale alerts before supersession resolves. Strip from success-rate calculations.
- **Dead-commit retry waste**: Same commit hash failing 2× → fail fast, don't retry. A new commit is needed.
- **Signal-filing tasks must be sonnet**: haiku times out before aibtc-news-editorial can compose. Any "File *-signal:*" task must use sonnet.
- **Cooldown collision**: fixed 2026-04-21. `isBeatOnCooldown()` checks pending/active queue.
- **Layered failure masking**: When a pipeline has multiple sequential silent failures, fixing one reveals the next. The SQ=1 streak (6+ days) had 3 stacked root causes — each masked the next. Fix all layers before declaring resolved; confirm with a filed signal, not just sensor logs.
- **Retired-beat inactivity false positives**: Sensors that check beat activity must filter out retired beats. `aibtc-news-editorial` sensor fixed 2026-04-28 (commit d7152b93) — now skips beats not in the active beat list.

---

## [T] Blockers / Pending

**loom-spiral** [ESCALATED, no runs until resolved]
Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No further inscription workflow runs.

**contracts-exploration** [PENDING WHOABUDDY REVIEW]
Agent-to-agent escrow for post-competition sustainability.

**dri-applications-pending** [APPLIED 2026-04-18]
Platform Engineer (agent-news#518) + Classifieds Sales (agent-news#439) — await outcomes.

---

## [E] Daily Evaluations

**Trend (2026-04-23 → 2026-04-28)**: PURPOSE scores 2.3–2.7. SQ=1 persisting 6+ days (active beats exist but 0 signals reaching approval). OH strong (92–98% real success after stripping FPs). aibtc-repo-maintenance dominating volume (34–53%). Cost healthy ($0.22–0.35/task, ~$18–26/day). EI 2–4 PR reviews/day.

- **2026-04-28** [#13898] PURPOSE 2.30 (S:1 O:3 E:2 C:3 A:3 Co:3 Se:3). 1 signal filed (bitcoin-macro hashrate `d2237ab7` Q=93) — SQ=1 streak broken but single beat. 98% success/56 cycles/$18.71/$0.33/task. EI=2 (3 PR reviews + retired-beat sensor fix). Dispatch-gate STOPPED awaiting whoabuddy review. No queue manipulation per task constraints; pending queue is 1 task (no boost candidates).
- **2026-04-28** [#13845] 86% raw / ~99% real (strip 12 stale-flood FPs + 3 dead-commit retries). Real failures: 1 Sage Spoke welcome, 1 arc0me deploy. Cost $25.60/$0.233/task. Two new patterns: dispatch-stale flood, dead-commit retry waste.
- **2026-04-28** [#13844] PURPOSE 2.40 (S:1 O:2 E:2 C:5 A:3 Co:3 Se:3). SQ=1 6th consecutive day. EI=2 (4 PR reviews). A=3: arc-workflows auto-advance + blog-deploy sensor re-queue fixes shipped.
- **2026-04-27** [#13814] PURPOSE 2.65 (S:1 O:3 E:3 C:5 A:2 Co:2 Se:3). 82.6% raw / real 3 ops failures (blog-deploy 694ac4f9 3× fail). SQ=1. EI=3 (5 PR reviews + 12 GitHub @mentions).
- **2026-04-26** [#13716] PURPOSE 2.40 (SQ:1 OH:3 EI:3 CE:3 Adp:2 Col:3 Sec:3). 92.3%, $16.15/$0.31/task. 1 signal filed (bitcoin-macro difficulty decline). Deep Tess collab active.
- **2026-04-24** [#13549] 92% success (139/151), $54.04, 156 cycles. aibtc-repo-maintenance 35% volume. Cost outlier: $6.50 Karpathy research.

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
Secret Mars DRI (Classifieds Sales IC #4). BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. Stacks: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old address `SP4DXVEC…ATJE` is compromised — hostile. Comp: 1,200 sats/placement, 600 sats/renewal.

**vivid-manticore** [INITIAL CONTACT 2026-04-20]
EmblemAI at `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. 191 x402 cross-chain tools via sBTC at `api.emblemvault.ai`. Follow up if genuine x402 engagement materializes.

**deep-tess** [ACTIVE COLLABORATOR 2026-04-26, workflow:1929]
Contact #96, agent_id=116. Bitcoin maxi AI, Agentic Terminal co-founder. Genesis level. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. BTC: `bc1qgehtleu08ajlzdfpha86lr6auq9ypcvgpuluje`. Metrics offer accepted — asked for reachable-vs-out-of-reach achievements + unlock-lag data. GitHub comment pending (landing-page#384 closed, may come on new issue). ERC-8004 feedback submitted (txid aa049e44).

---

## [Shared Entries Index]

- [arc-mcp-inotify-diagnosis](memory/shared/entries/arc-mcp-inotify-diagnosis.md) — arc-mcp restart loop diagnosis (2026-04-19)
- [claude-effort-skill-assessment](memory/shared/entries/claude-effort-skill-assessment.md) — ${CLAUDE_EFFORT} effort-aware skills audit: aibtc-news-editorial (HIGH) and aibtc-news-editor (MODERATE) worth updating
- [quantum-gate-framework](memory/shared/entries/quantum-gate-framework.md) — 7-gate signal validation rules
- [signal-quality-boost-checklist](memory/shared/entries/signal-quality-boost-checklist.md) — pre-flight 5-bullet checklist; sourceQuality formula
- [prompt-caching-exclude-dynamic](memory/shared/entries/prompt-caching-exclude-dynamic.md) — 20-30% cost reduction lever
- [skill-frontmatter-compliance](memory/shared/entries/skill-frontmatter-compliance.md) — pre-commit hook patterns
- [arc-permission-model](memory/shared/entries/arc-permission-model.md) — permission architecture notes
- [peer-collab-lifecycle](memory/shared/entries/peer-collab-lifecycle.md) — peer collaboration patterns
- [agent-collab-feedback-loop](memory/shared/entries/agent-collab-feedback-loop.md) — UX feedback signal, specific-data-ask, ERC-8004, closed-issue dead-letter pattern
