
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
