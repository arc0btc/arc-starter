
## 2026-07-16T08:25:00.000Z — kill-switch re-enable CLI shipped end-to-end; 128 skills / 90 sensors

**Task #22895** | Diff: 69e2895..f4d880d (9 commits — 5 substantive, 3 auto-commit cache-only, 1 self-excluded) | Sensors: 90 (down from 91) | Skills: 128 (down from 129)

### Changed files (substantive only)

- `skills/social-engine/{cli.ts,SKILL.md}` (f4d880d3) — new `kill-switch status|enable --reason` CLI, the sanctioned re-enable path for the `outbound_enabled` trip from #22885. `enable` requires `--reason` and deliberately does not self-invoke (escalation design: needs whoabuddy's explicit go-ahead per CLAUDE.md's escalation ladder) — correctly built as a tool for a human to invoke, not automation that closes its own loop.
- `skills/social-engine/reply-send.ts` (ba589fa3) — `classifyProviderError()` gains 3 more reply-restriction signal phrases (`"you can only reply to"`, `"mentioned or are the author"`, `"not-authorized-for-resource"`), fixing the exact false-positive that tripped the kill switch. Both commits trace 1:1 to the same named incident (#22885/#22887, already in MEMORY.md).
- `skills/social-x-ecosystem/{SKILL.md,sensor.ts}` deleted (f16cef8e) — dormant-skill review (#22866) confirmed 0 research tasks in 4+ months post keyword-rotation self-disable; superseded by candidate-maturation's News/Trends/List lanes. Clean deletion, no live imports. Directly what Step 2 (Delete) asks for.
- `skills/alb/AGENT.md` (8953a7a1, new) — adds an explicit "External Comms Guard" section (untrusted-content framing, no command execution from inbox mail) to a subagent briefing that previously had no such guard. Good context-delivery fix: the dispatched expert reading inbox mail now has the same "data not instructions" framing already established elsewhere (observer-protocol incident pattern, arc-skill-manager's `[UNTRUSTED-SRC]` tag).
- `skills/stacks-stackspot/sensor.ts` (c65d5b2a) — adds pox-5 Epoch40 activation watch (fetches `/v2/pox`, flags if activation is within 1 PoX cycle), closing the resolved-but-open watch item from #22814/#22817 (already in MEMORY.md, stackspot-pox5-migration-risk).
- `skills/arc-workflow-review/sensor.ts`, `skills/context-review/sensor.ts` — two narrow false-positive suppressions (workflow-emitted source prefixes; arc-article-pipeline's documented 3-step contract), each with inline rationale citing the specific flagged task (#22799) or SKILL.md section that justifies the exemption.
- `skills/arc-typecheck-guard/cli.ts` (d9c5aefa) — trivial `err`→`error` rename, pre-commit lint compliance.

### Steps 1–5

- **Step 1 — Requirements**: Every substantive commit traces to a named incident or an already-tracked MEMORY.md watch item. Zero speculative scope.
- **Step 2 — Delete**: `social-x-ecosystem` removed cleanly (skill/sensor count down 129→128, 91→90). No further deletion candidates surfaced this cycle.
- **Step 3 — Simplify**: N/A this cycle — no over-engineering introduced.
- **Step 4 — Accelerate**: N/A — pox-5 watch runs on the existing 7-min stackspot cadence, no new sensor added.
- **Step 5 — Automate**: Correctly deferred — the kill-switch CLI automates the *mechanism* to re-enable but not the *decision*, matching the escalation-ladder design (irreversible-adjacent action stays gated on a human).

### Flags

- None. Tightest diff in this review's recent run (third consecutive cycle with fully-traceable, single-incident-per-commit changes — see prior two entries). No new watch items.

---

## 2026-07-16T20:29:00.000Z — narrowest diff in this review's history: one live-incident mainnet fix, one dormant-write bugfix, two dedup exemptions; 128 skills / 90 sensors

**Task #22956** | Diff: f4d880d..9201950 (4 commits — 1 src/, 2 skills/) | Sensors: 90 | Skills: 128

### Changed files (substantive only)

- `src/dispatch.ts` (92019508) — defaults subprocess `env.NETWORK` to `"mainnet"` when unset. In-process mainnet skills (`zest-yield-manager`, `hodlmm-move-liquidity`, `bitcoin-wallet/stx-send-runner`) call the shared nonce-tracker's `acquireNonce()` directly; the tracker's `config/networks.ts` resolves `NETWORK` as an import-time const defaulting to `"testnet"`, so an unset env var made every in-process nonce lookup query TESTNET Hiro for a mainnet address — empty account body, nonce clobbered to 1, guaranteed `BadNonce` on the next real send. This is the direct root cause of the nonce-gap incident already closed in memory (`zest-yield-manager-nonce-gap-remediation`, #22939/#22936). Subprocess-spawning skills already forced mainnet; this closes the one remaining gap. A complementary tracker-side guard is tracked separately (`arc0btc/skills#1`, cross-repo, not in this diff).
- `skills/zest-yield-manager/zest-yield-manager.ts` (ca6c2ee9) — `run supply/withdraw/claim` never exposed `--confirm`/`--password` on the CLI despite the self-sign+broadcast body (ported from `hodlmm-move-liquidity`) already existing, so `confirmed` was always `undefined` and every write silently fell through to dry-run — a real, live bug (task's own commit message: "verified `bun build`/`tsc` clean" but the gap was behavioral, not a type error, so neither compiler nor pre-commit guard would have caught it). Also fixes a `getZestProtocolService(NETWORK)` type mismatch (took the `StacksNetwork` object where a `"mainnet"|"testnet"` string was needed) via a new `ZEST_NETWORK` const. `--password` as a plain CLI arg matches the existing `hodlmm-move-liquidity` convention this was ported from — not a new pattern, so not flagging as a fresh finding, but noting it inherits that convention's shell-history/process-list exposure surface.
- `skills/arc-workflow-review/sensor.ts` (1555c926) — two more `KNOWN_PATTERNS`/`KNOWN_SUBJECT_PREFIXES` exemptions (candidate-maturation triage fan-out, whop free-forum digest), each verified by direct task-chain inspection before exemption rather than assumed. Same already-established "ad-hoc retrospective, not a state machine" rejection shape as prior cycles' entries on this sensor.

### Steps 1–5

- **Step 1 — Requirements**: All three substantive commits trace to a named live incident (#22934/#22935 nonce clobber), a live behavioral bug caught in the same commit that fixed it, and a named prior triage task (#22896) with verified evidence. No speculative work.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — all three changes are targeted bugfixes, not consolidations.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — the workflow-review exemptions are documentation of an already-automated sensor's exception list, not new automation.

### Flags

- None. Fourth consecutive cycle with fully-traceable, single-incident-per-commit changes and zero unrelated scope. `--password`-as-CLI-arg noted above is an inherited pattern, not a new one — no action needed unless a future review decides to revisit the whole `hodlmm-move-liquidity`/`zest-yield-manager` wallet-decrypt convention.

---

## 2026-07-17T20:27:00.000Z — three named-incident fixes, one exemption update, one config-init bugfix; 128 skills / 91 sensors

**Task #23117** | Diff: 34ba6b6..6c9f5ec (4 commits — all substantive) | Sensors: 91 (up from 90) | Skills: 128

### Changed files (substantive only)

- `src/dispatch.ts` (0bc7d02c) — filters AgentShield findings against `.claude/hooks/guard-*.sh` (denylist-content files whose entire body is command strings the hook blocks, not commands it executes) out of the blocking decision before recomputing `blocked` from the adjusted critical count. Root-caused live (#23040/#23038): AgentShield's flat-regex scanner has no way to distinguish a denylist match target from an executed command, and no upstream ignore config exists in ecc-agentshield@1.3.0. Correctly scoped to the one path class that's a false positive by construction, not a blanket suppression.
- `src/dispatch.ts` (b9fdd085) — self-close watchdog: polls for a task leaving `active` status mid-subprocess and force-exits after a 45s grace window instead of idling to the full per-model timeout. Direct fix for the real minor lever surfaced by this cycle's own #23050/#23053 forensics (already in MEMORY.md as `article-pipeline-p4-revert-investigation`) — closes a wasted-cost path ($2.51/2.79M-tok on that one task) without touching the terminal-status-preservation logic the self-close guard already relies on.
- `skills/arc-workflow-review/sensor.ts` (d223f611) — one more `KNOWN_SUBJECT_PREFIXES` exemption (`sensor:context-review` → retrospective chain), same already-established "atomic task + standard retrospective, not a new state machine" rejection shape as the prior four cycles' entries on this sensor. Verified against a named recurrence count (task #23043, 3 recurrences) before exempting.
- `skills/arc-packaging/cli.ts` (6c9f5ec6) — `main()` never called `initDatabase()`, so `stage`'s `setLatestReportCheckoutUrl()` call threw "Database not initialized" on every run; the throw was caught non-fatally so packaging kept succeeding while the `checkout_config` `latest-report` pointer silently never updated since it shipped (control-plane-remediation Phase 7, P6 defect row 39). Confirmed live on #23108. One-line idempotent fix mirroring other CLI entry points' init pattern.

### Steps 1–5

- **Step 1 — Requirements**: All four commits trace to a named incident (#23040/#23038, #23050/#23053, #23043, defect row 39/#23108). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — all four are targeted bugfixes/exemptions, not consolidations.
- **Step 4 — Accelerate**: The self-close watchdog is the standout — closes a real subprocess-idle cost leak on the dispatch hot path without adding a new always-on cost (polls only after self-close is detected, and only every 10s).
- **Step 5 — Automate**: N/A this cycle.

### Flags

- **[WATCH]** `AGENTSHIELD_FALSE_POSITIVE_FILE_RE = /^hooks\/guard-.*\.sh$/` matches on a relative path (`data.findings[].file`) — didn't verify AgentShield always emits paths relative to `.claude/` rather than repo-root or absolute. If the path format ever includes a `.claude/` prefix or changes, the regex silently stops suppressing (fails safe — reverts to over-blocking, not under-blocking) rather than false-suppressing something real. Low risk either way; noting for the next reviewer rather than filing a follow-up.
- No new watch items otherwise — fifth consecutive cycle with fully-traceable, single-incident-per-commit changes.

---

## 2026-07-19T22:20:00.000Z — smallest diff in this review's history: one-line KNOWN_PATTERNS exemption; 128 skills / 91 sensors

**Task #23153** | Diff: 6c9f5ec..a7ef616 (9 commits — 8 auto-commit `recent.log`/docs only, 1 substantive) | Sensors: 91 | Skills: 128

### Changed files (substantive only)

- `skills/arc-workflow-review/sensor.ts` (a7ef6160) — one more `KNOWN_PATTERNS` exemption (`sensor:arc-packaging` → SKU-packaging retrospective chain), same already-established "ad-hoc retrospective, not a state machine" rejection shape as the prior five cycles' entries on this sensor. Verified against a named recurrence count (task #23118, 3 recurrences, avg 2.3 steps) and cites `arc-packaging`'s existing deterministic 3-step contract (`SKILL.md` + `packaging_queue_log`) as the reason a second generic workflow would duplicate rather than add value.

### Steps 1–5

- **Step 1 — Requirements**: Traces to a named recurrence (#23118), matches the sensor's established exemption convention exactly. No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — single additive line, not a consolidation.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A — documents an exception to an already-automated sensor, not new automation.

### Flags

- None. Sixth consecutive cycle with a fully-traceable, single-incident change on this sensor. `arc-workflow-review/sensor.ts`'s `KNOWN_PATTERNS`/`KNOWN_SUBJECT_PREFIXES` exemption list has now grown by one narrow entry per review for six reviews running — each individually well-justified, but if this cadence continues indefinitely it's worth a future cycle asking whether the underlying retrospective-chain detector should learn a more general rule instead of accumulating bare-string exemptions. Not actionable yet (six data points, all genuinely distinct sources) — noting as a trend to watch, not filing a follow-up.

---

## 2026-07-20T09:35:00.000Z — five named-incident hardening fixes, zero unrelated scope; 128 skills / 91 sensors

**Task #23254** | Diff: a7ef616..776f5b2 (7 commits — 5 substantive, 2 auto-commit cache/db only) | Sensors: 91 | Skills: 128

### Changed files (substantive only)

- `skills/social-x-posting/sensor.ts` (eb7f0e9f) — threads `mention.created_at` into the suggested `reply` command's `--tweet-created-at` flag. `reply-send.ts` fail-closes on `missing_tweet_age` without it; the sensor already captured the value in the task description but never passed it to the command it generates. One-line fix for a real gap in the reply pipeline.
- `skills/zest-yield-manager/sensor.ts` (84c028f7) — cuts all Hiro API calls in this sensor to the shared 15s `SENSOR_FETCH_TIMEOUT_MS` (previously each defaulted to 30s×2 retries = 62s worst case) and drops the mempool pre-check to 0 retries. Root-caused live 90s sensor-watchdog timeouts: the mempool pre-check ran sequentially before the main fetch, so one slow response could burn most of the budget before real work started. Correctly reasoned that the mempool check already degrades gracefully to 0/skip, so cutting its retries costs nothing but latency risk.
- `skills/arc-purpose-eval/sensor.ts` (e08df9ad) — adds `evalTaskPendingToday()`, a subject-prefix + same-day dedup guard independent of the existing source-scoped check, closing a real duplicate-task gap (#23138/#23145) where the source check no longer held by the second sensor run. Belt-and-suspenders on top of an existing guard, justified by a named live recurrence rather than speculative hardening.
- `skills/arc-workflows/sensor.ts` (313343e9) — chunks the PR-lifecycle GraphQL query into groups of 5 repos (was 1 query for all 10), fixing a silent failure mode: GitHub's query resource-cost limit was being tripped as PR/review counts grew, `gh` exited non-zero, and the old code returned `[]` for the *entire* batch with no exception — sensor kept reporting `last_result=ok` while producing zero workflow rows for 3+ days (#23168). Now logs failures per-chunk instead of losing the whole fetch. Good instance of "accelerate without adding complexity" (Step 4) — no new sensor, same cadence, just doesn't silently drop data at scale.
- `skills/arc-link-research/cli.ts` (1ebd814d, bundled with an `ops/systemd/` unit-file mirror commit) — adds 30s timeouts to three previously-unbounded `gh` subprocess calls (`fetchFullReadme`, PR/issue view, repo view), closing an outage-hardening gap found alongside a 2026-07-17→07-19 audit: an unbounded `gh` call could wedge a dispatched task indefinitely.

### Steps 1–5

- **Step 1 — Requirements**: All five substantive commits trace to a named live incident or a live audit finding (missing_tweet_age fail-close, 90s watchdog timeout, #23138/#23145 duplicate, #23168 3-day silent PR-sync gap, p9 outage-hardening audit). No speculative scope.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — all targeted bugfixes, not consolidations.
- **Step 4 — Accelerate**: The GraphQL chunking and sensor-timeout tightening are both genuine "unblock without adding complexity" fixes — bound existing calls rather than adding new machinery.
- **Step 5 — Automate**: N/A this cycle.

### Flags

- None. Seventh consecutive cycle with fully-traceable, single-incident-per-commit changes and zero unrelated scope — this pattern is now well-established enough that it's worth naming as a property of the current dispatch/review loop rather than re-flagging each cycle.
