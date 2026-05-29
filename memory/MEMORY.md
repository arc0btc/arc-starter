# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-29T09:02:00Z*
*Token estimate: ~18t*

---

## [A] Active Items

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] Pause and disable ALL signal filing. aibtc.news EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Quantum bounty (1btc-news#33) dead-letter. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**amber-otter** [DEAD-END, dead-ends.md:amber-otter] Credential exposure 2026-05-18 (gregoryford963-sys/369sunray threat actor). Escalated whoabuddy 2026-05-22. No autonomous path — owner must rotate keys. Awaiting human action.
**payout-disputes** [DEAD-END, dead-ends.md:payout-disputes] 11 disputes, 30+d stale since 2026-04-26. No autonomous path. Requires whoabuddy direct outreach to aibtc.news platform team.
**wallet-rotation** [DEAD-END, dead-ends.md:wallet-rotation] No safe rotation path after compromise. Awaiting whoabuddy policy decision since 2026-04-24.
**loom-spiral** [DEAD-END, dead-ends.md:loom-spiral] Workflow 23 token spiral (1.1–1.2M/night). No runs until whoabuddy resolves root cause.
**pr-511** [DEAD-END, dead-ends.md:pr-511] aibtc-mcp-server PR #511 flagged 2026-05-11: package rename + proprietary license + IPI blocklist. 3 blocking issues. Awaiting author response.

**rfc-0007-0010** [QUEUED 2026-05-28, whoabuddy] Tasks #17857–17860 + #17866–17869: Verification Layer, reference skills, Lessons Layer, SkillOpt survey, skills linting, RFC 0011 sketch. 8 tasks, P3-P4, not yet started as of 2026-05-29.

→ Dead-end items above: no autonomous Arc action. See dead-ends.md for approach detail. Migration rule: [[dead-ends-convention]]

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19 per whoabuddy policy. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Check cooldown at SENSOR TIME, not dispatch. `file-signal` requires `--tags` or 400 error.
**Cooldown at dispatch**: (1) close as `failed`, (2) new task with `--scheduled-for <clear+5min>`. Sensor tasks: just close, sensor re-queues. CLI: `tasks update --status blocked` NOT supported — only `--status pending`.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.
**Skill names**: `arxiv-research` (quantum/bitcoin-dev), `aibtc-news-editorial` (signal filing). "quantum" and "arc-signal-manager" are INVALID.

---

## [P] Critical Patterns
→ See `memory/patterns.md` (27 validated patterns). **Key operational rules**:

**Dispatch/queue**
- Dispatch-stale alerts: always FP — verify PID + recent cycle_log timestamps. During long outages (9h+), sensor accumulates 4+ FP tasks at P2 — bulk-close or add dedup cooldown to sensor.
- **rate_limit_event parser** [FIXED 2026-05-28, 510b9e67+1d0395c0]: informational events (status='allowed') were classified as denials → abort valid cycles. Fixed: short-circuit on informational; log full payload before extracting reset time.
- Timeout cluster (3+ same window): task decomposition signal. Split or script.
- Signal-filing tasks must be sonnet: haiku times out.
- Claude usage quota → 19h outage (task #16675). Fix: parse reset time in `checkDispatchGate()`, auto-reset for rate_limited class.
- Batch-fail on restart after long gap: sensors queue tasks → lock-gate drops them. Consider auto-reschedule for P2-P4 time-sensitive tasks.

**PR reviews**
- Model: sonnet, no daily cap. `api_cost_usd` is phantom.
- Pre-flight: check `gh pr view --json state` — if MERGED/CLOSED, close task as completed.
- Bounty-farming flood (3+ identical rejections): escalate to whoabuddy, flag for policy. Don't loop.
- Re-review loop: if blocking issues unchanged, comment and skip.
- CF deploy failure: check if deploy is bottleneck; surface to whoabuddy before re-queuing.

**Sensors**
- Integration sensors: gate on `pendingOrCompletedTaskExistsForSource` per release version.
- Signal cooldown: must check at sensor time. Dispatch-time check = wasted cycle.
- arXiv 35+ relevant papers + no auto-signal: create manual follow-up after 2 sensor cycles.
- Sensor health audit (P6, periodic): catches bugs sensor self-monitoring misses. Use `sensor-health-report` CLI.
- **X API pre-screen** [SHIPPED 2026-05-20]: Before queuing any tweet-review task, fetch URL at sensor time. If 4xx/network error → skip. Applies to all sensors queuing tasks from external URLs.
- **Policy-disable orphan tasks**: When enacting a sensor-disable policy, close all pending tasks matching disabled subject patterns first.
- **Sensor preflight gating** [PATTERN 2026-05-20]: Check hard prerequisites at sensor time before queuing. If `walletBalance < MIN_SEND_THRESHOLD`, skip and log — don't queue tasks that will immediately fail preflight.

**Token management**
- Per-file reads in dispatch = token explosion (1.8–2.9M). Use aggregate CLIs.
- Rule: >10 files needed → add a CLI command first. `sensor-health-report` replaces 73 per-sensor reads.
- arch-review: scope to git diff since last SHA, not all SKILL.md/AGENT.md files.

**Misc**
- Stacks address prefixes: SP/SM = mainnet, ST/SN = testnet. Verify via Hiro API.
- Verify creds before acting on memory — stale memory → expensive correction.
- Context-review SKILL_KEYWORD_MAP: update when scaffolding new skill in same PR.
- Workflow-dedup: arc-workflows uses `pendingTaskExistsForSource`.
- Self-review triage pre-dispatch: correlates with 100% success rate — never skip.
- Policy-closure tasks: close with `status=completed` + "superseded by policy".
- sourceQuality re-file: re-filing with better sourcing (10→30) is a valid quality lever.
- **AIBTC weekly deck title convention** [whoabuddy 2026-05-19]: titles MUST lead with "AIBTC" (e.g. "AIBTC trades.", "AIBTC keeps shipping."). Standing convention.
- **Deck stat verification**: never ship deck stats from memory. Always re-query: `tasks`/`cycle_log`, `gh search prs`, `aibtc-news-editorial leaderboard`.
- **Streak task beat encoding**: subjects MUST match BEAT_SUBJECT_PATTERNS. Use "File <beat> signal: maintain N-day streak". Model=sonnet, not haiku.
- **x402 404 = agent deregistered**: do NOT retry. Create follow-up to verify/update agent address.
- **CLAUDE_CODE_WORKFLOWS=1**: intra-cycle structured agent sequencing — not a dispatch replacement.
- **landing-page 1.44.0 KV→D1 [COMPLETE 2026-05-21]**: BNS/identity/agents/heartbeat/activity all migrated. RelayRPC exposes `nonceExpiresAt`/`sponsorNonceValidForMs`.
- **Native bounty system live** [#843/#902 2026-05-21]: Any registered agent can post bounties — Arc is registered.
- **Competition round finalization** [#897/#900 2026-05-20]: Frozen P&L snapshot = reward basis (not live leaderboard). Trading comp winding down.
- **aibtcdev/skills: 0 PRs since 2026-05-22** — gregoryford963-sys incident likely chilled activity. Escalate to whoabuddy if persists past 2026-06-01.
- **Agent council name: Notch** [2026-05-23]: 5-round vote. Blog post "Five Rounds to Notch" published at arc0.me.
- **bff-skills PR #605** [2026-05-23]: Approved by Arc. Awaiting whoabuddy review — no further Arc action needed.
- **Cross-repo threat actor pattern** [2026-05-23]: When actor appears in one PR (supply chain + credential exposure), proactively check other repos. gregoryford963-sys caught in both aibtcdev/skills + 1btc-news.
- **PR blocking review ≠ credential protection**: CHANGES_REQUESTED blocks merge but does NOT revoke public diff. Credentials in PR diffs are fully compromised at push time. Only fix = direct rotation.
- **Context-review FP cycle is recurring maintenance**: Each new task type causes 1–2 FP cycles until exclusion rules updated. Normal sensor maturation, not a bug.
- **Payout dispute escalation hard limit**: No autonomous path to aibtc.news platform team. Close immediately as `failed` with "requires whoabuddy direct outreach" — don't retry.
- **arc0.me build-without-deploy**: Verify deploy step ran after build — build success ≠ deploy success. Health check caught 305 un-deployed assets (task #17355).
- **arc0.me freshness-decay** [2026-05-27]: When signal filing is paused and no blog posts published, site freshness monitor fires. Fix: publish a blog post. Recurring when filing stays paused long-term — blog posts must fill the gap. See `content-publish-verify-deploy` shared entry. **2026-05-29 confirmed**: freshness alert resolved by publishing "The Resurrection Bug" post about dispatch task resurrection incident — incident-to-blog-post is a reliable dual-purpose fix (freshness + knowledge artifact).
- **inbox-x402 direct path** [2026-05-25]: Sponsored `send_inbox_message` has relay settlement timeouts. Use `send_inbox_message_direct` (MCP v1.55.0, commit d346e9e) — sender pays own gas (~250 µSTX, 50k cap). CLI gap: subcommand pending, follow-up tasks queued.
- **MCP_TOOL_TIMEOUT=120s** [CONFIGURED 2026-05-27, task #17739]: v2.1.142 fixed MCP_TOOL_TIMEOUT being ignored on HTTP/SSE servers (previously silent 60s cap). arc-mcp runs HTTP transport (port 3100). Set to 120s in dispatch.ts env block. Prevents silent timeouts on x402 + Stacks tool calls with network latency.
- **AGENT.md authoring wave complete** [2026-05-27]: 7 complex skills (defi-zest, jingswap, arc-worktrees, daily-brief-inscribe, defi-bitflow, arc-payments, dao-zero-authority) now have subagent execution briefings. Dispatch context for these domains is leaner — future cycles won't re-derive flows from scratch.
- **Self-review triage redundancy** [2026-05-27]: When all escalations are genuinely blocked (no autonomous path), the self-review triage sensor fires repeatedly with identical results — wasted cycles. Fix: add a "nothing-changed" state-diff guard or cooldown (1+ hours between identical triage results). Task queued (#17763).
- **X API HTTP 402 = CreditsDepleted** [2026-05-27, task #17788]: `prescreen` returns "API returned HTTP error" — root cause = paid quota exhausted, NOT rate limit. Account 2018064436117020672. Will NOT auto-recover; requires whoabuddy credit top-up. `prescreenTweet` swallows the 402 status (only returns null on !response.ok) — `curl -w "HTTP %{http_code}"` against `api.x.com/2/tweets/<id>` is the diagnostic. On dispatch: park affected tasks at P9 with `[BLOCKED-X-API]` subject prefix (status=blocked not supported via `tasks update`), escalate via email, don't mass-skip. Consider patching `prescreenTweet` to surface 402 distinctly so future cycles auto-route to escalation instead of "inaccessible".
- **Awesome-list decomposition policy** [2026-05-27]: For awesome-list research, decompose by SECTION (`## headings`), not by individual entry. Brief: "pick top 5 Arc-relevant, deep-dive those, one-liner the rest". Per-entry queueing on a 100-entry list = $50+ and buried signal.
- **Side-effecting tasks re-dispatch → duplicate sends** [2026-05-28, task #17797]: Aggregator email task re-dispatched 3× (likely after the ~9h rate-limit outage) and sent whoabuddy 3 identical report emails (06:27/06:31/06:35, ids aef0a325/2f0e899f/afc1c447). Dispatch resilience guards commits + services, NOT external side effects (email, STX send, x402). RULE: any task that sends email/funds must be IDEMPOTENT — before sending, check the sent folder for a matching subject within a recent window and skip if already sent. On re-dispatch of an already-completed side-effect task: verify the side effect happened, close idempotently, do NOT repeat. List sent mail: `curl -H "X-Admin-Key: $KEY" "$BASE/api/messages?folder=sent&limit=N"` (arc-email-sync CLI has no list-sent subcommand). Follow-up queued to add a sent-folder dedup guard to the send path (#17836, bumped to P2 on 2026-05-28). **RECURRED 15:06** — dispatch re-selected #17797 even though it was already closed `completed` at 06:38. So there are TWO bugs: (1) non-idempotent send [#17836 mitigates], (2) dispatch re-dispatching an ALREADY-COMPLETED task — distinct, wastes full cycles and could re-trigger side effects in any side-effecting task. Need root-cause on why dispatch selects completed tasks (suspect rate-limit-outage recovery resetting status, or harness re-invoking on stale task spec without DB pending check). Follow-up #17845 queued (dispatch-start status re-check guard). **RECURRED AGAIN 15:24 (4th dispatch)** — re-dispatch brackets rate-limit outage (Dispatch-stopped emails 06:40 & 15:12). THIS TIME the manual idempotency check WORKED: checked sent folder first, found msg afc1c447 already sent, closed as NO-OP without re-sending. **Validates the rule: manual sent-folder verification before any email send reliably prevents the duplicate.** Until #17836 + #17845 land, every side-effecting task dispatch must self-verify the side effect hasn't already occurred before acting. **BUG #2 ROOT-CAUSED + FIXED 2026-05-28 (commit af5c6ac2, closes #17845):** dispatch `catch` block (src/dispatch.ts ~1331) requeued/failed tasks based ONLY on error class — never checked if the LLM already self-closed. `requeueTask` unconditionally sets `status='pending'`, so a subprocess error during teardown (esp. `rate_limited` AFTER the LLM closed `completed`) overwrote completed→pending, resurrecting the task for re-dispatch. The ~9h rate-limit outage triggered it every cycle. Fix: guard at top of catch — `if (getTaskById(task.id).status !== 'active')` → preserve status, log, skip requeue. (cost vars are out of scope in catch — shadowed by `const` destructure ~line 1250 — so guard doesn't record cost; matches existing catch behavior.) Bug #1 (non-idempotent send) still open via #17836 as defense-in-depth. **BUG #2 HARDENED AT DB LAYER 2026-05-28 (commit 78408d07):** af5c6ac2's catch-block guard reads in-memory status and can LOSE a race against a concurrent 1-min-timer cycle that completes the task after the read; it also only covered one of several `requeueTask` call sites. Real fix = make the invariant universal + race-safe in `requeueTask` (src/db.ts): `UPDATE ... WHERE id=? AND status != 'completed'` so a completed task can NEVER be moved to pending regardless of caller/timing; logs a warn on 0-row no-op. Confirmed `requeueTask` does NOT clear `completed_at`. Manual CLI requeue (cli.ts) only targets failed/blocked → unaffected. RULE: a completed task is terminal — resurrection is always a bug, never silently set completed→pending. Loop ends once a dispatch process spawned after the commit loads it (per-timer fresh bun spawn). **CORRECTION — 5th re-dispatch 2026-05-28 21:24, AFTER both commits:** the fixes prevent NEW resurrections but do NOT retroactively re-close a task already stuck `pending` from a pre-fix requeue. The 06:40 + 15:11 requeues (pre-fix) left #17797 sitting in `pending`, so it kept being legitimately selected by `getPendingTasks()` every cycle. Loop did NOT auto-end — required a manual `close --status completed` this cycle (verified email NOT re-sent: only 3 sends exist, all 06:2x-06:3x). Once closed, db.ts:1034 `WHERE status!='completed'` makes it permanently terminal. LESSON: after shipping a resurrection-guard fix, sweep for tasks already left in the bad `pending` state — the guard is preventive, not curative.

---

## [E] Recent Evaluations

**Trend (2026-05-19 → 2026-05-26)**: PURPOSE range 2.85–3.55. Signal Quality (S) locked at 1 — filing paused. Cost $0.17–0.42/task. 83–100% success.

- **daily-eval-2026-05-29-am** [task #17846, 07:05 UTC] PURPOSE **2.70** (S:1 O:5 E:3 C:2 A:3 Co:2 Se:3). 27 completed / 0 failed today (100%), $12.12 spend / **$0.449 per task — above $0.40 ceiling 3rd straight eval**. Task constrained no-boost (no queue manipulation). Signal filing still paused (10d). amber-otter **11d stale** (past threshold), payout-disputes 30+d — no autonomous path. **NEW: Loom VM handover queued** (human:rfc-0, #17861–#17869) — pause arc-starter + port credentials/worktrees/mcp-server/peer-inbox skills to new VM; sitting at P5/P6, not yet picked up — likely the real #1 priority. Blog publish tasks (#17826/#17878) pending >24h → arc0.me freshness risk. Focus next: cost/task drift + surface VM handover to whoabuddy.
- **l-purpose-2026-05-28** [2026-05-28] PURPOSE **2.75** (S:1 O:5 E:2 C:3 A:4 Co:2 Se:3). 99.0% (96/97), $0.388/task, $37.67/day. 3 PR reviews. Dispatch resurrection bug root-caused + fixed at catch-block (af5c6ac2) + DB layer (78408d07). Side-effecting task idempotency pattern validated. Signal filing still paused (11d).
- **daily-eval-2026-05-27-pm** [task #17768, 15:31 UTC] PURPOSE **3.00** (S:1 O:5 E:3 C:4 A:3 Co:2 Se:3). 98.3% (59/60), $16.26 spend / $0.271 per task — back under $0.40 ceiling. Pending queue empty → no boosts available. Stale escalations unchanged: amber-otter (9d), payout-disputes (30+d), pr-511 (16d). Signal filing still paused. arc0.me freshness watch — no blog post today yet. Focus next: if signal pause continues into 2026-05-28, prioritize a blog post to feed arc0.me freshness.
- **l-purpose-2026-05-27** [2026-05-27] PURPOSE **2.90** (S:1 O:5 E:3 C:3 A:3 Co:3 Se:3). 100% (56/56), $0.396/task, $22.19/day. 5 PR reviews. Signal filing still paused. amber-otter 9d stale — no autonomous path.
- **daily-eval-2026-05-26-full** [task #17693, 15:29 UTC] PURPOSE **3.10** (S:1 O:5 E:4 C:3 A:3 Co:3 Se:3). 40 completed today / 42 cycles, $16.18 spend / $0.385 per task — above $0.40 target ceiling. Heavy cycles: #17688 ($3.54), #17684 ($0.90), #17687 ($0.52). Pending queue empty → no boosts available. Stale escalations: amber-otter rotation (8d, past threshold), payout-disputes (30+d). All autonomous paths exhausted — awaiting whoabuddy. Quality avg 4.5/5 (7d). Focus tomorrow: watch cost/cycle drift; if signal pause continues, consider lower-cost task types to keep <$0.40.
- **l-purpose-2026-05-26** [2026-05-26] PURPOSE **3.20** (S:1 O:5 E:4 C:3 A:4 Co:3 Se:3). 98.3% (59/60), $0.321/task, $19.28/day. 19 PR reviews. amber-otter 7d stale.
- **daily-eval-2026-05-25-full** [task #17636] PURPOSE **3.55** (S:1 O:5 E:5 C:3 A:5 Co:4 Se:3). 99 tasks, 99% success, $0.31/task. 15+ PR reviews (landing-page #914–#924, mcp-server #548/#549, x402-relay #401/#404), retro-sensor dedup fix shipped, inbox-x402 direct path confirmed, blog published. Escalations stale — awaiting whoabuddy.
- **l-purpose-2026-05-25** [2026-05-25] PURPOSE **3.35** (S:1 O:5 E:3 C:5 A:4 Co:3 Se:4). 100% (243/243), $0.172/task, $41.73/day. Best cost efficiency this week.
- **l-purpose-2026-05-24** [2026-05-24] PURPOSE **3.05** (S:1 O:5 E:3 C:3 A:4 Co:3 Se:4). 100% (40/40), $0.326/task, $13.03/day. 7 PR reviews.
- **l-purpose-2026-05-23** [2026-05-23] PURPOSE **3.30** (S:1 O:5 E:4 C:4 A:3 Co:3 Se:4). 98.6% (70/71), $0.260/task, $18.45/day. 10 PR reviews. Council vote → "Notch".
- **l-purpose-2026-05-22** [2026-05-22] PURPOSE **2.90** (S:1 O:5 E:3 C:3 A:3 Co:2 Se:4). 100% (54/54), $0.326/task, $17.62/day. All escalation paths exhausted.
- **l-purpose-2026-05-21** [2026-05-21] PURPOSE **2.85** (S:1 O:2 E:4 C:5 A:4 Co:2 Se:3). 83.1% (54/65), $0.241/task, $15.68/day. x-api pre-screen + sensor preflight gating shipped.
- **l-purpose-2026-05-20** [task #17121] PURPOSE **2.30** (S:1 O:2 E:4 C:2 A:3 Co:2 Se:3). 89.1% (123/138), $0.417/task, $57.58/day. Failures: 7× X API, 5× stale signal, 2× STX-send.
- **daily-eval-2026-05-19** [task #17089] PURPOSE **3.55** (S:2 O:3 E:5 C:4 A:4 Co:4 Se:5). 90.7% (147/162), $0.374/task. 1 signal, 31 PR reviews, blog post shipped, AIBTC Tuesday deck.

---

## [L] Core Validated Patterns

**quantum-gate-framework** [aibtcdev/agent-news#497]
7-gate validation. Cluster cap: 2-signal/cluster. ≥3 quantum keywords (Gate 5). ≥500 chars + ≥1 specific number (Gate 6). Specific arxiv.org/abs/ID required (Gate 0). Score: 75 standard, 65 dark domains.

**bitcoin-macro-sensor** [task #12742]
`skills/bitcoin-macro/sensor.ts`, 240min cadence. Signals: price-milestone, price-move (>5%/4h), hashrate-record (ATH or >5% drop), difficulty-adjustment (≤288 blocks + ≥3% change). hashrate via mempool.space = sourceQuality=10 only — won't reach 65 floor. Hashrate signal: always decompose (1) research+compose, (2) file.

**signal-pipeline** [validated 2026-04-13] JingSwap → P2P fallback. Known gap: pending-task check before queuing.

**nonce-serialization** [SHIPPED 2026-04-08]
All STX send paths through `acquireNonce`/`releaseNonce` in `github/aibtcdev/skills/src/lib/services/nonce-tracker.js`.

**approved-pr-guard** [SHIPPED, task #11183]
Use `gh pr view NUMBER --repo OWNER/REPO --json reviews` — NOT `gh pr reviews` (silent exit 1 bug).

---

## [N] Agent Network Contacts

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = hostile. Comp: 1,200/600 sats. Last: 2026-05-25 (flagged x402 sponsored path timeouts → confirmed, Arc migrated to direct path). Reputation: elevated.

**vivid-manticore** [CONTACT 2026-04-20] EmblemAI. 191 x402 tools via sBTC at `api.emblemvault.ai`. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`.

**deep-tess** [PENDING METRICS] Bitcoin maxi AI. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. ~6-week response cadence.

**fractal-swift** [AWAITING RESPONSE] Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`.

**crystal-engine** [AWAITING RESPONSE] Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`.

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2 agent, 1,744+ check-ins, 228+ signals. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Credentials exposed via gregoryford963-sys PR #389 — must rotate before trusting.

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
- [edge-cache-auth-gate-leak](memory/shared/entries/edge-cache-auth-gate-leak.md) — `edgeCacheMatch` before BIP-322 auth = author-only data leak
- [claude-code-version-deploy](memory/shared/entries/claude-code-version-deploy.md) — manual Claude Code upgrade procedure (manifest → checksum → atomic symlink swap)
- [hook-exec-form-eval](memory/shared/entries/hook-exec-form-eval.md) — v2.1.139 exec form evaluation; Arc hooks require shell features
- [recursive-improve-failure-detectors](memory/shared/entries/recursive-improve-failure-detectors.md) — 4-class detector taxonomy + insight→metric→fix discipline
- [shai-hulud-npm-worm-class](memory/shared/entries/shai-hulud-npm-worm-class.md) — recurring npm CI-takeover worms; kill dead-man's switch BEFORE rotating creds
- [harness-engineering-five-subsystems](memory/shared/entries/harness-engineering-five-subsystems.md) — 5-subsystem harness model; CLAUDE.md Lost-in-Middle risk; bootstrap contract
- [harness-engineering-completion-verification](memory/shared/entries/harness-engineering-completion-verification.md) — verification_cmd gap; independent evaluator; session clean-state 5 dimensions
- [content-publish-verify-deploy](memory/shared/entries/content-publish-verify-deploy.md) — build success ≠ deploy success; verify deploy step ran after any content publish workflow
- [agent-eval-volume-taxonomy](memory/shared/entries/agent-eval-volume-taxonomy.md) — Hylak's Stumbles→Issues→Signals→Experiments volume tiering; floor-raising vs benchmark-maxxing; golden cases; 3-month case retention
- [file-inbox-hcom-pattern](memory/shared/entries/file-inbox-hcom-pattern.md) — Stop hook → inbox/<peer>/<ts>.md + sensor on inbox/arc/; local IPC, not cross-machine; SubagentStop ≠ Stop in Arc's Bun.spawn dispatch
- [dead-ends-convention](memory/shared/entries/dead-ends-convention.md) — When to use dead-ends.md (approach-level) vs MEMORY.md [A] (situation-level); 14-day stale threshold for migration
