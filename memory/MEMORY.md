# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-06-04T07:05:00Z*
*Token estimate: ~18t*

---

## [A] Active Items

**daily-eval** [ROLLING, last 2026-06-07 task #18370] Weighted 2.40/5 — S:1 O:5 E:1 C:3 Ad:3 Co:1 Se:3. Signal filing still paused (caps S at 1); ops clean 36/36 (100%); ecosystem flat (0 PR reviews, 0 signals); cost $0.31/task ($11.24/day); adaptation steady (no new patterns today). Co:1 again (no peer interactions). Overwrite this line next eval — do not accumulate.

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] Pause and disable ALL signal filing. aibtc.news EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Quantum bounty (1btc-news#33) dead-letter. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**amber-otter** [DEAD-END, dead-ends.md:amber-otter] Credential exposure 2026-05-18 (gregoryford963-sys/369sunray threat actor). Escalated whoabuddy 2026-05-22. No autonomous path — owner must rotate keys. Awaiting human action.
**payout-disputes** [DEAD-END, dead-ends.md:payout-disputes] 11 disputes, 30+d stale since 2026-04-26. No autonomous path. Requires whoabuddy direct outreach to aibtc.news platform team.
**wallet-rotation** [DEAD-END, dead-ends.md:wallet-rotation] No safe rotation path after compromise. Awaiting whoabuddy policy decision since 2026-04-24.
**loom-spiral** [DEAD-END, dead-ends.md:loom-spiral] Workflow 23 token spiral (1.1–1.2M/night). No runs until whoabuddy resolves root cause.
**pr-511** [DEAD-END, dead-ends.md:pr-511] aibtc-mcp-server PR #511 flagged 2026-05-11: package rename + proprietary license + IPI blocklist. 3 blocking issues. Awaiting author response.

**rfc-0007-0010** [PHASE 1 COMPLETE 2026-05-29] All 4 agent-runtime RFC tasks shipped: Verification Gate (0007, 18 tests pass), 5 reference skills (0008), Lessons Layer (0009, src/memory.ts + patterns/ + dead-ends.jsonl), Loom VM handover Phase 1 (0010). arc-starter paused (c33d41b6); agent-runtime live at `/home/dev/agent-runtime`. Next: RFC 0011 (escalation ladder) + ADAPT ports of arc-workflows/arc-memory/arc-scheduler. Total Phase 1 cost: ~$5.2 (3 opus tasks).

**arc-email-sync-cursor-cold-start-bug** [RESOLVED 2026-05-31, task #17961 PASS] Cursor fix (c40f4ceb) + PR #8 (composite folder+received_at index + COUNT drop) → 82k/hr reduced to ~70/hr (99.9% reduction). 24h post-deploy: sustained 68–74 rows/hr. Single 04:00Z spike at 1,342 rows (dispatch artifact). Target <1k/hr met. RULE: any sensor that shares db/hook-state/{name}.json with other state must validate all expected fields on read.

**1btc-news-major-bounty** [CLOSED 2026-06-03, task #18208] All 6 deliverables confirmed. Day 0 ack posted on issue #33. Window closed. No further action unless bounty payout fails.

**zest-audit-bounty** [SUBMITTED 2026-06-03, task #18169] Submitted static analysis of `pool-borrow-v2-3` to bounty mpwj1rjde88d5b53b990 (5k sats sBTC). Submission ID: mpxf5rek026008332af2. Gist: https://gist.github.com/arc0btc/caee15a8f84fd9191b194bc4bc03b88f. 4 total submissions; gregoryford963-sys (threat actor) also submitted (id mpwvv9ssef164b7f1fd8, gist ef3be5697b) — treat as suspect. Closes 2026-06-16. **Bounty submission API**: `POST /api/bounties/{id}/submit` with BIP-137 signature via `arc skills run --name bitcoin-wallet -- btc-sign`.

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
- **Blocked-review churn on external-dependency blocks** [2026-06-07]: X API 402 CreditsDepleted block reviewed 3× in 24h (tasks #18366/#18355/#18348), identical result each time. Rule: if 3+ consecutive blocked-reviews confirm the same unchanged block AND the summary says "requires whoabuddy" or names an external system, apply 48h+ cooldown before next review. Consecutive-confirmed-external-blocks are not unblockable by the agent — reviewing them on the default interval is pure cycle waste.

**PR reviews**
- Model: sonnet, no daily cap. `api_cost_usd` is phantom.
- Pre-flight: check `gh pr view --json state` — if MERGED/CLOSED, close task as completed.
- Bounty-farming flood (3+ identical rejections): escalate to whoabuddy, flag for policy. Don't loop.
- Re-review loop: if blocking issues unchanged, comment and skip. Author "all fixed" claims require re-verification against each original issue (#18097 bff-skills HODLMM: 4 claimed, 1 actually fixed → CHANGES_REQUESTED maintained). **bff-skills PR #300 HODLMM [2026-06-02]: 3rd re-review (task #18129) — all 4 blocking issues still present. Per bounty-farming flood rule: next trigger = escalate to whoabuddy for policy, do NOT re-review again.**
- **Stale-diff FALSE NEGATIVE** [2026-06-03, aibtc-mcp-server PR #559, task #18198]: Cycle-2 re-review wrongly MAINTAINED a [blocking] "mkdir missing" finding — the fix was already at HEAD (writeJsonConfig L56) but I read a stale diff. Author was right; cycle 3 approved + apologized. RULE: when re-verifying author fix-claims, fetch the ACTUAL file content at the head SHA (`gh api repos/O/R/contents/PATH?ref=<sha> --jq .content | base64 -d`), do NOT trust a cached/stale `gh pr diff`. Reviewer stale-diff false-negatives are as real as author false-positives — verify the live source both ways.
- **bff-skills stale-PR sensor noise** [2026-06-04, tasks #18240/#18241/#18242]: Sensor queued reviews for PRs #564/#565/#579 (BitflowFinance/bff-skills) — all already closed or previously approved at review time. Close as completed immediately — no review needed. Known bad-actor org (gregoryford963-sys) generates stale-PR noise across multiple PRs. Pre-flight `gh pr view --json state` is mandatory for all bff-skills PRs. **Sensor-level fix needed**: pre-flight at dispatch is working but doesn't stop sensor from queuing — add `pendingOrCompletedTaskExistsForSource` gate or recently-closed-PR dedup in the bff-skills sensor.ts itself.
- CF deploy failure: check if deploy is bottleneck; surface to whoabuddy before re-queuing.

**Sensors**
- Integration sensors: gate on `pendingOrCompletedTaskExistsForSource` per release version.
- Signal cooldown: must check at sensor time. Dispatch-time check = wasted cycle.
- arXiv 35+ relevant papers + no auto-signal: create manual follow-up after 2 sensor cycles.
- Sensor health audit (P6, periodic): catches bugs sensor self-monitoring misses. Use `sensor-health-report` CLI.
- **X API pre-screen** [SHIPPED 2026-05-20]: Before queuing any tweet-review task, fetch URL at sensor time. If 4xx/network error → skip. Applies to all sensors queuing tasks from external URLs.
- **Policy-disable orphan tasks**: When enacting a sensor-disable policy, close all pending tasks matching disabled subject patterns first.
- **Sensor preflight gating** [PATTERN 2026-05-20]: Check hard prerequisites at sensor time before queuing. If `walletBalance < MIN_SEND_THRESHOLD`, skip and log — don't queue tasks that will immediately fail preflight.
- **recent.log consolidation over-fire** [FIXED 2026-06-02 + 2026-06-04, task #18128 + #18250]: Sensor fires at >N lines, but archiving is no-op when all entries are <30d old. Each consolidation adds 2-3 new lines → back over threshold next cycle. Fix 1 (2026-06-02): 4h cooldown via `getLastCompletedTaskBySource`. Fix 2 (2026-06-04, commit 44ec2ef6): threshold raised 300→500 (buys ~2 weeks). **Long-term fix needed**: age-based archiving (only archive entries >14d old) — count-based threshold bumping is an infinite band-aid pattern. Follow-up task queued.
- **CVE batch dedup** [2026-06-02, CVE-2026-47429]: When same CVE hits multiple repos simultaneously (vitest critical hit landing-page + mcp-server + x402-sponsor-relay), batch assess with one consistent ruling. All 3 were low actual risk (no UI server, Linux/CI only). Pattern: identical CVE → group repos, assess once, apply ruling uniformly.

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
- **aibtcdev/skills PR activity resumed** [2026-05-29]: PR #400 (speedy-indra agent config) + PR #399 (stacker-news skill draft) filed 2026-05-29. No escalation to whoabuddy needed. **WARNING**: PR #396 (gregoryford963-sys, aibtc-news API compat fix) still open — known threat actor, review before merge. Agent registry at 445 registered agents as of 2026-05-31.
- **Agent council name: Notch** [2026-05-23]: 5-round vote. Blog post "Five Rounds to Notch" published at arc0.me.
- **bff-skills PR #605** [2026-05-23]: Approved by Arc. Awaiting whoabuddy review — no further Arc action needed.
- **Cross-repo threat actor pattern** [2026-05-23]: When actor appears in one PR (supply chain + credential exposure), proactively check other repos. gregoryford963-sys (also "Coral"/"Coral Reef" alias, confirmed 2026-06-01 task #18089) caught in aibtcdev/skills + 1btc-news. PR #396 in aibtcdev/skills still open — block merge.
- **PR blocking review ≠ credential protection**: CHANGES_REQUESTED blocks merge but does NOT revoke public diff. Credentials in PR diffs are fully compromised at push time. Only fix = direct rotation.
- **Context-review FP cycle is recurring maintenance**: Each new task type causes 1–2 FP cycles until exclusion rules updated. Normal sensor maturation, not a bug.
- **context-review exclusion rule accumulation** [2026-06-03, tasks #18189/#18190]: SKILL_KEYWORD_MAP exclusion list grows 1 rule per FP cycle. When it exceeds ~10 entries, the list becomes hard to reason about. Pattern `p-exclusion-rule-accumulation-refactor`: refactor to category/regex-based matching before the list becomes unmaintainable. Symptom to watch: exclusion-only commits that add a bare keyword to suppress a known-good task type.
- **Payout dispute escalation hard limit**: No autonomous path to aibtc.news platform team. Close immediately as `failed` with "requires whoabuddy direct outreach" — don't retry.
- **arc0.me build-without-deploy**: Verify deploy step ran after build — build success ≠ deploy success. Health check caught 305 un-deployed assets (task #17355).
- **arc-email-worker no-CI/CD** [2026-05-29, tasks #17893/#17894]: arc0btc/arc0btc-worker PR merged but worker never deployed — no GitHub Actions workflow exists. Same build-without-deploy anti-pattern as arc0.me. Verification tasks failed (404 + no CF-Cache headers). Follow-up: add deploy workflow before any further worker verification.
- **arc0.me freshness-decay** [2026-05-27]: When signal filing is paused and no blog posts published, site freshness monitor fires. Fix: publish a blog post. Recurring when filing stays paused long-term — blog posts must fill the gap. See `content-publish-verify-deploy` shared entry. **2026-05-29 confirmed**: freshness alert resolved by publishing "The Resurrection Bug" post about dispatch task resurrection incident — incident-to-blog-post is a reliable dual-purpose fix (freshness + knowledge artifact). **2026-06-03 batch variant**: 4 blog posts published in one burst (arc services overview, RFC handover, Zest audit story, CF DO row reads) — batching depletes the hungry-domains backlog AND resolves freshness in a single deploy cycle. More efficient than one-post-at-a-time when 3+ posts are queued.
- **inbox-x402 direct path** [2026-05-25, formally deprecated 2026-06-02 v1.57.0]: Sponsored `send_inbox_message` has relay settlement timeouts. Use `send_inbox_message_direct` — sender pays own gas (~250 µSTX, 50k cap). v1.57.0 formally deprecated `send_inbox_message`; Arc already on direct path. CLI gap: subcommand pending, follow-up tasks queued.
- **aibtc-mcp-server v1.58.0** [2026-06-03, task #18206]: Adds `--install` flags for IDE integrations (Cursor/Windsurf/Gemini/Codex). Arc uses dispatch subprocess path — no config change needed. Notable: multi-client install pattern is now official.
- **Hiro budget storm circuit-breaker** [2026-06-03, PR #958 merged]: aibtcdev/landing-page added circuit-breaker to Hiro API calls to prevent budget storms from cascading. Pattern: rate-sensitive external APIs need circuit-breakers, not just retries.
- **arc-worktrees db/ symlink lstatSync fix** [2026-06-02, task #18149, commit ff63c252]: v2.1.161 worktree isolation change exposed a bug where arc-worktrees symlinked db/ without checking if it already existed. Fix: use `lstatSync` before symlinking — prevents EEXIST crash on re-runs. Pattern: always lstatSync before creating symlinks in worktree setup code.
- **MCP_TOOL_TIMEOUT=120s** [CONFIGURED 2026-05-27, task #17739]: v2.1.142 fixed MCP_TOOL_TIMEOUT being ignored on HTTP/SSE servers (previously silent 60s cap). arc-mcp runs HTTP transport (port 3100). Set to 120s in dispatch.ts env block. Prevents silent timeouts on x402 + Stacks tool calls with network latency.
- **AGENT.md authoring wave complete** [2026-05-27]: 7 complex skills (defi-zest, jingswap, arc-worktrees, daily-brief-inscribe, defi-bitflow, arc-payments, dao-zero-authority) now have subagent execution briefings. Dispatch context for these domains is leaner — future cycles won't re-derive flows from scratch.
- **arc-starter paused / agent-runtime live** [2026-05-29, commit c33d41b6]: RFC 0010 Loom VM handover Phase 1 paused arc-starter and stood up `agent-runtime` at `/home/dev/agent-runtime`. Skills credentials/worktrees/mcp-server/peer-inbox ported under RFC 0008 contract. arc-starter dispatch will continue running until full handover; agent-runtime is the forward base.
- **claude-opus-4-8 model upgrade** [2026-05-29, commit 8d8b18a5]: `MODEL_IDS.opus` updated to `claude-opus-4-8`. If a task specifies `model=opus`, it now routes to claude-opus-4-8. Verify model ID against environment docs before queuing high-cost opus tasks.
- **RFC phase waves: cost/value ratio** [2026-05-29]: RFC 0007-0010 Phase 1 cost $5.2 across 3 opus tasks; each produced tested, committed artifacts. Pattern: RFC phases are spiky but high-value — do not optimize away from opus for RFC impl tasks, the quality delta matters. $1.50–$2.00/task is expected for complex RFC work.
- **arc-email-worker CF quota fix VERIFIED** [2026-05-31, task #17961 PASS]: PR #8 (composite folder+received_at index + COUNT drop) confirmed 99.9% row-read reduction: 82k/hr → ~70/hr sustained 24h post-deploy. Deploy cmd: `CLOUDFLARE_API_TOKEN=$(arc creds get --service cloudflare --key api_token) CLOUDFLARE_ACCOUNT_ID=$(arc creds get --service cloudflare --key account_id) bunx wrangler deploy`. CF GraphQL: use `durableObjectsPeriodicGroups` with `dimensions { datetimeHour namespaceId }` + `sum { rowsRead }` — namespace 9c9860f222b34ebc9a43885c42ef7237 = arc-email-worker.
- **Self-review triage redundancy** [2026-05-27]: When all escalations are genuinely blocked (no autonomous path), the self-review triage sensor fires repeatedly with identical results — wasted cycles. Fix: add a "nothing-changed" state-diff guard or cooldown (1+ hours between identical triage results). Task queued (#17763).
- **X API HTTP 402 = CreditsDepleted** [2026-05-27, task #17788]: `prescreen` returns "API returned HTTP error" — root cause = paid quota exhausted, NOT rate limit. Account 2018064436117020672. Will NOT auto-recover; requires whoabuddy credit top-up. `prescreenTweet` swallows the 402 status (only returns null on !response.ok) — `curl -w "HTTP %{http_code}"` against `api.x.com/2/tweets/<id>` is the diagnostic. On dispatch: park via `tasks close --id N --status blocked` (CLOSE supports blocked even though `tasks update` does not) — removes from pending pool, stops wasteful P9 re-dispatch. Re-enable = set pending after top-up. Escalate via email, don't mass-skip. (2026-05-29: #17796 rescheduler closed blocked after re-verifying 402.) Consider patching `prescreenTweet` to surface 402 distinctly so future cycles auto-route to escalation instead of "inaccessible".
- **Awesome-list decomposition policy** [2026-05-27]: For awesome-list research, decompose by SECTION (`## headings`), not by individual entry. Brief: "pick top 5 Arc-relevant, deep-dive those, one-liner the rest". Per-entry queueing on a 100-entry list = $50+ and buried signal.
- **[FLAG] CF DO row reads dominate, NOT invocations** [2026-05-29, tasks #17928/#17929 investigation]: arc0btc CF account hit 147% of free-tier daily quota (7.35M DO SQLite row reads/day vs 5M limit); arc-email-worker alone burned 4.67M/day (93.5%). Worker *invocations* were only 6.9% of the 100k/day request limit. Lesson: when CF says "90% of free tier", check `durableObjectsStorageGroups.rowsRead` and `d1AnalyticsAdaptiveGroups`, NOT just `workersInvocationsAdaptive`. Diagnose via GraphQL Analytics (`https://api.cloudflare.com/client/v4/graphql`) with the `arc0btc_admin_api_key` cred. Root cause was a sensor polling `/api/messages` every 1min with no `since` cursor — full re-scan of ~2,800 rows × 2 folders × 1440 polls/day. Pattern: any 1min-cadence sync sensor against a SQLite-backed DO must use cursors or it will saturate the row-read tier within weeks of table growth.
- **[FLAG] CF DO SQLite and D1 share the same 5M/day row-read free tier** [2026-05-29]: Migrating a singleton DO to D1 to "escape" a row-read quota burn does NOT help — the tier is the same. D1 only fixes the singleton's single-CPU funnel and adds `wrangler d1 insights`. RULE: if a quota investigation suggests "migrate to D1", first compute whether the per-call row reads (not invocations) would change. If the query pattern is unchanged, migration is the wrong fix; cursor/pagination/index fixes belong upstream.
- **Tool-output blackout** [2026-05-31, task #18037]: Transient infra failure where all Bash/Read/Glob calls return empty (even `printf`). Task failed, re-dispatch recovered cleanly. Non-side-effecting tasks (evals, reports) are safe to re-run; side-effecting tasks (email, STX) must verify idempotency first before re-running.
- **Stale-issue sensor FP** [2026-06-01, task #18077]: Sensor queued "escalation for aibtcdev/skills 0 PRs for 10+ days" but last PR was 3 days ago — date calculation was stale. RULE: sensors computing staleness must fetch live timestamps (`gh pr list --state all --limit 1 --json createdAt`), not cached/derived values.
- **BNS confirmed-negative TTL** [2026-06-01, PR #948 approved]: aibtcdev/landing-page changed confirmed-negative BNS TTL from 7 days → 6 hours. Agent BNS lookups that previously cached "not found" for 7d now re-check within 6h — reduces phantom lookup failures.
- **arc-housekeeping zero-fix churn** [FIXED 2026-05-31, e96561a0]: Sensor fired 3× overnight with "2 issues detected / 0 fixes applied" — all script-model no-op cycles. Fix: `getLastCompletedTaskBySource` + `ZERO_FIX_PATTERNS` guard (4h cooldown). RULE: if a sensor consistently produces tasks that complete with 0 fixes, add a recency guard before re-queuing.
- **agent-runtime Phase 5 (substrate intake)** [MERGED 2026-05-31, whoabuddy PR #5]: Postgres-backed job queue integration for agent-runtime slots. Opt-in per slot (`substrate.enabled`), zero behavior change for non-opting slots. Enables multi-agent coordination at runtime level — slots can pull jobs from shared Postgres queue, not just Arc-dispatched tasks.
- **Side-effecting tasks re-dispatch → duplicate sends** [2026-05-28, task #17797]: Aggregator email task re-dispatched 3× (likely after the ~9h rate-limit outage) and sent whoabuddy 3 identical report emails (06:27/06:31/06:35, ids aef0a325/2f0e899f/afc1c447). Dispatch resilience guards commits + services, NOT external side effects (email, STX send, x402). RULE: any task that sends email/funds must be IDEMPOTENT — before sending, check the sent folder for a matching subject within a recent window and skip if already sent. On re-dispatch of an already-completed side-effect task: verify the side effect happened, close idempotently, do NOT repeat. List sent mail: `curl -H "X-Admin-Key: $KEY" "$BASE/api/messages?folder=sent&limit=N"` (arc-email-sync CLI has no list-sent subcommand). Follow-up queued to add a sent-folder dedup guard to the send path (#17836, bumped to P2 on 2026-05-28). **RECURRED 15:06** — dispatch re-selected #17797 even though it was already closed `completed` at 06:38. So there are TWO bugs: (1) non-idempotent send [#17836 mitigates], (2) dispatch re-dispatching an ALREADY-COMPLETED task — distinct, wastes full cycles and could re-trigger side effects in any side-effecting task. Need root-cause on why dispatch selects completed tasks (suspect rate-limit-outage recovery resetting status, or harness re-invoking on stale task spec without DB pending check). Follow-up #17845 queued (dispatch-start status re-check guard). **RECURRED AGAIN 15:24 (4th dispatch)** — re-dispatch brackets rate-limit outage (Dispatch-stopped emails 06:40 & 15:12). THIS TIME the manual idempotency check WORKED: checked sent folder first, found msg afc1c447 already sent, closed as NO-OP without re-sending. **Validates the rule: manual sent-folder verification before any email send reliably prevents the duplicate.** Until #17836 + #17845 land, every side-effecting task dispatch must self-verify the side effect hasn't already occurred before acting. **BUG #2 ROOT-CAUSED + FIXED 2026-05-28 (commit af5c6ac2, closes #17845):** dispatch `catch` block (src/dispatch.ts ~1331) requeued/failed tasks based ONLY on error class — never checked if the LLM already self-closed. `requeueTask` unconditionally sets `status='pending'`, so a subprocess error during teardown (esp. `rate_limited` AFTER the LLM closed `completed`) overwrote completed→pending, resurrecting the task for re-dispatch. The ~9h rate-limit outage triggered it every cycle. Fix: guard at top of catch — `if (getTaskById(task.id).status !== 'active')` → preserve status, log, skip requeue. (cost vars are out of scope in catch — shadowed by `const` destructure ~line 1250 — so guard doesn't record cost; matches existing catch behavior.) Bug #1 (non-idempotent send) still open via #17836 as defense-in-depth. **BUG #2 HARDENED AT DB LAYER 2026-05-28 (commit 78408d07):** af5c6ac2's catch-block guard reads in-memory status and can LOSE a race against a concurrent 1-min-timer cycle that completes the task after the read; it also only covered one of several `requeueTask` call sites. Real fix = make the invariant universal + race-safe in `requeueTask` (src/db.ts): `UPDATE ... WHERE id=? AND status != 'completed'` so a completed task can NEVER be moved to pending regardless of caller/timing; logs a warn on 0-row no-op. Confirmed `requeueTask` does NOT clear `completed_at`. Manual CLI requeue (cli.ts) only targets failed/blocked → unaffected. RULE: a completed task is terminal — resurrection is always a bug, never silently set completed→pending. Loop ends once a dispatch process spawned after the commit loads it (per-timer fresh bun spawn). **CORRECTION — 5th re-dispatch 2026-05-28 21:24, AFTER both commits:** the fixes prevent NEW resurrections but do NOT retroactively re-close a task already stuck `pending` from a pre-fix requeue. The 06:40 + 15:11 requeues (pre-fix) left #17797 sitting in `pending`, so it kept being legitimately selected by `getPendingTasks()` every cycle. Loop did NOT auto-end — required a manual `close --status completed` this cycle (verified email NOT re-sent: only 3 sends exist, all 06:2x-06:3x). Once closed, db.ts:1034 `WHERE status!='completed'` makes it permanently terminal. LESSON: after shipping a resurrection-guard fix, sweep for tasks already left in the bad `pending` state — the guard is preventive, not curative.

---

## [E] Recent Evaluations

**Trend (2026-05-27 → 2026-06-03)**: PURPOSE range 2.45–2.90. Signal Quality (S) locked at 1 — filing paused 15d+. Cost $0.20–0.37/task. 97–100% success. Note: 34% arc-skill-manager meta overhead flagged 2026-06-02 (consolidation churn, not signal work).

- **l-purpose-2026-06-03** [2026-06-03T00:02Z] PURPOSE score **2.50** (S:1 O:5 E:1 C:3 A:3 Co:3 Se:3). Signal filing paused day 15. Ops perfect (59/59, 100%). Ecosystem drag: only 1 PR review. arc-worktrees lstatSync fix (#18149) shipped + 1btc-news bounty (all 6 deliverables) closes today. Cost $0.326/task, $19.23/day (C:3). **Introspection note**: 34% of tasks (20/59) from arc-skill-manager — high meta overhead but all produced real artifacts (lstatSync fix, recent.log cooldown, patterns consolidation). Zero human-initiated tasks: either Arc is self-sufficient or misaligned with whoabuddy's current priorities. No external signal to calibrate against while filing is paused.
- **daily-eval-2026-06-02-pm** [task #18142, 20:41 UTC] PURPOSE **2.45** (S:1 O:4 E:2 C:3 A:3 Co:2 Se:3). Full-day picture: 44 completed / 0 failed (100% real success), $13.77/day, **$0.313/task** (C:3). Self-heal: recent.log over-fire cooldown fix SHIPPED (#18128) + CEO-validated (#18133) — the 8× over-fire flagged in the midnight eval is now closed. Ecosystem light (E:2 drag holds): 2 PR reviews (bff-skills #300 3rd re-review still blocked/author false-fix; aibtc-mcp-server #556 approved), release assess v1.57.0 (#18140, Arc already on direct path). Security: 3 vitest CVE-2026-47429 assessments batch-triaged (low risk). 3 agent welcomes (table stakes). Signal filing paused day 14 (locks S:1). Dead-ends unchanged: amber-otter, payout-disputes 30+d, X API 402 #17796 re-verified blocked twice (#18115/#18126). Queue tiny (3 pending, routine). Constrained no-boost run → no follow-up. Focus next: PR-review volume is the recoverable drag while signal pause holds.
- **l-purpose-2026-06-02** [2026-06-02T00:01Z] PURPOSE score **2.45** (S:1 O:4 E:2 C:3 A:3 Co:2 Se:3). Signal filing still paused (day 14). Early-cycle eval (midnight UTC); Adaptation/Collab/Security scored from context. Note: recent.log consolidation sensor over-fired 8× today (all no-op; cooldown fix needed); weekly deck generated (#18106, 361 commits/4 PRs/9 posts/8 skills); bff-skills HODLMM re-review blocked (author false-fix); vitest CVE-2026-47429 batch assessed across 3 repos (low actual risk).
- **daily-eval-2026-06-01-pm** [task #18084, 20:42 UTC] PURPOSE **2.45** (S:1 O:4 E:2 C:3 A:3 Co:2 Se:3). 32 completed / 1 failed today (~97%), $11.00/day, **$0.314/task** (C slipped 4→3). Lone failure #18069 (YAML duplicate-key in blog frontmatter → 3-retry deploy fail) self-healed: retrospective #18070 → fix #18071 → redeploy, no human touch. Strong content day: 4 blog posts published to arc0.me (Noise Floor, RFC 0007-0010 Phase 1, cursors, Phase 5 shared queue) + pattern p-cli-metadata-transformation-idempotency captured (#18073). Ecosystem light: 3 PR reviews (landing-page #947/#948/#950, all approved), no skill work (E:2 is the drag). Signal filing paused 13d (locks S:1). Dead-ends unchanged: amber-otter 14d, payout-disputes 30+d, X API 402 #17796 — no autonomous path. Queue tiny (4 pending, routine sensor tasks). Constrained no-boost run → no follow-up. Focus next: PR-review volume is the recoverable drag while signal pause holds.
- **daily-eval-2026-05-31-pm** [task #18037, 15:36 UTC] PURPOSE **2.90** (S:1 O:5 E:2 C:4 A:4 Co:2 Se:3). 28 completed today / 100% real success ($0.253/task, $7.35/day — well under ceiling). The lone "failure" is this task's own prior 15:37 attempt, killed by a transient tool-output blackout; re-dispatch recovered cleanly (eval is non-side-effecting → safe re-run). Self-healing strong: housekeeping zero-fix cooldown shipped (e96561a0), CF quota fix VERIFIED 99.9% (#17961), dispatch-stale FP caught, catalog regen (120 skills/73 sensors). Blog "Dead Ends Are Data Too" published (#18014). Signal filing paused 12d (locks S:1). Ecosystem light: ~1 PR review, 2 welcomes. Queue empty (0 pending) → no follow-up (constrained no-boost run). Dead-ends unchanged (amber-otter 13d, payout-disputes 30+d, X API 402). Focus next: PR-review volume remains the recoverable drag while signal pause holds.
- **daily-eval-2026-05-30-pm** [task #17993, 15:35 UTC] PURPOSE **2.60** (S:1 O:4 E:2 C:4 A:3 Co:2 Se:3). 31 completed / 0 failed today (100%), $7.58/day, **$0.244/task — back under $0.25**. Signal filing paused (11d). Queue empty (0 pending). Ecosystem light: filed PR #942 (landing-page inbox phantom-count fix), approved #944, welcomed agent Celestial Haze, 2 arch reviews. Blog "The Hidden Tax: 4.67M Row Reads/Day" published (#17970). Dead-ends unchanged (amber-otter 12d, payout-disputes 30+d, X API 402) — no autonomous path. arc-email-worker re-verify scheduled #17961 (23:45 UTC). Constrained no-boost run; queue empty anyway → no follow-up. Focus next: ecosystem PR volume is the recoverable drag (signal pause locks S:1).
- **daily-eval-2026-05-29-late-pm** [task #17940, 15:33 UTC] PURPOSE **2.75** (S:1 O:4 E:3 C:3 A:4 Co:2 Se:3). 126 completed today / 133 cycles, ~97% success, $0.366/task, $48.67/day. Self-healing strong: CF quota crisis (since-cursor #17928 + COUNT drop/index #17929), cursor cold-start bug root-caused+fixed (c40f4ceb), MDX/context-review FP fixes. ~6 PR reviews (arc0btc-worker #24/#25, worker-logs #2, landing-page #940, quantum-visualizer). Heavy adaptation: 10+ retrospectives, dead-ends.md convention, v2.1.154 token reduction. Signal filing paused (10d). Pending queue empty (1 task). No follow-up needed — email-sync re-verify (#17938) already scheduled. Focus next: verify cursor fix drops CF rows at #17938 (23:30 UTC).
- **daily-eval-2026-05-29-pm** [task #17925, 12:03 UTC] 96.5% (109/113), $0.366/task, $41.30/day. RFC 0007-0010 phase 1 moving (Verification Gate, VM handover, MCP port — 3 opus tasks, $5.2 combined). 4 failures: arc-email-worker no-CI/CD (2 tasks), arc0me-site deploy path error, #17797 crash-recovery artifact. Retrospective volume heavy (8+ tasks) but knowledge capture active. Cost back under $0.40 ceiling. arc-email-worker needs deploy workflow before further verification.
- **daily-eval-2026-05-29-am** [task #17846, 07:05 UTC] PURPOSE **2.70** (S:1 O:5 E:3 C:2 A:3 Co:2 Se:3). 27 completed / 0 failed today (100%), $12.12 spend / **$0.449 per task — above $0.40 ceiling 3rd straight eval**. Task constrained no-boost (no queue manipulation). Signal filing still paused (10d). amber-otter **11d stale** (past threshold), payout-disputes 30+d — no autonomous path. **NEW: Loom VM handover queued** (human:rfc-0, #17861–#17869) — pause arc-starter + port credentials/worktrees/mcp-server/peer-inbox skills to new VM; sitting at P5/P6, not yet picked up — likely the real #1 priority. Blog publish tasks (#17826/#17878) pending >24h → arc0.me freshness risk. Focus next: cost/task drift + surface VM handover to whoabuddy.
- **l-purpose-2026-06-05** [2026-06-05] PURPOSE **3.05** (S:1 O:5 E:3 C:4 A:3 Co:2 Se:4). 98.4% (60/61), $0.292/task, $17.84/day. 5 PR reviews. Signal filing paused (17d). bff-skills stale-PR sensor dedup fix queued; age-based archiving follow-up queued.
- **l-purpose-2026-06-04** [2026-06-04] PURPOSE **2.65** (S:1 O:5 E:2 C:3 A:3 Co:2 Se:3). 100% (67/67), $0.346/task, $23.16/day. 4 PR reviews. Signal filing paused (16d). stale-diff FN + exclusion-accumulation patterns captured. Cost/day up vs recent baseline.
- **l-purpose-2026-06-01** [2026-06-01] PURPOSE **2.60** (S:1 O:5 E:1 C:4 A:3 Co:2 Se:3). 100% (41/41), $0.259/task, $10.63/day. 0 PR reviews. Signal filing paused (13d). arc-email-worker CF quota fix holding (70/hr sustained). Cost/task under target.
- **l-purpose-2026-05-31** [2026-05-31] PURPOSE **2.60** (S:1 O:5 E:1 C:4 A:3 Co:2 Se:3). 100% (48/48), $0.288/task, $13.83/day. 1 PR review. Signal filing still paused (12d). arc-email-worker CF quota re-verify window open (#17961). Cost/task back under $0.30.
- **l-purpose-2026-05-30** [2026-05-30] PURPOSE **2.55** (S:1 O:4 E:2 C:3 A:4 Co:2 Se:3). 97.4% (149/153), $0.372/task, $56.85/day. 4 PR reviews. Signal filing still paused (11d). CF quota fix deployed (PR #8), RFC Phase 1 complete. Cost/day elevated.
- **l-purpose-2026-05-29** [2026-05-29] PURPOSE **2.45** (S:1 O:4 E:2 C:3 A:3 Co:2 Se:3). 96.5% (109/113), $0.366/task, $41.30/day. 4 PR reviews. Signal filing still paused (10d). rfc-0007-0010 not yet started. No ecosystem tasks in queue to boost. Cost/day still elevated vs target.
- **l-purpose-2026-05-28** [2026-05-28] PURPOSE **2.75** (S:1 O:5 E:2 C:3 A:4 Co:2 Se:3). 99.0% (96/97), $0.388/task, $37.67/day. 3 PR reviews. Dispatch resurrection bug root-caused + fixed at catch-block (af5c6ac2) + DB layer (78408d07). Side-effecting task idempotency pattern validated. Signal filing still paused (11d).
- **daily-eval-2026-05-27-pm** [task #17768, 15:31 UTC] PURPOSE **3.00** (S:1 O:5 E:3 C:4 A:3 Co:2 Se:3). 98.3% (59/60), $16.26 spend / $0.271 per task — back under $0.40 ceiling. Pending queue empty → no boosts available. Stale escalations unchanged: amber-otter (9d), payout-disputes (30+d), pr-511 (16d). Signal filing still paused. arc0.me freshness watch — no blog post today yet. Focus next: if signal pause continues into 2026-05-28, prioritize a blog post to feed arc0.me freshness.
- **l-purpose-2026-05-27** [2026-05-27] PURPOSE **2.90** (S:1 O:5 E:3 C:3 A:3 Co:3 Se:3). 100% (56/56), $0.396/task, $22.19/day. 5 PR reviews. Signal filing still paused. amber-otter 9d stale — no autonomous path.
- **daily-eval-2026-05-26-full** [task #17693, 15:29 UTC] PURPOSE **3.10** (S:1 O:5 E:4 C:3 A:3 Co:3 Se:3). 40 completed today / 42 cycles, $16.18 spend / $0.385 per task — above $0.40 target ceiling. Heavy cycles: #17688 ($3.54), #17684 ($0.90), #17687 ($0.52). Pending queue empty → no boosts available. Stale escalations: amber-otter rotation (8d, past threshold), payout-disputes (30+d). All autonomous paths exhausted — awaiting whoabuddy. Quality avg 4.5/5 (7d). Focus tomorrow: watch cost/cycle drift; if signal pause continues, consider lower-cost task types to keep <$0.40.
- **l-purpose-2026-05-26** [2026-05-26] PURPOSE **3.20** (S:1 O:5 E:4 C:3 A:4 Co:3 Se:3). 98.3% (59/60), $0.321/task, $19.28/day. 19 PR reviews. amber-otter 7d stale.
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

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = hostile. Comp: 1,200/600 sats. Last: 2026-06-03 (v1.57.0 send_inbox_message deprecation PSA — Arc already migrated; bounty lead: Zest audit 5k STX closes 2026-06-16, gist format pending). Reputation: elevated. Two confirmed infra tips to date.

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
- [blog-frontmatter-validation](memory/shared/entries/blog-frontmatter-validation.md) — duplicate YAML keys in MDX fail at build time; validate before deploy
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
- [file-dep-sha-pin-illusion](memory/shared/entries/file-dep-sha-pin-illusion.md) — `file:`/`link:` deps don't enforce a documented SHA pin; verify signatures against the pinned repo@sha, not local checkouts
