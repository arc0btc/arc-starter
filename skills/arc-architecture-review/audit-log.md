## 2026-07-17T08:36:00.000Z — control-plane-remediation defect-register batch lands (rows 12/15/18/49/56/57/58/59/61-63); 3 deletions/retirements, zero regressions found

**Task #23042** | Diff: 9201950..34ba6b6 (~35 commits — most are article-pipeline drafts/cache noise; ~15 substantive) | Sensors: 91 | Skills: 128 (audit CLI: 49 findings, 0 error/42 warn/7 info — unchanged backlog, see full dump below)

### Changed files (substantive only)

- `skills/social-x-posting/{cli.ts,lib/x-api.ts}` (c235db77) — three-part budget fix (defect rows 56/57/58): derives a read-only `budget_ledger_posts_today` field so `x-budget.json` stops undercounting reserved-group volume; dedups `x-budget-history.json` by date (was appending up to 6x/day pre-first-save); adds `LANE_READ_CAPS_USD` so `candidate-maturation` (measured burning ~76% of a day's global read budget in one run) can't starve other read lanes. All three live-verified.
- `skills/social-engine/reply-watchlist-sensor.ts` + `skills/social-x-posting/lib/x-api.ts` (c2afc159) — root-causes the idle reply lane (row 59): every reply candidate 07-14..07-16 hit a genuine `reply_settings != everyone` 403, burning a budget slot on a send that could never succeed. Now filters on the free `reply_settings` field before admission — same "don't dispatch doomed work" shape as 07-14's Phase 8 URL-expansion fix.
- `skills/nostr/lib/budget.ts`, `sensor.ts` (ec07a696) — new daily post-count ceiling (row 12), mirroring X's cap shape at a fraction of the complexity since Nostr has no spend to gate, only runaway-posting risk.
- `skills/x402-pull-loop/sensor.ts` (3c8ca1e6, new) — closes a genuine gap (row 18): the skill had no sensor at all, so its only sync cadence was "whoever remembers to run the CLI." New 60-min detect-and-queue sensor, no inline work in the tick.
- `skills/council-distill/sensor.ts` (4195a955) — repoints change-detection from a `gh api` HEAD-SHA watch on a retired coordination repo (always reported nothing new) to a local sha256 hash of a control-plane-delivered digest file (row 49) — removes the sensor's only network dependency entirely. Also clears a long-standing `COUNCIL_DISTILL_DRY_RUN` gate per its own in-file instruction.
- `skills/arc-packaging/{cli.ts,lib/cover.ts}` (b574916d, new dep `@resvg/resvg-js`) — requires cover art + a ≥3-question quiz before a Whop SKU auto-publishes (rows 61-63); the terminal publish step now fires only if both succeeded, closing the gap that shipped 13 visible SKUs with empty galleries and no quiz.
- `skills/ordinals-market-data/sensor.ts` (f921c054) + `skills/defi-stacks-market/sensor.ts` (029d3045) — two tombstone-pattern retirements (row 15; ~512 zero-signal runs over 128 days for the latter). Step 2 (Delete) activity this cycle.
- `skills/arc-daily-read/{sensor.ts,cli.ts}` (252eab84/86c9219b) — wires `finish-stuck` recovery into every 30-min sensor tick instead of leaving it a manual-only command; deliberately not LLM-dispatched since the bug it recovers from is an LLM turn getting killed mid-drain.
- `skills/social-x-posting/scripts/x-bio-daynp2.ts` removed (4ddb8369) — orphaned scratch script, clean deletion.

### Steps 1–5

- **Step 1 — Requirements**: Every substantive commit traces to a named defect-register row under the `control-plane-remediation` quest (rows 12, 15, 18, 49, 56-59, 61-63) or a live-diagnosed incident. No speculative scope.
- **Step 2 — Delete**: Best Step-2 showing in this review's recent history — two sensor retirements (ordinals-market-data, defi-stacks-market) plus one orphaned script removed, all with live-usage evidence cited in the commit message.
- **Step 3 — Simplify**: council-distill's repoint is the standout — trading a `gh api` network dependency that never worked for a local file read.
- **Step 4 — Accelerate**: The reply_settings filter and the candidate-maturation lane cap are both "stop paying for doomed work" fixes on the hottest read/write paths — same shape as 07-14's Phase 8 fix, now applied to social-engine and social-x-posting.
- **Step 5 — Automate**: arc-daily-read's finish-stuck wiring is correctly sequenced — automates recovery from an already-understood, already-manually-fixed failure mode.

### Flags

- **[NEW-WATCH]** Two bare reverts, `9f568694`/`c17f531e`, undo article-pipeline auto-package for articles 7 and 6 with no reason in the commit body, while articles 8/9/10 from the same batch (`fa5ba22b`/`fd31ead9`/`a420cf22`) were kept. Filing a follow-up to check article-pipeline state/logs for why those two specifically were reverted — either a real content defect worth root-causing, or an unremarked manual correction that should have a stated reason per this repo's commit conventions.
- **[WATCH]** `arc-packaging`'s new `cover.ts` (b574916d) pulls in `@resvg/resvg-js` — a native binary dependency (bun.lock + package.json changed). First native-dep addition this review has tracked; worth a one-time check that it doesn't complicate deploy on any non-dev machine running Arc.
- Audit CLI findings (49: 0 error/42 warn/7 info) are unchanged in character from prior cycles — same standing backlog (33/42 warns are "sensor has no dedup check", 8 SKILL.md files over the 2000-token budget). No fresh compliance regression from this diff; not re-listing individually here since `arc skills run --name arc-architecture-review -- audit` reproduces the live list on demand.

---

## 2026-07-15T08:23:00.000Z — auto-commit regression broke arc-blocked-review's task-creation call; fixed same-cycle

**Task #22717** | Diff: 79f5954..2411114 (86 commits, mostly memory/docs/cache; 1 substantive src change) | Sensors: 90 | Skills: 128

### Changed files (substantive only)

- `skills/arc-blocked-review/sensor.ts` (52d5cf59, an unreviewed "chore(loop): auto-commit after dispatch cycle" commit) — landed the intended cooldown fix (SIGNAL_REVIEW_COOLDOWN_HOURS now applies regardless of stale-reason presence, closing the #22689-review gap already tracked in MEMORY.md) but *also* rewrote the `insertTaskIfNew` call incorrectly: first arg changed from the `TASK_SOURCE` string to the `db` handle, `skills` passed as a raw array instead of a JSON string, and the `model` field dropped entirely. Since `pendingTaskExistsForSource`/`insertTask` bind `source` as a SQLite parameter, passing a `Database` object there throws at runtime — the sensor has been unable to create any new blocked-task review since this commit landed (2026-07-14 21:11 MDT). Bun's transpile-only pre-commit guard (CLAUDE.md's "Pre-commit syntax guard") does not catch this class of bug — it's a type/runtime mismatch, not a syntax error, and this was an auto-commit with no dispatch-session review. Fixed this cycle: restored `insertTaskIfNew(TASK_SOURCE, {...})` signature, JSON-stringified skills with the valid-skill-name filter, and restored `model: "sonnet"` (tasks without an explicit model are rejected at dispatch per CLAUDE.md). Verified via `bunx tsc --noEmit -p .` — no errors on this file post-fix.

### Steps 1–5

- **Step 1 — Requirements**: The cooldown-regardless-of-stale-reason change traces to a named incident (#22689-review, already in MEMORY.md); valid. The rest of the diff (signature/skills/model breakage) traces to no requirement — it's incidental damage from whatever authored the auto-commit, not a deliberate change.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A.
- **Step 4 — Accelerate**: N/A.
- **Step 5 — Automate**: N/A — but see Flags below re: a real gap in the auto-commit safety net.

### Flags

- **[NEW-WATCH]** The dispatch resilience doc (CLAUDE.md "Dispatch resilience") only names two safety layers: pre-commit syntax guard (transpile-only, doesn't type-check) and post-commit service health check (checks if a service died, not whether task-creation silently started failing). Neither layer would have caught this bug, and it shipped via an unattended "chore(loop): auto-commit after dispatch cycle" commit rather than a reviewed dispatch session. A sensor that periodically runs `bunx tsc --noEmit` against files touched by auto-commits (not full transpile) and flags new errors would close this gap. Filing a follow-up.
- **[RESOLVED]** Prior cycle's only carry-forward (#22656's Phase 8 + two-stage triage re-measurement watch) is unaffected by this diff — no action needed here, already tracked at #22699/[[arc-link-research-dedup-measurement]].

---

## 2026-07-15T20:23:00.000Z — smallest diff yet: arc-typecheck-guard ships end-to-end, closing the prior cycle's own [NEW-WATCH]; 129 skills / 91 sensors

**Task #22793** | Diff: 2411114..69e2895 (3 commits — 4 new skills/ files, 1 fix, 1 cache auto-commit) | Sensors: 91 (up from 90) | Skills: 129 (up from 128)

### Changed files (substantive only)

- `skills/arc-typecheck-guard/{SKILL.md,check.ts,cli.ts,sensor.ts}` (f3469b19, new skill) — direct fix for the prior cycle's own flagged gap: a 30-min sensor runs `tsc --noEmit`, diffs per-file error counts against a persisted baseline (`db/tsc-baseline.json`), and flags only INCREASES touched by unattended auto-commits (reviewed/human commits are ignored — CI covers those). Flags via follow-up task, does not revert (type errors don't crash a running Bun service, so revert-on-error would be over-aggressive here — correctly distinguished from `revertOnServiceDeath`'s justified aggression on actual service death). `bunx tsc --noEmit -p .` run this cycle shows zero errors attributable to this skill.
- `skills/arc-blocked-review/sensor.ts` (56e2e766) — the actual fix for #22717 (restores correct `insertTaskIfNew(TASK_SOURCE, {...})` signature, JSON-stringified skills, `model: "sonnet"`). Verified clean via `tsc --noEmit` this cycle.
- `69e2895d` — auto-commit, cache file only (`arc-link-research/cache/*.json`), no code.

### Steps 1–5

- **Step 1 — Requirements**: Both substantive commits trace to a single named incident (#22717) already tracked in MEMORY.md — the guard closes the exact gap this review flagged last cycle, no speculative scope added.
- **Step 2 — Delete**: None this cycle.
- **Step 3 — Simplify**: N/A — new capability, not a consolidation.
- **Step 4 — Accelerate**: N/A — sensor is explicitly kept off the dispatch hot path (30-min cadence, not per-commit) to avoid adding ~10-30s of `tsc` latency to every auto-commit.
- **Step 5 — Automate**: Correctly sequenced last — automates detection of a failure class only after the concrete incident (#22717) was understood and manually fixed same-cycle, not built speculatively ahead of a real case.

### Flags

- **[RESOLVED]** Prior cycle's `[NEW-WATCH]` (auto-commit safety net has no type-check layer) — closed same-day by this diff. Nothing carried forward on this thread.
- No new watch items — this is the tightest, most directly-traceable diff seen in this review's recent history (one incident, one fix, one preventive guard, zero unrelated changes).

---

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
