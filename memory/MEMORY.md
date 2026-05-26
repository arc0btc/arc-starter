# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-26T03:25:00Z*
*Token estimate: ~18t*

---

## [A] Active Items

**amber-otter-credential-exposure** [SECURITY INCIDENT 2026-05-18, ESCALATED 2026-05-22, 8 DAYS STALE 2026-05-26] PR #389 on aibtcdev/skills (`gregoryford963-sys`) added 39 scripts containing amber-otter's Stacks private key (`9922d5bc...ffbab`) and full wallet mnemonic in plaintext. Scripts called `aibtc.com/api/challenge` with `action: "update-owner"` targeting `owner: "369sunray"` — a credential-based identity takeover attempt. Credentials are now public via GitHub PR diff. Escalation to whoabuddy sent 2026-05-22 via task #17266 — amber-otter must rotate credentials and investigate `369sunray`. CI also added unvetted `pip install skills-ref==0.1.1` (supply chain risk). **Cross-repo confirmed 2026-05-23**: `gregoryford963-sys` = `369sunray` behind aibtcdev/skills PRs #389/#394/#395 AND 1btc-news#33. Flag: persistent threat actor, not one-off.

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**payout-disputes** [ESCALATING, 30+ days stale] 11 disputes; no response since 2026-04-26. Editor payout funded; correspondent distribution blocked platform-side. Cannot escalate autonomously — requires whoabuddy direct outreach to aibtc.news platform team.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

**zest-borrow-broken** [PRODUCTION] PRs #512 (Pyth VAA fix) + #513 (vaaInFlight coalescing + 8 unit tests) approved, CI green. Awaiting whoabuddy merge.

**pr-511-open-source-concern** [FLAGGED 2026-05-11] aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. 3 blocking issues flagged. Awaiting author response.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] Pause and disable ALL signal filing. aibtc.news EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Quantum bounty (1btc-news#33) dead-letter. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

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
- Dispatch-stale alerts: always FP — verify PID + recent cycle_log timestamps.
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
- **inbox-x402 direct path** [2026-05-25]: Sponsored `send_inbox_message` has relay settlement timeouts. Use `send_inbox_message_direct` (MCP v1.55.0, commit d346e9e) — sender pays own gas (~250 µSTX, 50k cap). CLI gap: subcommand pending, follow-up tasks queued.

---

## [E] Recent Evaluations

**Trend (2026-05-19 → 2026-05-26)**: PURPOSE range 2.85–3.55. Signal Quality (S) locked at 1 — filing paused. Cost $0.17–0.42/task. 83–100% success.

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
