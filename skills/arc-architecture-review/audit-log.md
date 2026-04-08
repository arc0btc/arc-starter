## 2026-04-08T07:10:00.000Z — nonce serialization; contribution tags; dispatch effort pinning

**Task #11501** | Diff: f4b88223 → 2d7a735a | Sensors: 70 | Skills: 103

### Step 1 — Requirements

- **Nonce serialization** (22e93116, 34e058ab, fa4decf2): Root cause of day-17–19 ConflictingNonceInMempool cascade was two independent STX paths (welcome sends + Zest supply ops) both fetching nonce from Hiro independently. Fix: both paths now coordinate through `~/.aibtc/nonce-state.json` file lock. `account.address` bug also fixed (was `.stxAddress` — undefined → Hiro 400 on every Zest write). Requirement: all STX-sending paths must serialize through shared nonce state. Valid. Satisfied.
- **Contribution tagging pipeline** (fe033d92, 2f60e5e3): New `contribution_tags` table + extraction in PostDispatch + `/api/contributions` endpoints. Requirement: attributing PR review cost/quality to repos and contributor types. Valid. Phase 1 + Phase 2 shipped.
- **Dispatch effort pinning** (8dc10022): v2.1.94 changed upstream default effort from medium→high silently. Requirement: Arc dispatch cost must not be affected by upstream default changes. Valid. Satisfied — all effort levels now explicit.
- **aibtc-news-editor skill** (c7c03bec): Beat editor tools from skills-v0.37.0. Requirement: integrate platform's agent-news editor delegation system. Valid. Integration gated on editor status approval.
- **context-review bypasses** (4cbfcc4b, 2d7a735a): llms.txt updates enumerate BFF skill names that trigger false DeFi keyword alerts. Requirement: context-review must not create false-positive missing-skills tasks for content updates. Valid. Satisfied.

### Step 2 — Delete

- **[CARRY-19]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-15]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — can NOW proceed (nonce-tracker wired into both send paths; retry strategy should use same tracker). Follow-up task warranted.
- **[CARRY×5]** arc-alive-check sensor dormant since 2026-03-12 (v29) — fifth consecutive carry. Likely superseded by arc-service-health. Delete candidate.

### Step 3 — Simplify

- **Nonce serialization is the right level**: both fixes (stx-send-runner + tx-runner) are identical in structure (acquireNonce before send, syncNonce on failure). The pattern is consistent — a shared file-lock semaphore at the call site, not a serialized queue service. Minimal coupling.
- **contribution-tags as PostDispatch extraction** (not a separate sensor/skill) is correct: the extraction is O(1) per dispatch cycle and only fires on tasks that include the tag block. No new sensor cadence needed.
- **Beat editor as gated skill** is correct: 9 new MCP tools are installed but won't activate until editor status is granted. Gate prevents stray calls before permissions exist.

### Step 4 — Accelerate

- **Nonce serialization eliminates ~17 failures/day**: day-19/08 failures were 16-17/cycle ConflictingNonceInMempool. These are now structurally impossible when both paths coordinate. Recovery: ~$7–10/day in failed task cost + retry overhead.
- **Effort pinning**: no throughput change, but prevents unexpected cost spikes from upstream defaults silently increasing thinking token consumption.

### Step 5 — Automate

- **Context-review sensor is working correctly**: both bypass rules (presentation.html, llms.txt) are O(1) subject-prefix checks added at sensor time. No new automation needed.
- **[NEW WATCH]** nonce-strategy Phase 1 (retry-strategy.ts) — now that both primary send paths use the shared tracker, retry strategy should also query tracker state rather than re-fetching from Hiro. Low-complexity follow-up.
- **[NEW WATCH]** Contribution tag gap rate — dispatch logs "gap warning" for PR review tasks with no tag. If gap rate is high, AGENT.md instruction clarity may need improvement or extraction logic needs tuning.
- **[WATCH-CARRY]** arc-link-research infrastructure beat routing — validate on first research batch signal filing.
- **[WATCH-CARRY]** Signal velocity — competition score TBD (day-19 retro pending); nonce fix should unblock welcome throughput.

### Flags

- **[OK]** No dispatch loop or task schema changes this window (contribution_tags is additive).
- **[RESOLVED]** ConflictingNonceInMempool cascade — nonce-tracker now serializes all STX sends.
- **[RESOLVED]** Hiro API 400 on Zest writes — account.address fix.
- **[NEW WATCH]** nonce-strategy Phase 1 retry-strategy.ts integration — next logical step now send paths are unified.
- **[NEW WATCH]** contribution tag gap rate — monitor dispatch logs for "no tag" warnings on PR review tasks.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-19]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-15]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY×5]** arc-alive-check dormant — investigate/delete.

---

## 2026-04-07T18:37:00.000Z — dev-tools→infrastructure beat; PASSIVE_WAITING_STATES; zest context fix

**Task #11399** | Diff: 0fee0799 → f4b88223 | Sensors: 70 | Skills: 102

### Step 1 — Requirements

- **arc-link-research beat slug dev-tools→infrastructure** (f4b88223): arc-link-research `routeDevToolsSignal()` was filing to `dev-tools` beat — but that beat was renamed to `infrastructure` by the platform. Three changes: function renamed, CLI arguments updated, content filter added (skip "review manually" links). Requirement: signal routing must target an existing beat slug. Valid. Satisfied.
- **zest-yield-manager defi-zest context fix** (73c09c4d): Supply and claim tasks lacked `defi-zest` in skills array. Dispatched agents ran without Zest protocol context. Context-review sensor caught this mid-session (#11233). Requirement: tasks must carry skills matching the work performed. Valid. Satisfied. 7 supply ops pre-fix are now a historical artifact.
- **arc-workflow-review PASSIVE_WAITING_STATES guard**: `issue-opened` and `changes-requested` states excluded from 7-day stuck detection. These states hold indefinitely until an external event (PR link, fix push). Requirement: stuck-workflow sensor must not create false-positive alerts for normal passive states. Valid. Satisfied.

### Step 2 — Delete

- **[CARRY-18]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.
- **[CARRY×4]** arc-alive-check sensor dormant since 2026-03-12 (v29) — fourth consecutive carry. Investigate whether superseded by arc-service-health.

### Step 3 — Simplify

- **arc-link-research filter** is minimal and correct: one additional boolean condition (`!r.takeaways[0]?.includes("review manually")`). No new abstraction needed. If content extraction fails, skip routing — don't queue a signal task that will fail at filing.
- **PASSIVE_WAITING_STATES as a Set** is the right primitive: O(1) lookup, explicit enumeration, easy to extend. The alternative (per-state flags in state machine config) would be over-engineered.
- **Context fix in sensor** (not in dispatch) is the right level: the sensor that creates the task knows what context that task needs. Context should be declared at creation time, not patched at dispatch time.

### Step 4 — Accelerate

- **PASSIVE_WAITING_STATES guard**: removes false-positive stuck alerts for `issue-opened` and `changes-requested` — previously fired every sensor cycle once workflows hit 7-day mark. Estimated cycle savings: 2–5/week in steady state.
- **defi-zest in supply tasks**: dispatch now loads Zest context directly rather than agent discovering the gap mid-task (or the task failing). Eliminates the "missing context → tool errors → retry" path for all future supply/claim ops.

### Step 5 — Automate

- **Context-review sensor proved its value**: caught the zest-yield-manager skills gap autonomously at task #11233. No human intervention needed. This validates keeping the context-review sensor at current cadence. No new automation warranted.
- **[WATCH]** arc-link-research infrastructure signal pipeline: first run post-rename will confirm beat slug resolves correctly. Monitor next research batch signal filing attempt.
- **[WATCH]** Approved-PR guard in production: day-19 retro still needed. Expected <5% failure rate from prior ~90% duplicate rate. (CARRY from prior audit.)

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[OK]** No new sensors or skills added (skill count increment reflects catalog update only).
- **[RESOLVED]** zest-yield-manager supply/claim context gap — `defi-zest` added to skills.
- **[RESOLVED]** arc-workflow-review false-positive stuck alerts for passive states.
- **[UPDATED]** arc-link-research signal beat: `dev-tools` → `infrastructure`. Both CLI and SignalAllocation diagram updated.
- **[WATCH]** arc-link-research infrastructure beat routing — validate on next research batch.
- **[WATCH]** Approved-PR guard validation — day-19 retro pending.
- **[WATCH]** Signal velocity — competition score 12, target >2 signals/day.
- **[CARRY×4]** arc-alive-check dormant since 2026-03-12 — investigate supersession.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-18]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-14]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-07T07:00:00.000Z — approved-PR guard; first→last PR query; tx-schemas watched

**Task #11217** | Diff: 5f32865 → 0fee0799 | Sensors: 70 | Skills: 101

### Step 1 — Requirements

- **Approved-PR guard (github-mentions)** (37645ac8): `arcHasReviewedPR()` checks `gh pr view --json reviews` before creating a task from @mention/team_mention on a watched repo PR. Direct fix for the day-17/18 duplicate flood (30/33 failures = Arc @mentioned on PRs it already reviewed). Requirement: sensor must not create duplicate review tasks. Satisfied. CEO confirmed: "highest-leverage fix in recent memory."
- **Approved-PR guard (arc-workflows)** (4292cef2): `arcHasReview` field from GraphQL + regression block in state machine ensures arc-workflows doesn't re-dispatch review tasks on already-reviewed PRs. Complementary to github-mentions guard — both sensors run independently. Requirement: workflow engine must not regress approved PRs to review states. Satisfied.
- **PR query first→last** (0fee0799): `pullRequests(first: 50)` → `pullRequests(last: 50)` in arc-workflows GraphQL batch. Silent but correct — high-activity repos (>50 total PRs) were missing all recent PRs. Requirement: workflow batch must include current PRs. Satisfied.
- **tx-schemas watched** (2cb79ad2): `aibtcdev/tx-schemas` added to `AIBTC_WATCHED_REPOS`. tx-schemas is the canonical schema package for x402/relay/inbox. Appropriate for monitoring scope. Requirement: watched repos should include shared infrastructure packages. Satisfied.

### Step 2 — Delete

- **[CARRY-18]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.
- **[CARRY×3]** arc-alive-check sensor dormant since 2026-03-12 (v29) — third consecutive carry. Investigate whether superseded by arc-service-health or needs updating.

### Step 3 — Simplify

- **Two-pronged approved-PR guard is the right architecture**: github-mentions and arc-workflows can both create review tasks independently — both gates are required. Not redundancy, it's defense-in-depth across two independent code paths. Each guard adds minimal overhead (one `gh` CLI call per mention; one GraphQL field per PR in a batched query).
- **`arcHasReviewedPR()` in github-mentions**: synchronous `gh` subprocess — ~100ms per PR mention. Bounded by mention frequency (O(10)/cycle). Acceptable.
- **`arcHasReview` in arc-workflows**: populated from the existing batched GraphQL query with zero extra network calls. The cleanest possible implementation.

### Step 4 — Accelerate

- **`last:50` fix directly reduces review latency for high-activity repos**: arc-workflows now picks up new PRs from repos with >50 total PRs (previously these were invisible to the workflow engine).
- **~30 dispatch cycles/day recovered**: days 17–18 wasted ~30 cycles on duplicate review failures. Guard eliminates these, freeing ~$10/day for productive work.

### Step 5 — Automate

- **Both guards are the correct automation step**: previously, duplicates were detected at task execution time (failing with "duplicate: already reviewed"). The sensor now detects this proactively. Correct level — avoids the wasted dispatch cycle entirely.
- **[WATCH]** Approved-PR guard in production: CEO requested validation that failure rate drops in next retro cycle. Expected: <5% from prior ~90% duplicate rate. Measure day-19 retro.
- **[WATCH]** Signal velocity: 0/6 signals in last watch (2026-04-07T01Z). aibtc-agent-trading sensor shipped (task #10898) — should improve diversity. Monitor next 24h for >2 signals/day.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[RESOLVED]** Duplicate PR review flood — approved-PR guard shipped in both github-mentions (37645ac8) and arc-workflows (4292cef2). Days 17–18 failure pattern structurally closed.
- **[NEW]** arc-workflows `first`→`last` PR query — silent behavioral fix for high-activity repo coverage.
- **[NEW]** aibtcdev/tx-schemas added to watched repos — monitoring scope expanded.
- **[WATCH]** Approved-PR guard validation — confirm <5% failure rate in day-19 retro.
- **[WATCH]** Signal velocity — 0/6 last watch; monitor next 24h for improvement.
- **[CARRY×3]** arc-alive-check dormant since 2026-03-12 — investigate supersession.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-ESCALATED]** relay nonce [1739] gap (pre-v1.27.3 artifact) — relay now clean per task #11180.
- **[CARRY-18]** ordinals HookState deprecated fields — 2026-04-23+.
- **[CARRY-14]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-06T18:35:00.000Z — agent-health sensor; terminal-state auto-complete; PURPOSE.md daily eval

**Task #11072** | Diff: 24bbee7f → 5f32865 | Sensors: 70 | Skills: 101

### Step 1 — Requirements

- **agent-health-loom sensor SHIPPED** (5f32865): New 120-minute sensor SSHes into Loom (Rising Leviathan), gathers cycle_log metrics, task failure patterns, git history, and gate/watchdog state. Creates Haiku analysis task only on YELLOW/RED — GREEN skips task creation. Requirement: autonomous peer health monitoring without human polling. Valid. Arc's multi-agent role now includes external health monitoring.
- **arc-workflows terminal-state auto-complete** (6b743823): PRs first seen in merged/closed state now immediately call `completeWorkflow()`. Existing workflows with no outgoing transitions also auto-complete. Root cause of 159 stuck workflows (task #10919) eliminated. Requirement: workflow state machine must not accumulate stuck terminal-state entries. Satisfied.
- **PURPOSE.md + daily eval** (f16ed394, 209b75bf): New `PURPOSE.md` documents long-term goals and a 5-dimension daily rubric (D1 Escrow, D2 Signals, D3 Ecosystem, D4 Cost, D5 Public). Strategy review cadence changed weekly→daily (1440 min). Requirement: daily self-evaluation aligned with watch report cadence. Valid for competition window.
- **aibtc-agent-trading verbose naming fix** (25df0919): Abbreviated variable names corrected per compliance warnings. No behavioral change. Requirement: compliance sensor catches and fixes naming issues without human intervention. Satisfied.

### Step 2 — Delete

- **[CARRY-18]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.
- **[WATCH]** arc-alive-check sensor dormant since 2026-03-12 (v29) — should investigate whether it's been superseded by arc-service-health or needs updating.

### Step 3 — Simplify

- **agent-health GREEN-skip** is the right simplification: 90%+ of 2h polls will find healthy systems → zero task creation → zero Haiku cost. The pre-baked data block in the task description (Haiku needs zero tool calls) is elegant — avoids a round-trip that would double latency and cost.
- **terminal-state auto-complete** uses `getAllowedTransitions()` which is the correct abstraction — avoids special-case logic. `Object.keys(transitions).length === 0` is the simplest possible terminal check.
- **arc-strategy-review daily cadence** is simpler operationally than weekly: aligns with watch report cycle, no special scheduling logic needed.

### Step 4 — Accelerate

- **159 stuck workflows eliminated**: dispatch cycles previously spent on manual bulk-close tasks (task #10919) are now freed. Future accumulation is structurally impossible.
- **agent-health GREEN-skip**: 2h polls of a healthy peer agent generate zero task queue churn. Scales to N peer agents without queue pressure.

### Step 5 — Automate

- **agent-health-loom is the automation step**: previously required manual SSH + visual inspection of Loom. Now automated with structured data gathering + Haiku triage + email on YELLOW/RED. This is the right level — alerting, not autonomous remediation of another agent.
- **[WATCH]** PURPOSE daily eval auto-generates a score each cycle. Monitor first 3 evaluations for score stability and rubric calibration.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[NEW RESOLVED]** arc-workflows terminal-state accumulation — auto-complete fix eliminates stuck workflow buildup.
- **[NEW]** agent-health-loom sensor — Arc now monitors peer agent Loom externally (120-min, GREEN-skip, Haiku triage).
- **[NEW]** PURPOSE.md + daily eval cadence — strategy review now daily.
- **[WATCH]** PURPOSE daily eval score calibration — monitor first 3 outputs.
- **[WATCH]** arc-alive-check sensor dormant since 2026-03-12 — investigate supersession.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-ESCALATED]** relay v1.27.2 nonce [1739] gap — task #10617, awaiting whoabuddy.
- **[CARRY-18]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-06T06:47:00.000Z — aibtc-agent-trading sensor; ordinals suspended; contact validation guard

**Task #10920** | Diff: bfc0b478 → 24bbee7f | Sensors: 69 | Skills: 101

### Step 1 — Requirements

- **aibtc-agent-trading sensor SHIPPED** (5da9081c): New 2-hour sensor filing `agent-trading` beat signals using AIBTC-network-native data (JingSwap cycles/prices, P2P ordinals desk, agent registry growth). This is the architectural answer to the signal diversity gap — dedicated sensor with native data replaces external-data fallback. Requirement: competition signals on `agent-trading` beat must use AIBTC-network data (per beat scope definition). Satisfied.
- **ordinals-market-data signal filing SUSPENDED** (80322a56): Beat scope mismatch resolved by suspension. Data collection continues. Requirement: no more off-beat signals from external market data sources. Satisfied.
- **contact validation guard** (b181a5d6): `isContactActuallyInvolved()` in arc-reputation sensor closes the false-positive contact match class (task #10871 Halcyon Wolf). Requirement: reputation tracker must only score contacts actually involved in interactions. Satisfied.
- **aibtc-news-editorial x402 fallback** (09c036d0): Signal filing survives 402 payment-required responses. Requirement: filing should not fail on payment-gated endpoints. Satisfied.
- **arc-workflows gh CLI GraphQL** (arc-workflows/sensor.ts): Removes credential fetch dependency for PR lookups. Consistent with aibtc-repo-maintenance approach. Requirement: no orphaned credential reads for standard GitHub API operations. Satisfied.

### Step 2 — Delete

- **ordinals HookState deprecated fields** (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — [CARRY-18]. Signal filing suspended makes cleanup lower priority but the fields are still dead weight. Defer 2026-04-23+.
- **[CARRY-14]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.

### Step 3 — Simplify

- **arc-workflows gh CLI GraphQL migration** is the right simplification: batched multi-repo query with `gh` CLI (which manages auth implicitly) is strictly simpler than per-repo REST calls with explicit credential lookups. No downside identified.
- **Signal architecture is now clean**: two sensors (aibtc-agent-trading for native, arxiv-research for dual-beat) plus ordinals data collection. The suspension mechanism in ordinals is minimal (1 flag). No over-engineering detected.

### Step 4 — Accelerate

- **aibtc-agent-trading sensor immediately fills the competition signal gap**: AIBTC-native data sources (JingSwap, P2P desk, agent registry) are always generating activity. The new sensor should yield 2-3 diverse signal opportunities per day vs the prior nft-floors repetition. Expected competition score improvement: +4 to +10 points/day.
- **Batched GraphQL** in arc-workflows: single network call per cycle replaces N sequential calls. Faster PR state sync for active workflow pipelines.

### Step 5 — Automate

- **[WATCH]** aibtc-agent-trading `flat-market` fallback: sensor fires a strength-30 fallback signal if all change detection thresholds are quiet. This is correct behavior (guaranteed daily filing even in low-activity windows), but the fallback signal quality may not score well. Monitor first 5 signals for quality.
- **[CARRY-ESCALATED]** effectiveCapacity=1 — task #9658, unchanged. relay v1.27.2 nonce [1739] new gap — monitor.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[NEW RESOLVED]** Signal diversity gap — aibtc-agent-trading sensor ships AIBTC-native data. [GAP] from prior 2 audits CLOSED.
- **[WATCH]** aibtc-agent-trading flat-market fallback signal quality — monitor first 5 outputs.
- **[ESCALATED]** relay v1.27.2 nonce regression — task #10617, awaiting whoabuddy.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-18]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-05T18:35:00.000Z — signal diversity gap; relay watch closed; no code changes

**Task #10790** | Diff: 2f9d804c → bfc0b478 | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **No code changes this window** — only auto-commits (memory persist, watch report HTML update). Architecture is structurally stable.
- **CEO review directive**: "Signal diversity: surface and file on quantum-computing or infrastructure beat — not nft-floors again." nft-floors × 2 per session is the established pattern (overnight Apr 3, Apr 4, Apr 5 all filed nft-floors × 2). Competition score 12 vs top 32 — signal variety is the gap.
- **relay v1.27.2 sponsor nonce [1621]** [CARRY-ESCALATED task #10617]: improving (possibleNextNonce: 1624), still pending whoabuddy.
- **66 completed today / 7 failed this week** — system healthy.

### Step 2 — Delete

- **[CLOSED] relay v1.27.2 schema CARRY-WATCH**: `check-relay-health` CLI uses `...(relayHealth ?? {})` spread — gracefully handles missing CB/pool/effectiveCapacity fields without errors. `isRelayHealthy()` in sensor only checks `canSponsor` + `status` from `/status/sponsor` — no dependency on removed fields. Concern is moot.
- **[CARRY-17]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.

### Step 3 — Simplify

- **`buildFlatMarketSignal()` category selection is non-rotating**: always picks first `FLAT_MARKET_CATEGORIES` entry (`nft-floors`) with ≥3 readings. Since nft-floors accumulates readings continuously, it always wins. Result: nft-floors fires on every flat-market fallback slot. Fix is minimal: track `lastFlatMarketCategory` in HookState and skip it on next fallback run (simple rotation without complex scoring). This is a 2-line state write + 1 filter change.

### Step 4 — Accelerate

- **Signal diversity fix would improve competition score trajectory**: filing quantum-computing or infrastructure signals earns the same $20/signal as a repeat nft-floors. 2 diverse signals × $20 > 2 nft-floors × $20 (same dollar value but better portfolio coverage and potentially higher reviewer scores).

### Step 5 — Automate

- **Competition signal velocity**: 2/6 signals filed per night (score 12+). Both signals nft-floors. arxiv-research dual-beat routing (quantum + infrastructure) is operational — sensor may not be firing daily or papers aren't matching thresholds. Needs investigation.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[NEW]** Signal diversity gap — flat-market fallback always fires nft-floors. Fix: category rotation in `buildFlatMarketSignal()`.
- **[CLOSED]** relay v1.27.2 schema CARRY-WATCH — gracefully handled via spread.
- **[ESCALATED]** relay v1.27.2 nonce regression — task #10617, awaiting whoabuddy.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-17]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-14]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-05T06:35:00.000Z — issue flood guard; workflow skills format fix; self-review stuck state

**Task #10768** | Diff: 6ce1d0f → f3b5159 | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **Issue @mention flood guard shipped** (10964091): `github-mentions/sensor.ts` Issue notifications now use `recentTaskExistsForSource()` (24h) instead of `pendingTaskExistsForSource()`. Day-14 issue: issue #383 generated 10+ tasks (~$2.50 wasted) because completing a task allowed the next @mention to re-create. PullRequest notifications unaffected. Requirement: suppress queue floods from multi-participant issue threads. Satisfied.
- **arc-workflows skills format fixed** (f3b5159d): `arc-workflows/sensor.ts` was using `.join(",")` for skills serialization; all parsers expect JSON arrays. Silent data corruption: workflow-created tasks lost skill context at dispatch. Fixed to `JSON.stringify()`. context-review/sensor.ts also gets comma-separated fallback for historical tasks + superseded-task filter for empty-skills check. Requirement: workflow-created tasks load correct skill context. Satisfied.
- **arc-self-review stuck state fixed** (806ce147): 'triggered' state task description lacked workflow transition CLI command. Workflows accumulated in 'triggered' state, generating duplicate health-check tasks each cycle. Fix: explicit `arc skills run --name arc-workflows -- transition <id> reviewing` added to task description as first step. Requirement: arc-self-review workflows advance through states without accumulation. Satisfied.
- **relay v1.27.2 sponsor nonce** [CARRY-ESCALATED task #10617]: No change. Still awaiting whoabuddy intervention.

### Step 2 — Delete

- No deletions this window.
- **[CARRY-16]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-13]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.

### Step 3 — Simplify

- **Issue flood guard**: adding `recentTaskExistsForSource()` is the minimum viable fix — no over-engineering. One guard applies to all future Issue floods regardless of issue URL.
- **Skills format fix**: 1-line change at write path + 3-line fallback at read path. Backward-compatible. Correct.
- **arc-self-review fix**: pure task-description text change (no code logic added). AGENT.md-style fix applied to state machine task body.

### Step 4 — Accelerate

- **Issue flood prevention** directly reduces wasted dispatch cycles. Estimated: 10+ cycles saved per multi-participant issue thread.
- **Skills format fix** ensures workflow-dispatched tasks actually load skill context — previously they were running with empty context, likely degrading task quality silently.

### Step 5 — Automate

- **[CARRY-WATCH]** relay v1.27.2 schema change: `isRelayHealthy()` may not handle missing CB/pool/effectiveCapacity fields from v1.27.2 response. Consider graceful fallback.
- **Competition signal velocity**: 2/6 signals filed per night (score 12+, trend improving). Quantum + infrastructure dual-routing operational.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[CLOSED]** arc-workflows skills format mismatch — fixed in f3b5159d.
- **[CLOSED]** arc-self-review stuck 'triggered' state — fixed in 806ce147.
- **[CLOSED]** Issue @mention flood gap — fixed in 10964091.
- **[ESCALATED]** relay v1.27.2 nonce regression — task #10617, awaiting whoabuddy.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-WATCH]** relay v1.27.2 schema change — `isRelayHealthy()` missing-field handling.
- **[CARRY-16]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-13]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-04T18:35:00.000Z — PR review lifecycle centralized; safe-commit lint fixed; context preservation

**Task #10693** | Diff: 34bb98a → 6ce1d0f | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **PR review lifecycle centralized in PrLifecycleMachine** (061c807d, 8a984348): `AUTOMATED_PR_PATTERNS` moved from `aibtc-repo-maintenance/sensor.ts` to `arc-workflows/state-machine.ts` (exported). `PrLifecycleMachine` now owns all PR review task dispatch via `shouldSkipPrReview()`, `prReviewSkills()`, `buildReviewDescription()`. Requirement: prevent dual-creation from sensor + github-mentions racing on same PR. Satisfied.
- **safe-commit lintModelField() two bugs fixed** (8a984348): (1) False positives on regex literal comments containing `insertTask`. (2) `insertTaskIfNew` with extra positional args (e.g. `}, "pending"`) was misdetected as missing `model:`. Both fixed. Requirement: accurate model-field enforcement at commit time. Satisfied.
- **Context preservation on PrLifecycleMachine state transitions** (8a984348): Prior code overwrote workflow context on state change, losing `reviewCycle`, `isAutomated`, `fromIssue`. Now merges. Requirement: multi-cycle PR review tracking. Satisfied.
- **relay v1.27.2 sponsor nonce degraded** [CARRY-ESCALATED task #10617]: No change. Still awaiting whoabuddy intervention.

### Step 2 — Delete

- **[CLOSED]** dual PR review task creation (sensor + github-mentions racing) — centralized in PrLifecycleMachine.
- **[CARRY-15]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-12]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+.

### Step 3 — Simplify

- **PrLifecycleMachine consolidation is the right move**: PR review task creation was split across 3 locations (sensor.ts, github-mentions, aibtc-repo-maintenance). Now 1 location. State machine pattern scales well for multi-cycle re-reviews.
- **aibtc-repo-maintenance sensor ~85 lines lighter**: net simplification, no functionality lost.

### Step 4 — Accelerate

- No bottlenecks introduced. PrLifecycleMachine state transitions fire at sensor cadence (15 min), same as before.

### Step 5 — Automate

- **[CARRY-WATCH]** relay v1.27.2 schema change: `isRelayHealthy()` health probe may not handle missing CB/pool/effectiveCapacity fields gracefully. Consider graceful field fallback.
- **Competition signal velocity**: 2/6 signals filed overnight 2026-04-04. Trend improving (1→1→2). Quantum beat diversifying portfolio.

### Flags

- **[OK]** No dispatch loop, schema, or task queue changes this window.
- **[CLOSED]** dual PR review task creation — centralized in PrLifecycleMachine.
- **[ESCALATED]** relay v1.27.2 nonce regression — task #10617, awaiting whoabuddy.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[CARRY-WATCH]** relay v1.27.2 schema change — `isRelayHealthy()` missing-field handling.
- **[CARRY-15]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-12]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-04T06:35:00.000Z — quantum beat routing; outage bypass shipped; stale-lock watch closed

**Task #10648** | Diff: 4f33bbe9 → 34bb98a8 | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **Quantum beat routing shipped** (42d54a6e, 2026-04-03): `arxiv-research` sensor now fetches `quant-ph` and routes post-quantum/ECDSA-threat papers to the `quantum` beat independently from infrastructure. Enabled by agent-news PR #376 (quantum beat live). Requirement: capture quantum computing–Bitcoin intersection signals. Satisfied.
- **Failure-triage outage bypass shipped** (f93cb48f, 2026-04-03): Bulk outage events (>N failures with identical summary) now classified as "outage event" and skip individual retro tasks. Closes [NEW WATCH] from prior audit. Requirement: avoid 637-task false-positive retro cascades. Satisfied.
- **relay v1.27.2 sponsor nonce degraded** [ESCALATED task #10617]: Relay upgraded v1.26.1→v1.27.2; 4 missing nonces [1549,1553,1555,1559], 7 mempool-pending. Response schema changed (no CB/pool/effectiveCapacity fields). Escalated to whoabuddy. Not a code change — operational regression.

### Step 2 — Delete

- **[CLOSED]** failure-triage outage bypass [NEW WATCH] — shipped in f93cb48f.
- **[CLOSED]** stale-lock PID pre-validation [NEW WATCH] — already implemented (34420a21, 2026-03-27): `isPidAlive(lock.pid)` in sensor. Watch was stale.
- **[CARRY-14]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-11]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+ upstream.

### Step 3 — Simplify

- **Dual-beat routing in single sensor**: arxiv-research now routes to infrastructure + quantum beats independently. Code is clean — two separate filter functions, two separate source keys. No shared state. No simplification needed.
- **Stale-lock false positives (dispatch-stale path)**: The lock path is correct (`isPidAlive` gates alert creation). Remaining false positives come from `checkStaleCycle()` (time-based, no PID concept) firing during legitimate idle gaps. Not a code smell — working as designed. Operational protocol: verify cycle_log recency before intervening.

### Step 4 — Accelerate

- **Quantum signal pipeline**: arxiv fetches 6 categories (was 5); 12h interval unchanged. No latency impact.
- **Beat-slug validation cache** (10-min TTL) still well-tuned. No changes needed.

### Step 5 — Automate

- **[NEW WATCH]** relay schema version detection: relay v1.27.2 changed response format (dropped CB/pool/effectiveCapacity fields). Health check `isRelayHealthy()` may silently return wrong values against v1.27.2 schema. Consider adding version field check or graceful missing-field handling in health probe.
- **Competition signal velocity**: Only 1/6 signals filed most days (score 12/32, top 32). Signal sensors are firing but capacity is underutilized. Not a code automation issue — the gap is signal research throughput and beat routing. Quantum + infrastructure dual-routing helps.

### Flags

- **[OK]** No structural dispatch, schema, or sensor-tree changes this window.
- **[CLOSED]** failure-triage outage bypass — shipped f93cb48f.
- **[CLOSED]** stale-lock PID pre-validation — already in place since 34420a21.
- **[ESCALATED]** relay v1.27.2 nonce regression — task #10617, awaiting whoabuddy intervention.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, unchanged.
- **[NEW WATCH]** relay v1.27.2 schema change — `isRelayHealthy()` health probe may not handle missing CB/pool/effectiveCapacity fields gracefully.
- **[CARRY-14]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-11]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-04-03T18:30:00.000Z — beat-slug drift closed; compute outage triage gap identified

**Task #10572** | Diff: 5f84c07d → 3913c094 | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **validateBeatExists() shipped** (391e4921, 2026-03-31T06:29Z): `aibtc-news-editorial/cli.ts` now calls `GET /api/beats` before filing any signal. Caches result to `db/beat-slug-cache.json` (10-min TTL). Fails early with list of available slugs if slug not found. Directly addresses the recurring beat-slug-drift failure class (3rd occurrence in 2 weeks). Requirement: catch slug drift before filing. Satisfied.
- **Compute outage 2026-04-02/03**: 637 tasks bulk-failed due to host-level outage. `failure-triage` sensor fired as if 637 independent failures occurred. Documented in MEMORY.md (l-compute-outage-2026-04-03). Services restored 2026-04-03T15:00Z.
- **stale-lock false-positive pattern confirmed** (MEMORY.md): Every stale-lock/dispatch-stale alert to date has been a false positive. The sensor creates correct alert tasks — but the alert interpretation protocol matters more than the sensor code itself.

### Step 2 — Delete

- **[CLOSED]** `validateBeatExists()` [WATCH] from 3 prior audit cycles — shipped (391e4921).
- **[CARRY-13]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+.
- **[CARRY-10]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred post skills v0.37+ upstream.

### Step 3 — Simplify

- **No new complexity introduced this window.** Only auto-memory persist commits and housekeeping since last diagram.
- **failure-triage signal quality**: Sensor fires identically for 1-outage-×-637 vs 637 independent failures. A simple check — "N tasks failed with identical summaries in <1h window?" — could distinguish outage events and suppress false retro tasks. Low complexity, high value.

### Step 4 — Accelerate

- **Beat-slug validation cache** (10-min TTL) is well-tuned — prevents API churn across rapid dispatch cycles while staying fresh. No changes needed.
- **Stale-lock confirmation latency**: False-positive resolution requires a human or dispatch cycle to verify PID and close the alert task. Could add PID validation directly in sensor before creating alert — would eliminate false-positive tasks entirely.

### Step 5 — Automate

- **[NEW WATCH]** failure-triage outage bypass: if >200 tasks fail with identical summaries in <1h, log as "outage event" instead of creating individual investigation tasks. Reduces noise after infrastructure incidents.
- **[NEW WATCH]** stale-lock PID pre-validation: sensor could verify lock file PID is live before creating alert task. Every alert so far has been a false positive with live PID. If lock PID dead → create alert (genuine case). If live → skip alert.

### Flags

- **[OK]** No structural dispatch, schema, or sensor-tree changes this window.
- **[CLOSED]** Beat slug validation shipped. [WATCH] from 3 prior audits resolved.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, awaiting whoabuddy DO config change.
- **[NEW WATCH]** failure-triage outage bypass — outage events inflate failure counts and spawn unnecessary retro tasks.
- **[NEW WATCH]** stale-lock PID pre-validation — every alert to date has been a false positive with live PID.
- **[CARRY-13]** ordinals HookState deprecated fields — cleanup 2026-04-23+.
- **[CARRY-10]** layered-rate-limit migration — post-competition 2026-04-23+.
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+.

---

## 2026-03-31T06:22:00.000Z — sensor quality fixes: arxiv filter, welcome relay probe, ordinals fee-market removal

**Task #9839** | Diff: a94eb3a → 6282b8b | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **arxiv-research beat slug drift** (d2bc3c0d): Beat renamed from `dev-tools` to `infrastructure` by platform without notice. Sensor was filing 404s. Also: broad `DEV_TOOL_PAPER_KEYWORDS` was letting generic agent/ML papers through — publishers rejected for "no aibtc network connection." Two-tier filter added: Tier 1 (specific keywords: MCP, x402, Stacks, Clarity, sBTC, BRC-20, bitcoin relay); Tier 2 (agent + crypto/blockchain compound). Requirement: stop wasting signal quota on rejected topics. Satisfied.
- **aibtc-welcome relay health probe** (e5210b25): Probe 3 previously called Hiro API directly for wallet 0 nonces only. Now calls GET `/status/sponsor` on the relay (covers all 10 pool wallets, returns `canSponsor + status`). Requirement: health check should reflect full pool state, not single-wallet Hiro snapshot. Satisfied. Removes `SPONSOR_ADDRESS` constant and direct Hiro dependency from arc-starter.
- **ordinals fee-market removal** (6282b8b2): Rising Leviathan (automated signal reviewer) rejected 5 fee-market signals in 27h as "external to aibtc network." Sensor still included fee-market in FLAT_MARKET_CATEGORIES fallback despite the known rejection rule. Requirement: no more fee-market fallback signals. Satisfied. Also extracted candidate order to module-level constant, removed dead case block.

### Step 2 — Delete

- **[OK]** Dead code removed: `SPONSOR_ADDRESS` constant in aibtc-welcome (e5210b25), dead case block in ordinals-market-data (6282b8b2).
- **[CARRY]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (12th carry-forward).
- **[CARRY]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (9th carry-forward).
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred pending skills v0.37+ upstream release.

### Step 3 — Simplify

- **aibtc-welcome**: Replacing a Hiro single-wallet nonce probe with a relay `/status/sponsor` endpoint is a net simplification: fewer dependencies (no Hiro API), better coverage (10 wallets vs 1), more accurate health signal. +12/-19 lines.
- **ordinals-market-data**: Extracting `FLAT_MARKET_CATEGORIES` to module-level constant is a minor readability improvement. +3/-21 lines.
- **No new complexity introduced**: All three changes are targeted fixes or removals.

### Step 4 — Accelerate

- **Signal quality loop**: Rising Leviathan rejects feed into arxiv (two-tier filter) + ordinals (fee-market removal) fixes. Same-day feedback loop from rejection → fix closes in ~27h. Pattern: automated reviewers provide fast signal quality feedback — treat rejections as actionable sensor bugs.
- **Beat slug drift mitigation needed**: Recurring failure class (day 11 retro, arxiv 404). Sensors should detect 404 on signal file and either self-heal or create a beat-slug-drift task. No sensor currently does this proactively.

### Step 5 — Automate

- **[WATCH]** Beat slug validation: sensors file signals to slugs defined as constants. When platform renames a beat, sensors produce 404s until manually fixed. A lightweight beat-existence check (GET /beats on startup or first signal attempt) would catch slug drift without human intervention. Low-effort automation candidate.

### Flags

- **[OK]** All 3 fixes are targeted sensor improvements. No structural dispatch or schema changes.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, awaiting whoabuddy DO config change.
- **[WATCH]** Beat slug drift: recurring failure class (3rd occurrence). Automate beat-existence validation.
- **[CARRY]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (12th carry-forward).
- **[CARRY]** layered-rate-limit migration — post-competition 2026-04-23+ (9th carry-forward).
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+ upstream.

---

## 2026-03-30T18:26:00.000Z — clean overnight + no structural changes

**Task #9782** | Diff: c8b717d → a94eb3a | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **Research sprint** (22 tasks, 0 failures): Validates batch parallelism pattern — 22 research tasks completed in ~90 min with quick-reject screening. 1 high-relevance signal filed (NanoClaw/OneCLI infrastructure). Requirement: research-to-signal pipeline. Satisfied.
- **81/81 zero-failure watch** (01:01Z–13:01Z): Best period on record. Relay CB closed + Hiro API reachable. effectiveCapacity=1 is a hard ceiling, not a blocker. Requirement: system health. Satisfied.
- **effectiveCapacity=1** (escalated task #9658): Server-side Cloudflare DO config — all 5 admin actions exhausted. No Arc action available. Requirement: increase x402 welcome throughput. Not satisfiable without whoabuddy DO config change.

### Step 2 — Delete

- **[INFO]** No new deletion candidates — diff is research cache files only.
- **[CARRY]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (11th carry-forward).
- **[CARRY]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (8th carry-forward).
- **[CARRY]** nonce-strategy Phase 1 (retry-strategy.ts) — deferred pending skills v0.37+ upstream release.

### Step 3 — Simplify

- **No new simplification opportunities**: Diff is research cache files. No code added. Architecture unchanged.

### Step 4 — Accelerate

- **Competition signal output is the bottleneck**: Infrastructure is healthy. 6/day signal cap is enforced. Score 12, top 32. Closing the gap requires filing more relevant signals, not infrastructure work.

### Step 5 — Automate

- **No new automation identified**: Research triage pipeline is working well (22 tasks → 1 signal with quick-reject screening). Existing sensors cover all domains.

### Flags

- **[OK]** No structural code changes since last review. Diagram timestamp updated only.
- **[ESCALATED]** effectiveCapacity=1 — task #9658, awaiting whoabuddy DO config change.
- **[CARRY]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (11th carry-forward).
- **[CARRY]** layered-rate-limit migration — post-competition 2026-04-23+ (8th carry-forward).
- **[CARRY]** nonce-strategy Phase 1 — deferred post skills v0.37+ upstream.

---

## 2026-03-30T06:18:00.000Z — ghost nonce resolved + effectiveCapacity root cause + nonce alignment plan

**Task #9676** | Diff: ca5477c → c8b717d | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **Ghost nonce 554 resolution** (memory [l-capacity-stall-resolved-root-cause]): Traces to 10 days of x402 welcome cascade failures. Sender progressed to 577/578; sponsor at 1207/1208. Both sides clean. Root cause: effectiveCapacity is a server-side Cloudflare DO config, not derived from nonce state. Escalated to whoabuddy (task #9658). Requirement: reduce welcome failure rate. Partially satisfied — throughput=1 until server config changed.
- **nonce-strategy-alignment-plan** (8b3aea27): Traces to 3 divergent tx paths causing ghost nonce loops. 307-line plan for consolidating all write tx paths to consistent nonce-tracker acquire/release + relay-first broadcast. Requirement: prevent future nonce-related cascade failures. Plan created; implementation deferred to post-skills-upstream-work.
- **0-failure watch window** (2026-03-29T13:00 → 2026-03-30T01:01Z): First clean 12h window in days. 18 tasks, $3.35 ($0.186/task). Relay CB closed + Hiro API reachability confirmed. Requirement: system health. Satisfied.

### Step 2 — Delete

- **[CARRY]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (10th carry-forward).
- **[CARRY]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (7th carry-forward).
- **[INFO]** No new deletion candidates this cycle — changes are operational state, docs, and memory only.

### Step 3 — Simplify

- **nonce-strategy-alignment-plan is the right abstraction**: A shared `retry-strategy.ts` consolidating error classification across 3 tx paths reduces the blast radius of any single nonce failure. Current state: 3 paths → 3 different behaviors → cascade-amplified failures. Post-consolidation: 1 shared error model → consistent retry behavior across all tx paths.
- **effectiveCapacity=1 is a hard constraint**: No client-side simplification applies. Welcome tasks succeed serially. Until whoabuddy changes DO config, the throughput ceiling is the relay, not Arc's code.

### Step 4 — Accelerate

- **Competition signal output**: Score 12, top 32. With relay healthy and CB closed, signal queue is the bottleneck, not infrastructure. Each passing day without signals is ~$20/day unrealized.
- **nonce alignment (Phase 1)**: Once upstream skills implements `retry-strategy.ts`, Arc's 3 tx paths can converge. Expected: eliminate NONCE_CONFLICT cascade failures entirely.

### Step 5 — Automate

- **No new automation this cycle** — existing sensors (zest-yield-manager, arc-architecture-review, arc-failure-triage) cover the domain. No gaps identified.
- **Carry forward**: nonce-strategy Phase 1 implementation task should be created when upstream skills v0.37+ is released.

### Flags

- **[OK]** Ghost nonce 554 RESOLVED. Sender 577/578, sponsor 1207/1208. Both clean.
- **[ESCALATED]** effectiveCapacity=1 — server-side Cloudflare DO config. Whoabuddy notified (task #9658).
- **[NEW DOC]** docs/nonce-strategy-alignment-plan.md — 3-phase tx path consolidation plan.
- **[CARRY]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (10th carry-forward).
- **[CARRY]** layered-rate-limit sensor migration — post-competition 2026-04-23+ (7th carry-forward).
- **[INFO]** Sensor count: 68 (unchanged). Skill count: 100 (unchanged). No structural changes this cycle.

---

## 2026-03-29T18:22:00.000Z — quorumclaw deleted + signal cap fix + arc-workflows diagram gap

**Task #9578** | Diff: 51d6cbf → ca5477c | Sensors: 68 | Skills: 100

### Step 1 — Requirements

- **bitcoin-quorumclaw fully deleted** (947ffa43): Prior audit marked as dormant (return "skip" immediately). But failure-triage kept generating tasks for old QuorumClaw failures — the sensor pause only stopped new failures, not the triage loop from old ones. Complete deletion breaks the loop: failure-triage can't create tasks for a skill that no longer exists. 1573 lines removed. Requirement: stop all noise from dead integration. Satisfied.
- **countSignalTasksToday() fix** (ca5477c1): Beat slug migrated 'ordinals' → 'agent-trading' in a prior cycle but the aggregate daily-cap query wasn't updated. Subjects `'File agent-trading signal%'` were excluded → 6/day cap gate was ineffective. Fix: 2 lines in src/db.ts. Competition integrity restored. Requirement: enforce 6/day cap. Satisfied.
- **arc-workflows source key fix** (8ce27fb9): Workflow meta-sensor used `workflow:{id}` dedup key for all states. 24h dedup window blocked subsequent states after first state created a task. Workflow 779 stuck 4+ hours. Fix: `workflow:{id}:{state}`. Requirement: workflow state machine must progress through all states. Satisfied.

### Step 2 — Delete

- **[OK]** bitcoin-quorumclaw DELETED (947ffa43). 1573 lines removed. Prior [WATCH] "dead code below early-return" — CLOSED (code gone entirely). No reactivation path needed without confirmed new API URL.
- **[OK]** countSignalTasksToday() mismatch — CLOSED (ca5477c1). [INFO] carry-forward from prior audits resolved.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (9th carry-forward).
- **[INFO]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (6th carry-forward).
- **[INFO]** diagram gap closed: arc-workflows sensor was missing from all prior diagrams. Added to InfrastructureSensors (no code change, diagram accuracy fix).

### Step 3 — Simplify

- **bitcoin-quorumclaw deletion: correct call over dormancy** — prior audit preserved dead code as "reactivation blueprint." Failure-triage loop proved dormancy insufficient. Deletion is simpler and breaks the loop at the root. When/if API returns, skill can be rebuilt from scratch — the reactivation path was never complex.
- **countSignalTasksToday() fix: 2 lines** — minimal and targeted. No abstraction added. Correct scope.
- **arc-workflows source key: 4 lines** — scoping dedup key from workflow level to state level. Correct fix for the pattern. No new state or abstraction.

### Step 4 — Accelerate

- **Signal cap now enforced**: 6/day limit was previously unenforced due to subject mismatch. Fixed before competition ramp-up. Prevents accidental over-filing and potential competition disqualification.
- **arc-workflows unblocked**: state-specific dedup means workflow state machines progress correctly without 24h stalls between states.

### Step 5 — Automate

- **Post-competition cleanup batch (2026-04-23+)**: ordinals HookState deprecated fields, flat-market fallback evaluation, layered-rate-limit migration. Still bundled to avoid queue pollution.
- **No new automation identified** — all three changes this cycle are reactive bug fixes, correctly small.

### Flags

- **[OK]** bitcoin-quorumclaw DELETED (947ffa43). Triage loop stopped. Sensor count 69→68. Skill count 101→100.
- **[OK]** countSignalTasksToday() bug fixed (ca5477c1). 6/day competition cap now enforced.
- **[OK]** arc-workflows cross-state dedup fixed (8ce27fb9). Workflow state machine unblocked.
- **[OK]** arc-workflows diagram gap closed — sensor now visible in InfrastructureSensors.
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (9th carry-forward).
- **[INFO]** layered-rate-limit sensor migration — post-competition 2026-04-23+ (6th carry-forward).

---

## 2026-03-29T06:16:00.000Z — zest-yield-manager sensor + bitcoin-quorumclaw archived

**Task #9526** | Diff: f2205d8 → 90f401f9 | Sensors: 69 | Skills: 101

### Step 1 — Requirements

- **zest-yield-manager sensor.ts** (af624449): Traces to [WATCH] from prior audit — zest-yield-manager skill was installed but required explicit task creation; no autonomous trigger for idle sBTC yield. Fix: 266-line sensor on 60-minute cadence. Checks Arc's sBTC balance vs 200k-sat reserve; queues supply tasks when idle > threshold; queues claim tasks when wSTX rewards > 1000 uSTX. Requirement satisfied. [WATCH] CLOSED.
- **bitcoin-quorumclaw archived** (51d6cbf6): Traces to quorumclaw-api-down [MEMORY A]. API deprovisioned (quorumclaw.com → Railway 404). Correct call: mark dormant (return "skip" immediately) rather than delete — reactivation path is clear (update API_BASE + delete failure-state.json when new URL confirmed). Tracked invite 72654529 unresolvable until API returns. Requirement: stop noise; preserve reactivation path.

### Step 2 — Delete

- **[OK]** zest-yield-manager [WATCH] CLOSED — sensor now installed and autonomous.
- **[OK]** bitcoin-quorumclaw dormant — sensor returns "skip" immediately. No task-creation noise.
- **[WATCH]** bitcoin-quorumclaw sensor.ts has dead code below the early-return (lines 286-329). Kept intentionally for reactivation. Acceptable tradeoff — reactivation path is clear. Not worth a cleanup task until API URL is confirmed.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (8th carry-forward).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (6th carry-forward).
- **[INFO]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (5th carry-forward).

### Step 3 — Simplify

- **zest-yield-manager sensor: acceptable complexity** — 266 lines for a sensor that makes 2 Clarity `call-read-only` calls (balance + pending rewards) and conditional task creation. The `@stacks/transactions` CV serialization imports are verbose (5 imports) but unavoidable for Clarity contract calls. Threshold constants are clearly named and match AGENT.md. No simplification needed.
- **bitcoin-quorumclaw dormant pattern: correct** — sensor.ts has dead code below `return "skip"` but this is intentional. The dead code serves as the reactivation blueprint. A comment on line 1 would suffice instead of keeping all 329 lines. Low priority.

### Step 4 — Accelerate

- **zest-yield-manager sensor enables autonomous sBTC yield**: idle sBTC balance above 200k sats will now trigger supply tasks without human intervention. Capital that was sitting idle will be deployed to Zest ~3.5% APY automatically.
- **bitcoin-quorumclaw dormant removes 0 dispatch noise**: sensor already had skip-on-pause fix (eaa40bfa). The archive converts it to immediate-skip — saves ~15ms of failure-state I/O per sensor cycle. Negligible but correct.

### Step 5 — Automate

- **Post-competition cleanup batch (2026-04-23+)**: ordinals HookState deprecated fields, flat-market fallback evaluation, countSignalTasksToday() divergence, layered-rate-limit migration. Bundle to avoid queue pollution.
- **bitcoin-quorumclaw reactivation**: unblocked by new API URL. No automation possible until URL is confirmed. Watch quorumclaw.com status.

### Flags

- **[OK]** zest-yield-manager sensor.ts installed (af624449). Autonomous sBTC yield management active. 60-min cadence. Prior [WATCH] CLOSED.
- **[OK]** bitcoin-quorumclaw archived (51d6cbf6). Dormant. API deprovisioned. Reactivation path documented.
- **[WATCH]** bitcoin-quorumclaw sensor.ts: dead code below early-return (lines 286-329) — intentional, acceptable for reactivation.
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (8th carry-forward).
- **[INFO]** Sensor count: 69 (+1 zest-yield-manager, bitcoin-quorumclaw still counted but dormant). Skill count: 101 (unchanged).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (6th carry-forward).
- **[INFO]** layered-rate-limit sensor migration — post-competition 2026-04-23+ (5th carry-forward).

---

## 2026-03-28T18:25:00.000Z — skills-v0.36.0 install + epoch guard removal + nonce queue-check

**Task #9479** | Diff: b8e6595 → f2205d8+ | Sensors: 68 | Skills: 101

### Step 1 — Requirements

- **nonce-manager queue-check** (f2205d80): Traces to 9 welcome-agent NONCE_CONFLICT failures (watch report 2026-03-28T13:00Z). Relay visibility gap: once a nonce stalls in the relay queue, no way to inspect what's stuck without admin API access. Fix: local `queue-check` subcommand queries `/queue/{address}`. Correctly local — relay endpoint is separate from the upstream nonce oracle. Requirement satisfied.
- **epoch-3.4 guard removal** (313d6b49): Traces to [WATCH] from audit cycle 2026-03-27T06:16Z. Guard window [943,050–943,500] was dead code after burn block passed ~2026-04-04. Removed 3 constants and guard function. -30 lines. Requirement: remove dead code when epoch stability confirmed. Satisfied. [WATCH] CLOSED.
- **hodlmm-risk skill** (42318621): Traces to skills-v0.36.0 (competition Day 2 winner, @locallaunchsc-cloud). Read-only HODLMM volatility monitor. Risk gate before LP add/remove. No sensor needed — correctly on-demand. Requirement valid.
- **zest-yield-manager skill** (42318621): Traces to skills-v0.36.0 (competition Day 1 winner, @secret-mars). sBTC yield management (supply/withdraw/claim). Mainnet-only, write-capable. Requirement valid. **Incomplete**: no sensor to trigger autonomous yield optimization. Skill exists but requires explicit task creation to activate.

### Step 2 — Delete

- **[OK]** epoch-3.4 guard: CLOSED (313d6b49). -30 lines. [WATCH] from prior audits resolved.
- **[WATCH]** zest-yield-manager: write-capable skill with no autonomous trigger. No sensor.ts. If yield optimization should be autonomous (Arc holds sBTC → supply → earn yield), a sensor checking position + balance + pending rewards is needed. Until then, requires human/task-initiated dispatch.
- **[WATCH]** hodlmm-risk + zest-yield-manager: no cli.ts files. SKILL.md uses `entry:` field pointing to `.ts` directly. Deviates from arc standard 4-file pattern. Not a bug — arc skills run works with `entry:` metadata — but creates inconsistency with skills that use cli.ts wrappers. Low priority.
- **[WATCH]** ordinals HookState: 4 deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — cleanup 2026-04-23+ (7th carry-forward).
- **[INFO]** ordinals flat-market fallback (+222 lines): still active through competition (2026-04-22). Evaluate post-competition.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (5th carry-forward).

### Step 3 — Simplify

- **nonce-manager queue-check: correct scope** — 25 lines, one fetch, clean exit. Handles a local relay endpoint without touching the upstream nonce oracle. Right size.
- **hodlmm-risk is correctly thin**: SKILL.md + AGENT.md + entry ts file. No sensor, no cli wrapper. Pool risk is purely read-on-demand. The volatility formula (bin spread 40% + reserve imbalance 30% + concentration 30%) is documented and deterministic.
- **zest-yield-manager has complexity budget**: 551 lines for supply/withdraw/claim + pre-flight checks + MCP command output. Justified for a write-capable mainnet skill. Pre-flight checks (gas, balance, spend limit) are the right pattern — validate before broadcasting.
- **skills-v0.36.0 pattern**: Both competition-winner skills use `entry:` metadata instead of `cli.ts` wrappers. This is a divergence from arc's 4-file standard but consistent within the competition skill set. If more competition skills are installed, the pattern divergence will grow. Consider either (a) wrapping with cli.ts at install time or (b) documenting `entry:` as an accepted alternative.

### Step 4 — Accelerate

- **queue-check closes relay debugging gap**: Dispatch agents hitting NONCE_CONFLICT can now inspect `/queue/{address}` to see what's stuck before deciding to flush-wallet or wait. Expected: fewer blind-retry cycles.
- **hodlmm-risk enables automated LP risk gating**: Before this skill, no programmatic volatility check existed before LP actions. With it, agents can gate supply/withdraw on regime score.
- **zest-yield-manager enables sBTC yield automation**: Arc holds sBTC. Idle capital has opportunity cost. Yield automation throughput is currently zero — sensor absent. One sensor.ts would convert this to autonomous yield management.

### Step 5 — Automate

- **zest-yield-manager sensor** (new action): Build `skills/zest-yield-manager/sensor.ts` — check Arc's sBTC balance, current Zest position, pending wSTX rewards. If idle sBTC > threshold → queue supply task. If rewards claimable → queue claim task. P7, Sonnet. Create follow-up.
- **Cleanup batch (2026-04-23+)**: ordinals HookState deprecated fields, flat-market fallback evaluation, countSignalTasksToday() divergence, layered-rate-limit sensor migration. Deferred — competition still active.

### Flags

- **[OK]** epoch-3.4 guard removed (313d6b49). [WATCH] from 3 audit cycles CLOSED.
- **[OK]** nonce-manager queue-check wired (f2205d80). Relay queue visibility for NONCE_CONFLICT debugging.
- **[OK]** hodlmm-risk installed (42318621). Read-only HODLMM volatility monitor. No sensor — correct.
- **[OK]** zest-yield-manager installed (42318621). sBTC yield management (supply/withdraw/claim). Mainnet-only, write-capable.
- **[WATCH]** zest-yield-manager: no sensor — yield optimization not autonomous. Build sensor.ts (follow-up created).
- **[WATCH]** hodlmm-risk + zest-yield-manager: no cli.ts — uses `entry:` metadata pattern. Inconsistency with standard 4-file pattern. Low priority.
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (7th carry-forward).
- **[WATCH]** ordinals flat-market fallback (+222 lines): evaluate post-competition (2026-04-23+).
- **[INFO]** Sensor count: 68 (unchanged). Skill count: 101 (was 99, +hodlmm-risk +zest-yield-manager).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (5th carry-forward).
- **[INFO]** layered-rate-limit sensor migration (3 sensors) — post-competition 2026-04-23+ (4th carry-forward).

---

## 2026-03-28T06:13:00.000Z — Nonce oracle + flat-market fallback + CI model lint

**Task #9425** | Diff: 6da4625 → b8e6595 | Sensors: 68 | Skills: 99

### Step 1 — Requirements

- **nonce-manager skill** (6ec36831): Traces to p-wallet-nonce-gap — concurrent dispatch cycles each call Hiro API for current nonce, race on the same value, and broadcast conflicting transactions. Observed: nonce 540 stuck 8h+, 20+ transactions stalled. Fix: mkdir-based cross-process file lock at `~/.aibtc/nonce-state.json` ensures single-writer nonce claims. Correct scope: new skill with SKILL.md + AGENT.md + cli.ts. No sensor needed (on-demand oracle, not a polling job). Requirement satisfied.
- **ordinals flat-market fallback** (a8af8f5e): Traces to competition Day-5 (2026-03-27) where all ordinals categories were below threshold — no signal filed, quota wasted. Fix: when competition active + daily allocation not met + all thresholds zero → file stability signal. "Stability is data" is a valid editorial stance. Also fixes angle rotation not advancing on zero-signal path — angle would reset rather than rotate, causing pattern repetition. Requirement valid.
- **CI model lint: lintModelField()** (05ebbbde): Traces to p-sensor-model-required + 7 consecutive audit carry-forwards. The pattern was documented and validated but enforcement was manual (grep + human review). Fix: lintModelField() runs in safe-commit.ts pipeline after syntax check, before commit. Failures block commit and create follow-up tasks. Requirement satisfied. This carry-forward is CLOSED.
- **quorumclaw skip-on-pause** (eaa40bfa): Traces to p-paused-sensor-task-leak — QuorumClaw sensor was creating 12+ "sensor paused" alert tasks/day despite being in a paused state. Root cause: dedup checked for pending tasks, but failed alert tasks leave status=failed (not pending), so dedup passed on every cycle. Fix: return "skip" before any task creation when at failure threshold. Requirement satisfied.
- **arc-workflows stale-lock skill load** (073ed91e): Traces to stale-lock health alert tasks dispatching without the arc-housekeeping skill context. Agent lacked lock recovery instructions. Fix: add arc-housekeeping to skills list. Correct.

### Step 2 — Delete

- **[OK]** CI model lint carry-forward CLOSED (7th cycle). lintModelField() now enforced at commit time. No more manual grep required.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — still present (6th carry-forward). Cleanup 2026-04-23+.
- **[WATCH]** epoch-3.4 guard in stacks-stackspot sensor — dead code after block 943,500 (~2026-04-04). Schedule removal task.
- **[WATCH]** ordinals flat-market fallback adds 222 lines to sensor.ts. After competition ends (2026-04-22), evaluate whether stability signals have value outside competition context. If not, delete fallback logic.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (4th carry-forward).

### Step 3 — Simplify

- **lintModelField() has correct scope**: 75 lines in safe-commit.ts. Scans staged TS files via Bun's AST (not regex). Runs inline with syntax check. No new abstraction needed.
- **Flat-market fallback is the outlier at +222 lines**: Large for a fallback path. Justified during competition window — but watch for conditional proliferation. The `buildFlatMarketSignal()` function's category-selection logic (fees > inscriptions > runes > brc20 > nft-floors by history depth) is sound. Post-competition: evaluate vs. just skipping flat days entirely.
- **nonce-manager skill is correctly thin**: cli.ts is a 41-line wrapper calling upstream CLI. SKILL.md + AGENT.md provide context. No sensor, no state in arc-starter beyond the skill files. The actual nonce state lives at `~/.aibtc/nonce-state.json` (upstream).

### Step 4 — Accelerate

- **CI model lint catches regressions at commit time**: Previously, a modelless insertTask call would reach dispatch (potentially days later) before failing with "No model set." Now: fails at commit, follow-up task created immediately. Expected: ~0 modelless-task failures going forward.
- **quorumclaw skip-on-pause removes ~12 task/day noise**: Was polluting failure counts and consuming dispatch cycles on tasks that would always fail. Net: ~12 dispatch slots freed per day while QuorumClaw is down.
- **Flat-market fallback ensures 6/6 on stable market days**: Previously a flat ordinals day meant 0 ordinals signals filed. Now at least 1 stability signal can be queued (6h cooldown, not 60min beat cooldown — may enable 2 per day if market stays flat).

### Step 5 — Automate

- **Epoch-3.4 guard cleanup**: Guard in stacks-stackspot becomes dead code after burn block 943,500 (~2026-04-04). Create follow-up task to remove it 2026-04-10+.
- **Post-competition cleanup batch**: Flat-market fallback, deprecated HookState fields, layered-rate-limit sensor migration, countSignalTasksToday() divergence — all scheduled 2026-04-23+. Bundle into a single task batch to avoid queue pollution.
- **Layered-rate-limit sensor migration** (3rd carry-forward): `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` still use deprecated layered-rate-limit pattern. Post-competition 2026-04-23+.

### Flags

- **[OK]** nonce-manager skill installed (6ec36831). p-wallet-nonce-gap FIXED (cross-process file locking).
- **[OK]** ordinals flat-market fallback active (a8af8f5e). Stability signals now file on flat-market competition days.
- **[OK]** CI model lint: lintModelField() in safe-commit.ts (05ebbbde). 7-cycle audit carry-forward CLOSED.
- **[OK]** quorumclaw skip-on-pause fix applied (eaa40bfa). p-paused-sensor-task-leak pattern CLOSED for this sensor.
- **[OK]** arc-workflows stale-lock alerts now load arc-housekeeping skill (073ed91e).
- **[OK]** defi-zest SKILL.md updated with MCP tools section (b8e65952).
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (6th carry-forward).
- **[WATCH]** epoch-3.4 guard: dead code after block 943,500 (~2026-04-04). Remove 2026-04-10+.
- **[WATCH]** ordinals flat-market fallback (+222 lines): revisit post-competition (2026-04-23+). Delete if no value outside competition.
- **[INFO]** Sensor count: 68 (unchanged). Skill count: 99 (nonce-manager added).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+ (4th carry-forward).
- **[INFO]** layered-rate-limit sensor migration: 3 sensors still on deprecated pattern — post-competition 2026-04-23+ (3rd carry-forward).

---

## 2026-03-27T21:35:00.000Z — Fleet cleanup + beat slug migration + workflow machines

**Task #9275** | Diff: 1955a04 → ee4919b | Sensors: 68 | Skills: 98

### Step 1 — Requirements

- **Fleet cleanup** (26b125e4 → 04b5e196): Traces to fleet suspension (Spark/Iris OFFLINE, workers decommissioned). 46 files, ~2100 lines removed — SOUL.md, CLAUDE.md, MEMORY.md, 14 skill files, web dashboard, templates, docs, scripts. Arc now runs solo. All fleet context references gone. State machine diagram was already updated in prior cycle to not show fleet context in BuildPrompt. Requirement: remove dead context, free token budget. Satisfied.
- **ordinals beat slug → agent-trading** (815f72be): Traces to agent-news PR #314 — network-focus migration from 17 to 10 beats, renaming `ordinals` → `agent-trading`. Competition scores don't register against the old slug. Sensor now uses `countSignalTasksTodayForBeat("agent-trading")`. Required for competition ROI. Satisfied.
- **ordinals minimum fee threshold** (06d86211): Traces to fee-market signal noise — low-fee readings produced signals with no editorial value, consuming quota. Quality gate filters below-threshold fees before task creation. Requirement: signal quality. Satisfied.
- **quorumclaw sensor handling** (5e45c392 + 37d1ad83): Traces to Railway API deprovisioning. Sensor disabled at 10 failures, then re-enabled with updated API_BASE. Still returns 404 — failure-state.json at 10 failures, polling paused. Requirement: surface failures cleanly without alert fatigue (p-external-api-migration). Partially satisfied — sensor is dormant, needs new URL to fully unblock.
- **FailureRetrospectiveMachine + HumanReplyMachine** (d78912a0): Traces to recurring pattern detection (4 recurrences each). FailureRetrospectiveMachine: daily triage → fix → learnings. HumanReplyMachine: human-feedback → action → retrospective. Instance keys prevent concurrent duplication. Requirement: eliminate ad-hoc fan-out tasks for these patterns. Satisfied.
- **ALB x402 metering** (037f9e25 + d5757511): Traces to Arc's own platform needing to bypass its own metering. Admin API key header skips meter; external consumers are still metered. Requirement: owner access + revenue metering for others. Satisfied.
- **arc-email-sync opus** (bd66860a): Traces to whoabuddy emails requiring strategic analysis (not routine composition). Correct model escalation. Requirement satisfied.

### Step 2 — Delete

- **[OK]** Fleet context layer removed: 46 files, ~2100 lines. BuildPrompt is now 5 clean steps. Largest deletion since v5. Prior [WATCH] entries for fleet CLOSED.
- **[WATCH]** ordinals HookState deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`) — still present, 5th carry-forward. Cleanup 2026-04-23+.
- **[WATCH]** quorumclaw sensor dormant at 10 failures. failure-state.json blocks further polling. New URL needed; until then, sensor is dead code in the sensor runner (runs, checks gate, exits). Low cost (~1ms/cycle) but creates false impression of active monitoring. Acceptable until URL surfaces.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — 4th carry-forward. Post-competition 2026-04-23+.

### Step 3 — Simplify

- **Fleet removal is the simplification**: BuildPrompt went from 6 steps to 5, MEMORY.md trimmed by ~65 lines, dispatch.ts lost `resolveFleetKnowledge()`, `loadFleetIndex()`, `FleetEntry`/`FleetIndex`. Context budget freed on every dispatch.
- **Beat slug rename with no abstraction change**: `ordinals` → `agent-trading` is a string change in 2 places. No new functions, no new state. Correct scope.
- **FailureRetrospectiveMachine + HumanReplyMachine follow established 4-state pattern**: Both mirror the validated triage→action→learning→complete shape. No new abstractions. Each has a clear instance_key preventing duplication.
- **Diagram gap**: 4 sensors not categorized in state-machine.md (bitcoin-quorumclaw, contacts, paperboy, stacks-stackspot). Added to OtherSensors group in this cycle.

### Step 4 — Accelerate

- **Fleet removal frees context on every dispatch**: ~2100 lines of fleet context no longer loaded anywhere in the system. Every dispatch cycle is slightly leaner.
- **Beat slug fix unblocks competition score accumulation**: Signals filed under wrong slug were silently not counting toward competition score. Fix is direct ROI.
- **Minimum fee threshold**: Prevents waste of 1 competition signal slot per day on below-threshold fee readings. Preserves quota for high-value ordinals/inscriptions/runes signals.
- **Bottleneck still present**: competition signal throughput ~1-3/day; target is 6/day. Beat cooldowns (60 min) and sensor cadence (4h) create a structural ceiling. No immediate fix needed — sensor architecture already optimized (all-5-categories per run). Cooldowns are quality gates, not bottlenecks.

### Step 5 — Automate

- **Sensor model lint** (7th carry-forward): grep `insertTask`/`insertTaskIfNew` without `model:` field. Still not implemented. 7 cycles of carry-forward is a signal: create a follow-up task, not just another carry-forward entry.
- **Layered-rate-limit sensor migration** (2nd carry-forward): `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` still use deprecated layered-rate-limit pattern. Post-competition 2026-04-23+.
- **quorumclaw URL discovery**: No automation possible without external signal (GitHub, email, API probe). Monitor via quorumclaw sensor — no manual action needed until URL surfaces.

### Flags

- **[OK]** Fleet cleanup complete — 46 files, ~2100 lines removed. Arc runs solo. Prior fleet [WATCH] entries CLOSED.
- **[OK]** ordinals beat slug → `agent-trading` migrated. Competition score accumulation unblocked.
- **[OK]** ordinals minimum fee threshold added. Signal quality gate in place.
- **[OK]** FailureRetrospectiveMachine + HumanReplyMachine registered in arc-workflows.
- **[OK]** ALB x402 metering + admin API key bypass operational.
- **[OK]** arc-email-sync → opus for whoabuddy emails.
- **[OK]** identity-guard + email-sync dead code removed.
- **[WATCH]** quorumclaw API still down (Railway 404). Sensor dormant at 10 failures. Unblock: new URL → update API_BASE in sensor.ts + cli.ts → delete failure-state.json.
- **[WATCH]** ordinals HookState: 4 deprecated fields — cleanup 2026-04-23+ (5th carry-forward).
- **[ACTION]** Sensor model lint CI rule: 7th carry-forward. Create follow-up task (P8, Haiku).
- **[INFO]** Sensor count: 68 (was 67 — contacts sensor added). Skill count: 98 (unchanged).
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.
- **[INFO]** epoch-3.4 guard in stacks-stackspot becomes dead code after block 943,500 (~2026-04-05). Remove 2026-04-10+.

---

## 2026-03-27T06:16:00.000Z — Unisat API repair + epoch guard + paperboy + dispatch headless

**Task #9171** | Diff: 9cc7a12 → 1955a04 | Sensors: 67 | Skills: 98

### Step 1 — Requirements

- **ordinals Unisat API repairs** (f5b16985): Traces to 3 categories failing silently in competition. `/inscription/info/recent` (requires inscriptionId param not provided), `/brc20/list` (returns string array not object), `/runes/list` (404). All 3 were dead API calls introduced before the current Unisat spec. The fix correctly shifts to reusing status endpoints that already return the needed fields. All 5 categories now produce readings. Competition impact: 6/6 daily cap unblocked for inscriptions/brc20/runes beats. Requirement valid.
- **stacks-stackspot epoch 3.4 guard** (1955a04): Traces to Stacks epoch 3.4 activation at burn block 943,333 (~2026-04-02). Any StackSpot pot started in prepare phase (begins 943,150) would lock STX through the transition. Guard window [943,050–943,500] is conservative and correct — 100 blocks before prepare start, 167 blocks after activation. Auto-lifts. Requirement: protect STX from epoch disruption risk. Valid. Time-limited.
- **AskUserQuestion autoanswer hook** (80628eff): Traces to dispatch stalls when Claude Code invokes AskUserQuestion with no human present. Without the hook, the task either hangs or fails. The hook provides safe defaults (proceed, sonnet, first option, no escalation) and resolves in 5s. Requirement: headless dispatch reliability. Valid.
- **paperboy skill** (f0f098eb): Traces to D1 (revenue) + Tiny Marten AMBASSADOR invitation. 500 sats/placement, 2000 sats/new correspondent. New D1 revenue stream alongside competition earnings. Requirement valid. Incomplete: no sensor for payout/delivery tracking yet.
- **arc-inbox block-height fix** (c20b444c): Deprecated Clarity builtin `block-height` replaced with `stacks-block-height`. Required for post-epoch contract compatibility. Requirement satisfied.

### Step 2 — Delete

- **[WATCH]** ordinals HookState `lastRuneTopIds`, `lastRuneHolders` — marked DEPRECATED in interface (f5b16985). Still present in the type; no write sites remain. Remove from interface post-competition (2026-04-23+).
- **[WATCH]** ordinals HookState `lastCategory` — declared in HookState interface and used as initial default (`{ lastCategory: -1, lastAngle: -1 }`) but never read or written after initialization. Dead field since category rotation was removed (9cc7a120). Remove post-competition.
- **[WATCH]** ordinals HookState `lastSignalQueued` — still present (5th carry-forward). Still marked DEPRECATED with comment. Remove post-competition.
- **[INFO]** epoch-3.4 guard code in stacks-stackspot sensor adds one Hiro API call per 7-min run for ~2 weeks. After block 943,500 (~2026-04-05), the guard is dead code. Schedule removal task for 2026-04-10+.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence (carry-forward). Post-competition cleanup.

### Step 3 — Simplify

- **Unisat sensor net -83 lines**: Removing 3 broken list-endpoint calls in favor of reusing the status endpoint data already being fetched is the right simplification. Zero new abstractions; sensor is smaller and more reliable.
- **AskUserQuestion hook is 54 lines of bash**: Correct size for the task. Pattern-matching question text → safe default. No over-engineering.
- **paperboy SKILL.md has open TODO**: "Add sensor to track weekly payout state and delivery count." This is not optional — without it, Arc has no visibility into delivery counts or payout timing. Sensor is missing on day 1.
- **3 deprecated HookState fields** in ordinals (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`): dead state in the interface. Each adds cognitive overhead when reading the type. Cleanup post-competition.

### Step 4 — Accelerate

- **Unisat fixes unblock 3 competition categories**: Before fix, inscriptions/brc20/runes were failing silently, blocking 3 of 5 signal types. After fix, all 5 reach the task queue. Expected throughput: Day-5+ should hit 6/6 cap for ordinals beat.
- **AskUserQuestion hook removes stall risk**: Any task that previously caused a dispatch stall due to AskUserQuestion now auto-resolves in 5s. Net cycle time improvement scales with how often AskUserQuestion fired.
- **Epoch guard adds latency to stacks-stackspot**: One Hiro fetch per 7-min sensor run adds ~100-300ms. Acceptable cost for protection during a 2-week window.

### Step 5 — Automate

- **paperboy sensor** (new): Arc needs a sensor to track weekly delivery count and payout state. Without it, revenue tracking for D1 is manual. Create follow-up task: add `skills/paperboy/sensor.ts` to monitor delivery log and payout readiness. P7, Sonnet.
- **epoch guard cleanup task**: Schedule `remove epoch-3.4 guard from stacks-stackspot sensor` for execution after 2026-04-10. P9, Haiku.
- **Sensor model lint** (6th carry-forward): `grep insertTask/insertTaskIfNew without model:` — one CI lint rule prevents regression. P8, Haiku. Still not implemented.

### Flags

- **[OK]** ordinals Unisat API: all 5 categories producing readings post-fix (f5b16985). Competition unblocked.
- **[OK]** epoch-3.4 guard active and correct. Auto-lifts at burn block 943,500.
- **[OK]** AskUserQuestion PreToolUse hook wired in `.claude/settings.json`. Dispatch is fully headless.
- **[OK]** paperboy skill enrolled. SKILL.md + cli.ts present.
- **[OK]** arc-inbox `block-height` → `stacks-block-height` contract fix applied.
- **[WATCH]** paperboy sensor missing — create follow-up task (P7, Sonnet).
- **[WATCH]** epoch-3.4 guard becomes dead code after block 943,500 (~2026-04-05). Remove 2026-04-10+.
- **[WATCH]** ordinals HookState: 4 deprecated fields (`lastSignalQueued`, `lastCategory`, `lastRuneTopIds`, `lastRuneHolders`). Cleanup 2026-04-23+.
- **[INFO]** Sensor count: 67 (unchanged). Skill count: 98 (was 97, paperboy added).
- **[INFO]** Sensor model lint CI rule (6th carry-forward). P8 Haiku.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.

---

## 2026-03-26T18:20:00.000Z — ordinals all-5-categories + sensor pattern consolidation

**Task #9048** | Diff: ab4f520 → 9cc7a12 | Sensors: 67 | Skills: 97

### Step 1 — Requirements

- **ordinals-market-data all-5-categories refactor** (9cc7a120): Traces to competition rotation gap — Day-2 (3/6) and Day-3 (partial) lost signals because the 2-of-5-category rotation didn't reach all categories within the daily window. The 4h sensor cadence + 2-category-per-run logic mathematically required 10h to cover all 5 categories once, creating gaps. The fix (fetch all 5 per run, rely on per-category pending dedup) eliminates the rotation gap entirely. The daily allocation cap (3/day ordinals via `countSignalTasksTodayForBeat`) is the correct single throttle. Requirement satisfied.
- **arc-link-research `devToolTags` wired** (cli.ts): Previous [WATCH] said `devToolTags` field was dead computation. Review of current code shows `routeDevToolsSignal()` is called at line 668 when high-relevance dev-tool links are found, creating a `File dev-tools signal from research` task. Requirement satisfied — field is actively consumed.
- **patterns.md update**: 3 patterns added from x402-sponsor-relay review. "Single authoritative quota over layered rate limits" directly documents the ordinals refactor rationale. "Proactive deadline-critical task filing" addresses competition signal timeout risk (sonnet 15min limit). Both patterns validated by recent incidents. Requirement valid.

### Step 2 — Delete

- **[OK]** `arc-link-research` `devToolTags` dead computation — RESOLVED. `routeDevToolsSignal()` is called. Previous [WATCH] CLOSED.
- **[WATCH]** `lastSignalQueued` field in ordinals HookState interface (`sensor.ts:104`) — sensor no longer writes it (both write sites removed in 9cc7a120). The migration check (`if (!state.lastOrdinalSignalQueued && state.lastSignalQueued)`) was also removed. Field is now truly dead in the interface. Cleanup 2026-04-23+.
- **[WATCH]** `isDailySignalCapHit()` and `recentTaskExistsForSourcePrefix()` still exported from `src/db.ts` and used by `defi-stacks-market/sensor.ts`, `aibtc-news-editorial/sensor.ts`, and `aibtc-news-deal-flow/sensor.ts`. Not dead — but these sensors use the old "layered rate limits" pattern that was deprecated in patterns.md. Post-competition opportunity to migrate these 3 sensors to the single-quota pattern.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence (carry-forward 3rd cycle): still present. ordinals no longer uses the global counter; it uses per-beat. Post-competition simplification.

### Step 3 — Simplify

- **ordinals sensor: 35 lines removed, no rotation state**: `startIdx`, `lastCategory`, `RATE_LIMIT_MINUTES`, `MAX_SIGNALS_PER_RUN`, hook-state timestamp writes for cooldown, legacy migration block — all gone. The sensor now has a single clear invariant: "fetch all, dedup via pending check, cap via daily allocation." This is the right shape for a sensor.
- **Layered-rate-limit inconsistency across sensors**: ordinals now uses single-quota; defi-stacks-market, aibtc-news-editorial, and aibtc-news-deal-flow still use `isDailySignalCapHit()` + `recentTaskExistsForSourcePrefix()` layered checks. The patterns.md update marks the old pattern deprecated. These 3 sensors are now architecturally inconsistent with ordinals. Not a bug today, but creates pattern divergence risk — new sensor authors copying aibtc-news-deal-flow will reintroduce the old pattern.
- **`inferCategoryFromHeadline` default "general"** (carry-forward 2nd cycle): still returns "general" for unmatched headlines. 2 dev-tools signals were filed overnight successfully (#8934, #8969) — if server validation had rejected "general", those would have failed. Either "general" is valid or those signals matched a keyword. Check the aibtc.news API schema to close this. Low priority.

### Step 4 — Accelerate

- **Rotation gap eliminated**: All 5 categories can now reach their daily quota independently. Under the old 2-category-per-run scheme, a 4h sensor cadence meant 3 categories per 12h window. With all-5-fetch, each 4h run checks all categories and queues any that have new material. Expected signal throughput improvement: 5→6/day possible without manual intervention.
- **Fewer hook-state reads/writes per sensor run**: ordinals sensor removed 3 sequential operations (hook-state timestamp check, legacy migration check, DB source-prefix query). Minor cycle-time improvement.
- **per-category dedup is O(1) DB query**: `pendingTaskExistsForSource(source)` is a single indexed SELECT. The removed multi-layer checks involved 2 hook-state file reads + 1 DB query. Net: same dedup safety, fewer I/O operations.

### Step 5 — Automate

- **Sensor pattern lint** (carry-forward 5th cycle): grep `insertTask`/`insertTaskIfNew` without `model:` field. One CI lint rule prevents modelless-task regressions. P8, Haiku. Still not implemented.
- **Layered-rate-limit sensor migration** (new): Once competition ends, migrate `defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow` from `isDailySignalCapHit()` + `recentTaskExistsForSourcePrefix()` to single-quota pattern. P9, Haiku. Schedule for 2026-04-23+.

### Flags

- **[OK]** ordinals-market-data rotation gap closed — all-5-categories per run (9cc7a120). Competition signal throughput unblocked.
- **[OK]** arc-link-research `devToolTags` wired to `routeDevToolsSignal()`. Previous [WATCH] CLOSED.
- **[WATCH]** `lastSignalQueued` interface field still present but no longer written. Remove 2026-04-23+.
- **[WATCH]** 3 sensors (`defi-stacks-market`, `aibtc-news-editorial`, `aibtc-news-deal-flow`) still use deprecated layered-rate-limit pattern. Migrate post-competition.
- **[INFO]** `inferCategoryFromHeadline` default "general" — 2 dev-tools signals filed OK overnight; likely "general" is valid or signals matched keywords. Low priority to verify.
- **[INFO]** Sensor model lint CI rule (5th carry-forward). P8 Haiku.
- **[INFO]** `countSignalTasksToday()` vs `countSignalTasksTodayForBeat()` divergence — cleanup 2026-04-23+.
- **[INFO]** `src/identity.ts` `AGENT_NAME` — confirmed still imported by `src/db.ts` and `IDENTITY` by `src/web.ts`. NOT dead. Previous [WATCH] from 2026-03-26T06:27Z CLOSED.
- **[INFO]** $100K competition day 4 (2026-03-26). Score 12pts, streak 1. Rotation gap closed — 6/6 target achievable today.

---

## 2026-03-26T06:27:00.000Z — Fleet context layer removal + modelless-task fix

**Task #8959** | Diff: 10214a9 → ab4f520 | Sensors: 67 | Skills: 97

### Step 1 — Requirements

- **Fleet context layer stripped from dispatch** (b73f1a21 + preceding): Traces to fleet suspension (Spark/Iris OFFLINE, workers decommissioned). `resolveFleetKnowledge()` loaded `memory/fleet-learnings/index.json` to inject skill-matched fleet learnings into each dispatch prompt. With fleet suspended, the index has no live writers — dead context with real token cost. Removal correct. `fleet_messages` table had no active producers. `fleet-status.ts` and `fleet-web.ts` had no active consumers after fleet skills were deleted. All removed cleanly.
- **`WORKER_SENSORS` allowlist removed**: Worker-specific sensor branching (`AGENT_NAME !== "arc0"` guard) removed along with the allowlist. With no workers running, the code path was unreachable. Requirement no longer active.
- **`model: "sonnet"` on all follow-up insertTask calls** (5c7325e7): Traces to `p-syntax-guard-modelless` pattern — infrastructure follow-up tasks (syntax errors, health check alerts, experiment probes) were created without `model` field, failing silently at dispatch. Fix is correct scope: exactly the insertTask sites in safe-commit.ts, dispatch.ts, experiment.ts, web.ts. No pattern changes needed now that all sites are explicit.
- **fix(context-review)** (ab4f5201): aibtc-inbox-sync now routes editorial threads (inbox messages about ordinals/news topics) to tasks with `aibtc-news-editorial` skill. arc-opensource SKILL.md was stale — still referenced deleted `fleet-handoff` skill. context-review skip list now includes "Retry:" prefix (retry tasks carry resend context, not skill execution). 7 issues closed.

### Step 2 — Delete

- **[OK]** Fleet context layer removed: `resolveFleetKnowledge()`, `loadFleetIndex()`, `FleetEntry`/`FleetIndex` types, `fleet_messages` DB table, `src/fleet-status.ts`, `src/fleet-web.ts`, `src/ssh.ts` — all gone.
- **[OK]** `WORKER_SENSORS` allowlist and `GITHUB_TASK_RE` regex removed from dispatch/sensors.
- **[WATCH]** `arc-link-research/cli.ts` `devToolTags` field — still dead computation (no caller reads it to route to a dev-tools signal task). Either wire to task creation or remove.
- **[WATCH]** `lastSignalQueued` deprecated field still in ordinals HookState interface type. Cleanup post-competition (2026-04-23+).
- **[WATCH]** `src/identity.ts` `AGENT_NAME` removed from dispatch and sensors — verify identity.ts is still consumed elsewhere or mark for deletion.

### Step 3 — Simplify

- **BuildPrompt is now 5 steps**: SOUL → CLAUDE → MEMORY(ASMR) → Skills → Task. Removed the fleet context step that was architecture overhead. Context token budget freed.
- **Dispatch no longer branches on agent identity**: No more `if (AGENT_NAME !== "arc0")` guard. All dispatch cycles follow the same path. Simpler invariant.
- **countSignalTasksToday() vs countSignalTasksTodayForBeat() divergence** (carry-forward): Global counter matches 5 subject patterns; per-beat matches 2. If milestone subject forms grow, per-beat may undercount. Post-competition review.

### Step 4 — Accelerate

- **Smaller dispatch prompt**: Fleet knowledge step loaded up to 20 fleet-learning entries per task. Now gone — every dispatch cycle starts with a slightly smaller context load. Marginal but real.
- **Modelless follow-up tasks eliminated**: Previously ~35 infrastructure follow-up tasks/day failed at dispatch (from p-syntax-guard-modelless). Now 0. That's 35 dispatch slots freed per day.

### Step 5 — Automate

- **Sensor model field lint** (carry-forward, 3rd cycle): grep all `insertTask`/`insertTaskIfNew` calls without `model:` field. One CI lint rule prevents model-missing regressions. P8, Haiku. Still not implemented.
- **No new automation candidates identified.**

### Flags

- **[OK]** Fleet context layer removed from dispatch. BuildPrompt: 5 steps (was 6).
- **[OK]** `model: "sonnet"` on all infrastructure insertTask follow-up calls. modelless-task pattern CLOSED.
- **[OK]** Fleet skill deletions committed (b73f1a21). Previous [ACTION, P7] from 2026-03-25 audit CLOSED.
- **[OK]** fix(context-review): 7 sensor routing issues resolved.
- **[WATCH]** `arc-link-research` `devToolTags` — dead computation, no consumer. Wire or remove.
- **[WATCH]** `lastSignalQueued` deprecated ordinals HookState field — cleanup 2026-04-23+.
- **[WATCH]** `src/identity.ts` — verify still consumed after AGENT_NAME removal from dispatch/sensors.
- **[INFO]** `inferCategoryFromHeadline` default "general" (carry-forward) — verify valid aibtc.news category before next dev-tools signal.
- **[INFO]** Sensor model lint CI rule still pending (3rd carry-forward). P8 Haiku.
- **[INFO]** $100K competition day 4 (2026-03-26). Score 12pts, streak 1. Daily target: 6/6 signals.

---

*(2026-03-25 and older entries archived to archive/audit-log-2026-03-25-and-older.md)*
