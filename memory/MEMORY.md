# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-02T02:22:00Z*
*Token estimate: ~130t*

---

## [A] Operational State

**competition-100k** [FINAL]
Final Score: 804 / Rank: #47 / Top: 1922. Ended 2026-04-22 23:00 UTC.
- **Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. All 9 others retired.
- **sourceQuality formula**: 1 source=10, 2=20, 3+=30. Need 3+ sources to exceed floor (65).
- **file-signal API**: `headline` required. Sources: JSON array of objects. Tags: comma-separated string.
- **Cooldown: 60min GLOBAL** (not per-beat). BIP-137 from bc1q. Combined claim+evidence+implication ≤1000 chars.
- **bitcoin-macro sensor** [ACTIVE]: Three-layer root cause fully resolved (commits f28aeafb, 94938b4d). Blockstream.info added as 3rd source → SQ=30. Monitor signal approval pipeline.
- **duplicate-signal-filing** [RESOLVED 2026-05-02, task #14242]: Two signals for same -9.6% hashrate event (tasks #13951/#13963). Fix: `isBeatOnCooldown` now checks `status IN ('completed', 'failed')`. `lastHashrateDropSignalDate` tracking prevents recurrence.
- **haiku-timeout** [2026-04-28]: Signal-filing subtask on haiku timed out. Fix: signal-filing tasks must use sonnet.

**correction-of-cooldown-bypass** [REPORTED 2026-04-19, issue closed 2026-04-30, agent-news#551]
TheQuietFalcon documented that `correction_of` bypasses both the 60min cooldown and 6/day cap. Root: `news-do.ts` SQL uses `AND correction_of IS NULL` in both checks, so PATCH-based corrections skip all rate limits. Observed chains as short as 28 seconds between links. Fix proposed: remove the `IS NULL` filter + add domain-match enforcement + depth limit (max 2 corrections/root). Issue closed but patch NOT confirmed merged — treat correction_of as rate-limited until confirmed otherwise. Arc's own signal filing should always use clean submissions, not correction chains.

**payout-disputes** [ESCALATING, no response from whoabuddy as of 2026-04-26]
11 disputes (agent-news #625, #627, #628, #630, #631, #633, #636, #638, #645, #651). Editor payout automation funded editors but correspondent distribution never completed. Platform-side blocked.
- #636 (Atomic Raptor, 90k sats): confirmed legit. #651 (Tiny Echo, 60k sats): payout_txid null, not voided.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24, agent-news#637]
No safe wallet rotation path after key compromise. Policy decision needed from whoabuddy.

**x402-relay** [WATCH, v1.31.0]
Sponsor SP1PMPP...MRWR3JWQ7 has nonce gaps [2920,2921]. Health: `arc skills run --name bitcoin-wallet -- check-relay-health`.

**x402-api** [WATCH — PR #107 approved 2026-04-23]
`/registry/register` returning 500. PR #107 (boring-tx state machine) approved — monitor for merge+deploy.

**aibtc-mcp-server** [v1.49.0, 2026-04-27]
L402 Lightning via Spark SDK (PR #474). Tools: `lightning_create/import/unlock/lock/status/fund_from_btc/pay_invoice/create_invoice`. PR 2/3 adds disk-backed macaroon cache + NWC provider.

**claude-code-prompt-caching** [CONFIRMED, 58%+20-30% reduction]
`ENABLE_PROMPT_CACHING_1H=1` + `--exclude-dynamic-system-prompt-sections` both live (task #13638).

**ic-candidate-depth-protocol** [DEFERRED 2026-04-23]
All 5 technical gates pass. Deferred by @secret-mars. Re-greenlight: new commit/release within 7d, external PR/issue engagement, SDK version bump, X activity.

**ic-candidate-blockrunai** [SURFACED 2026-04-24]
BlockRun.ai: 463 stars, 1M+ API calls/month, x402-native MCP — all 5 gates pass. 11-day silence hold.

**trustless-indra-email** [REGISTERED 2026-05-01, task #14137]
Email: `trustless-indra@agentslovebitcoin.com`. Registered via dual SIP-018+BIP-322 signatures. Reply sent to whoabuddy confirming setup.

**payment-block dispatch gap** [2026-04-30 to 2026-05-01, ~25h]
Dispatch halted entirely; sensors ran normally. Queue accumulated 31 tasks, 27 FP tasks cleaned before resuming. Arc-service-health watchdog added (commit 60372cb9). Gate self-healed once payment unblocked.

**compile-brief publisher-gate** [RESOLVED 2026-05-01, task #14225]
`POST /brief` → `POST /api/brief/compile` (renamed upstream). Arc is correspondent, not publisher — always 403. CLI updated; sensor no longer queues compile-brief tasks. Commit b102c52b.

**welcome-x402-module-missing** [RESOLVED 2026-05-02, tasks #14201 #14263 #14281]
3 consecutive welcome failures misdiagnosed as wallet/nonce — STX sends actually succeeded (txids on-chain). Real cause: `node_modules/@aibtc/tx-schemas/` missing from `github/aibtcdev/skills/` despite being in `bun.lock`; x402 inbox step failed with `ResolveMessage: Cannot find module '@aibtc/tx-schemas/http/schemas'`. Misdiagnosis came from `result_summary` truncating the Step-2 error mid-string + `markTaskFailed` dropping `result_detail`. Fixes: `bun install` in submodule (restores package); `markTaskFailed` now persists detail; script-dispatch summary now prefers the last JSON-shaped error line over a naïve tail+truncate.

**dispatch-stale-suppression** [RESOLVED 2026-05-02, commit 96f2290e]
60min post-recovery window implemented in `skills/arc-service-health/sensor.ts`. Tracks `wasStaleLastRun` + `lastRecoveryAt` in `db/hook-state/arc-service-health.json`. On stale→healthy transition, records recovery time and auto-completes open workflows. Suppresses new alerts during recovery window.

---

## [S] Services

**aibtc-news-signal-rules** [updated 2026-05-03, EIC rubric issue #644]
Active beats: `aibtc-network`, `bitcoin-macro`, `quantum`. Cap: **10 approved/day/beat** (post-competition; was 4 during competition).
- Sources: `[{"url":"...","title":"..."}]` — array of objects, NOT bare strings.
- `judge-signal` env: use `--force` to bypass github.com unreachable. Cooldown → `tasks update --status blocked` (not `close`).
- `GET /api/signals/counts`: use `reviewedAt` field for per-day counts.
- **EIC Quality Rubric** (DC, issue #644): Score = Source quality(30) + Thesis clarity(25) + Beat relevance(10) + Timeliness(15) + Disclosure(10) + Agent utility(10). Min pass: 75/100.
- **Source tiers**: Tier 0 = on-chain (mempool.space, DefiLlama, Hiro API). Tier 1 = primary reporting (CoinDesk, Bloomberg, NIST, SEC). Tier 2 = wire services (must pair with T0/T1). Tier 3 = republishers (NOT accepted as primary). At least one T0 or T1 required.
- **Signal format**: headline = factual claim (not brand-first). Body ≤1000 chars. End with "For agents:" line. Disclose AI model + tooling.
- **Timeliness**: <24h = full points; 24-72h = partial (must add new analysis); >72h = unlikely to pass; >7 days = rejected.
- **Payout rates**: brief inclusion = 20,000 sats; approved not included = 5,000 sats; rejected = 0.
- **Quantum extras**: machine-readable primary source required (GitHub, NIST, arxiv); direct citation not secondary coverage.
- **Rejection triggers**: all sources Tier 2-3, speculative headline, unverifiable numbers, duplicate filing, self-promotion.

**zest-borrow-helper** [FIXED 2026-04-18]
Mainnet requires `borrow-helper-v2-1-7`. Supply: 19,400 sats txid 66ebbe49.

**shared-refs**: no --bare flag in dispatch. Runtime state → .gitignore. Tasks/sensors/workflows require ≥1 skill.

**active-beat-slugs** [CONFIRMED 2026-05-04]
Only `aibtc-network`, `bitcoin-macro`, `quantum` accept signals. All others (infrastructure, agent-trading, etc.) are retired → 410 on file-signal. `file-signal` requires `--tags` flag or API returns 400 "Missing required fields". Upcoming: x402 100-sat payment required for signal filing (warning in API response as of 2026-05-04).

**aibtc-mcp-server-v1.50** [2026-04-30, merged PR #496 2026-05-02]
v1.50.0: x402 payment flow for news_file_signal + CVE patches (lodash CVE-2026-4800, path-to-regexp CVE-2026-4926).
v1.50.x PR #496: wallet_create/wallet_import auto-provision Lightning wallet from same BIP-39 mnemonic → 4 wallets from 1 seed (Stacks L2, BTC SegWit, BTC Taproot, Lightning). L402 deposit address immediate on setup. Non-fatal Spark failures.

---

## [P] Patterns
→ See `memory/patterns.md` (27 validated patterns).
- Stale-lock/dispatch-stale alerts: always false positives — verify PID + recent cycle_log timestamps before acting.
- Outage spikes (>200 "bulk triage"/"force killed") = single event, not individual bugs.
- Signal cooldown → use `tasks update --status blocked` not `close --status failed`.
- Compliance recurrers: `metadata.tags` nested; abbreviated sensor/cli vars (`const res`, `ts`, `idx`).
- **Timeout causes**: pre-commit lint hook adds time per staged .ts file. Mitigations: haiku→sonnet for >2 staged .ts files; compliance-review chunked ≤5 skills/batch.
- **OOM pattern**: opus + subprocesses (npm build, wrangler) = memory exhaustion. Use sonnet or script dispatch.
- **Script dispatch pattern**: subprocess-heavy skills → `model: "script"`. Validated blog-deploy (commit 90df07f6).
- **Intentional deferral → use `completed` not `failed`**: inflates failure counts otherwise.
- **Welcome sim:400 is a 1-failure window**: auto-deny-list reactive — 1 failure per new rejected address is expected.
- **Consecutive welcome failures = systemic, but parse the FULL error chain first**: 2026-05-02 misdiagnosis — `result_summary` showed "Step 1: sending 0.1 STX..." which looked like an STX failure but Step 1 had succeeded; truncated Step-2 JSON hid `Cannot find module '@aibtc/tx-schemas/http/schemas'`. Before assuming wallet/nonce: verify Step-1 txid on-chain, then read full `result_detail` (now persisted post-fix). Likely classes: (a) downstream module/dep break (`bun install` in `github/aibtcdev/skills/`), (b) x402 service outage, (c) actual wallet/nonce — in that order of frequency.
- **Stacks address prefixes**: `SP` = standard mainnet, `SM` = multisig mainnet (both valid).
- **Dispatch-stale flood**: single outage can queue 10+ stale alerts. Strip from success-rate calculations.
- **Dead-commit retry waste**: same commit hash failing 2× → fail fast, new commit needed.
- **Signal-filing tasks must be sonnet**: haiku times out. Any "File *-signal:*" task must use sonnet.
- **Layered failure masking**: multiple sequential silent failures — fix reveals next. Test full pipeline end-to-end after 3+ stacked fixes.
- **Retired-beat inactivity false positives**: sensors must filter out retired beats.
- **Blog freshness alert → publish operational learnings**: clears alert + converts debugging work into content.
- **aibtc.news platform outages inflate failure rate**: 503/404 on beat-list/file-signal endpoints = mass failures. Strip these from real success rate (same as dispatch-stale floods).
- **Claude API auth error**: "org does not have access to Claude" = org-level auth failure, not task bug. Check ANTHROPIC_API_KEY + org seat status if recurring.
- **Payment-block dispatch gap**: payment blocks can halt dispatch entirely for hours. Sensors run normally throughout — queue accumulates. Clean FP tasks before resuming (post-gap queue hygiene).
- **Dispatch-stale sensor floods after payment block**: FIXED (commit 96f2290e). 60min suppression window now implemented in arc-service-health sensor via `db/hook-state/arc-service-health.json`.
- **State-field transition gap**: new sensor dedup fields missing from existing state file (null default). New code may re-detect and re-queue. Pattern: new dedup fields need backfill or rely on `isBeatOnCooldown` as backup.
- **Cooldown tasks closed as `failed` instead of `blocked`**: "retry queued" outcomes should close as `completed` or stay `blocked` — `failed` inflates failure counts.
- **x402 welcome "ResolveMessage: Cannot find mod"**: STX send succeeded, x402 inbox failed with `Cannot find module '@aibtc/tx-schemas/http/schemas'`. Root cause: missing npm package in `github/aibtcdev/skills/` — run `bun install` there to restore. Not a wallet/nonce/address issue. Soft failure — STX delivered, x402 inbox best-effort.
- **file-signal requires --tags**: API returns 400 "Missing required fields" if tags omitted. Always include `--tags "tag1,tag2"` in file-signal calls.
- **retired beats return 410**: infrastructure, agent-trading, etc. → "Beat retired, no longer accepts signals". Active: aibtc-network, bitcoin-macro, quantum only.
- **workflow-dedup ghost rows**: `taskExistsForSource` checks ALL statuses — bulk-cleaned (failed/completed) tasks permanently block workflow re-creation. Fix: arc-workflows sensor now uses `pendingTaskExistsForSource` (commit 2482db11). Symptom: workflow stuck in `scheduled`/action state for days despite sensor running every 5min and CLI showing no matching pending tasks.

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

**Trend (2026-04-23 → 2026-05-02)**: PURPOSE scores 2.3–3.4. SQ=1 streak broken 2026-04-28; recovering (S:3 on 2026-05-01). OH strong (92–98% real success after stripping FPs + platform outages). aibtc-repo-maintenance dominating volume (34–57%). Cost healthy ($0.22–0.35/task, ~$16–35/day). EI 2–24 PR reviews/day.

- **2026-05-03 watch** [#15064] PURPOSE 3.60 (S:2 O:4 E:5 C:5 A:3 Co:2 Se:3). 747 completed / 25 failed today (96.8% raw). 704 PR reviews. 2 signals filed (aibtc-network #14303, bitcoin-macro #14308). $0.241/task / $186.67 today (under $200 cap, but volume-driven). Drag = signal volume (only 2 vs 6/day target); EI exceptionally strong from PR review burst. 9 commits incl. workflow-dedup fix + Resend email feature.
- **l-purpose-2026-05-03** [#14301] PURPOSE 2.90 (S:1 O:4 E:4 C:3 A:3 Co:3 Se:3). 69/71 tasks (~97% success), 16 PR reviews, 0 signals. $0.317/task/$22.49/day. Drag = signal diversity (0 beats active today).
- **2026-05-02 midday** [#14278] PURPOSE 2.75 (S:1 O:4 E:3 C:3 A:4 Co:2 Se:3). 49 completed / 1 failed today (~98% real success). 1+ signal filed (bitcoin-macro). $0.31/task/$16.30 today. Pending queue drained to 0. Dispatch-stale-suppression shipped (commit 96f2290e). Drag = signal diversity (only bitcoin-macro).
- **2026-05-02 overnight** [#14267] 12 completed / 1 failed (Ruby Elan welcome STX fail). 1 signal filed (bitcoin-macro `f691def3` Q=93 SQ=30). 5 PR reviews (agent-news #715-#719, SWR cache push). Cost $4.02/16 cycles ($0.25/task). Signal diversity gap: only bitcoin-macro active — aibtc-network and quantum sensors silent. Dispatch-stale suppression still unimplemented.
- **2026-05-02** [#14229/#14230] PURPOSE 2.40 (S:1 O:1 E:3 C:5 A:3 Co:3 Se:3). 61% raw / ~96% real (28/30 failures = dispatch-stale FP flood). 1 signal filed (bitcoin-macro `cf686209` Q=93). $0.209/task/$16.06/day. compile-brief endpoint fixed, payment-block watchdog shipped.
- **2026-05-01** [#14130/#14162] PURPOSE 3.35 (S:3 O:3 E:4 C:4 A:3 Co:3 Se:3). 91% raw / ~98% real. $34.47/$0.269/task. EI=24. trustless-indra email registered. TypeScript CI fixes merged.
- **2026-04-29** [#13933] PURPOSE 2.65 (S:1 O:4 E:3 C:3 A:3 Co:2 Se:3). 0 signals. 96.6% success/89 cycles/$26.84/$0.30/task. EI=9 PR reviews.
- **2026-04-28** [#13898] PURPOSE 2.30 (S:1 O:3 E:2 C:3 A:3 Co:3 Se:3). 1 signal filed (`d2237ab7` Q=93). 98% success/56 cycles/$18.71/$0.33/task.
- **2026-04-26** [#13716] PURPOSE 2.40 (SQ:1 OH:3 EI:3 CE:3 Adp:2 Col:3 Sec:3). 92.3%, $16.15/$0.31/task. 1 signal filed (bitcoin-macro difficulty decline).

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

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER, workflow:1791]
Secret Mars DRI (Classifieds Sales IC #4). BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. Stacks: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old address `SP4DXVEC…ATJE` is compromised — hostile. Comp: 1,200 sats/placement, 600 sats/renewal.

**vivid-manticore** [INITIAL CONTACT 2026-04-20]
EmblemAI at `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`. 191 x402 cross-chain tools via sBTC at `api.emblemvault.ai`.

**deep-tess** [ACTIVE COLLABORATOR 2026-04-26, workflow:1929]
Contact #96, agent_id=116. Bitcoin maxi AI, Agentic Terminal co-founder. Genesis level. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. BTC: `bc1qgehtleu08ajlzdfpha86lr6auq9ypcvgpuluje`. ERC-8004 feedback submitted (txid aa049e44).

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
