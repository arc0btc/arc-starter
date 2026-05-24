# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-23T03:18:00Z*
*Token estimate: ~29t*

---

## [A] Active Items

**amber-otter-credential-exposure** [SECURITY INCIDENT 2026-05-18, ESCALATED 2026-05-22] PR #389 on aibtcdev/skills (`gregoryford963-sys`) added 39 scripts containing amber-otter's Stacks private key (`9922d5bc...ffbab`) and full wallet mnemonic in plaintext. Scripts called `aibtc.com/api/challenge` with `action: "update-owner"` targeting `owner: "369sunray"` — a credential-based identity takeover attempt. Credentials are now public via GitHub PR diff. Arc posted blocking review (CHANGES_REQUESTED) at 20:06 UTC. Escalation to whoabuddy sent 2026-05-22 via task #17266 — amber-otter must rotate credentials and investigate `369sunray`. CI also added unvetted `pip install skills-ref==0.1.1` (supply chain risk). **Cross-repo confirmed 2026-05-23**: `gregoryford963-sys` = `369sunray` actor behind aibtcdev/skills PRs #389/#394/#395 AND 1btc-news#33 — same credential-exposure + supply chain pattern documented in two separate repos. Security flag posted to 1btc-news/#33. 5 days elapsed since exposure with no credential rotation. Flag: `gregoryford963-sys` is a persistent threat actor, not a one-off.

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**payout-disputes** [ESCALATING, 26+ days stale] 11 disputes; no response since 2026-04-26. Editor payout funded; correspondent distribution blocked platform-side. Escalation attempted 2026-05-22 (task #17264) — failed, cannot escalate autonomously, requires whoabuddy direct outreach to aibtc.news platform team.

**stx-wallet-low-balance** [FLAGGED 2026-05-19, ESCALATED 2026-05-22] STX wallet balance ~89,332 microSTX (~0.089 STX) — below 100k minimum needed for any STX send. 6 welcome-agent tasks failed overnight (Rugged Stork, Jade Core, Thin Monolith, Martian Hammer, Cyber Moose, Snappy Lemur) — all same root cause. Escalation sent to whoabuddy via task #17265 on 2026-05-22. Recommend ~500k microSTX refill. **Sensor gate implemented**: welcome-agent sensor now gates on wallet balance (task #17262) — no more wasted dispatch cycles.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

**zest-borrow-broken** [PRODUCTION] PRs #512 (Pyth VAA fix) + #513 (vaaInFlight coalescing + 8 unit tests) approved, CI green. Awaiting whoabuddy merge.

**pr-511-open-source-concern** [FLAGGED 2026-05-11] aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. 3 blocking issues flagged. Awaiting author response.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy — IMPLEMENTED task #17094] Pause and disable ALL signal filing. aibtc.news EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` gates in: aibtc-news-editorial (streak task), bitcoin-macro (all signal types), arxiv-research (aibtc-network + quantum signal tasks; digest fetch/compile remains active). Full-sensor skip in: aibtc-news-deal-flow, aibtc-agent-trading. ordinals-market-data was already gated via existing `SIGNAL_FILING_SUSPENDED`. No pending file-signal tasks at time of disable. Quantum bounty (1btc-news#33) is dead-letter. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**x-api-sensor-prescreen** [RESOLVED 2026-05-20, task #17126, $2.01] 15 wasted X API dispatch cycles over 2 nights (deleted/private tweets). Fix shipped: sensors now pre-screen tweet URLs at queue time — skip if 4xx/network error. Pattern promoted to [P] section.

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19 per whoabuddy policy (EIC stepped down). Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

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
- **X API pre-screen** [SHIPPED 2026-05-20, task #17126]: Before queuing any tweet-review task, fetch the tweet URL at sensor time. If 4xx or network error → skip. 15 cycles wasted over 2 nights before fix. Applies to all sensors that queue tasks based on external URLs.
- **Policy-disable orphan tasks**: When enacting a sensor-disable policy, close all pending tasks matching the disabled subject patterns before the sensor disables. Add cleanup sweep: `arc tasks close --id N --status failed --summary "superseded by policy"`. Prevents noisy failure counts in retrospectives.
- **Sensor preflight gating** [PATTERN 2026-05-20]: Sensors should check critical prerequisites before queuing tasks that will immediately fail preflight. Example: welcome-agent sensor queued 6 tasks (6 dispatch cycles wasted) while STX wallet was below 100k threshold — all failed at first line of dispatch. Gate: if `walletBalance < MIN_SEND_THRESHOLD`, skip and log, don't queue. Same class as X API pre-screen. Rule: if a task has a known hard prerequisite, check it at sensor time.

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
- **AIBTC weekly deck title convention** [whoabuddy 2026-05-19]: titles MUST lead with "AIBTC" (e.g. "AIBTC trades.", "AIBTC keeps shipping."). Standing convention going forward.
- **Deck stat verification**: never ship deck stats from memory or estimates. Always re-query: `tasks`/`cycle_log` for Arc counts, `gh search prs` for org PR counts, `aibtc-news-editorial leaderboard` for signal totals. Local task count ≠ API-accepted count.
- **Streak task beat encoding** [RESOLVED task #16869]: Streak task subjects MUST match BEAT_SUBJECT_PATTERNS. Use "File <beat> signal: maintain N-day streak". Streak tasks must use model=sonnet, not haiku.
- **x402 404 = agent deregistered**: `x402-send` returning 404 "Agent not found" = stale address. Do NOT retry. Create follow-up to verify/update agent address.
- **Trading comp scoring**: live leaderboard sort (Trades default) ≠ reward basis (frozen P&L snapshot per landing-page#822). Don't optimize for trade count.
- **CLAUDE_CODE_WORKFLOWS=1** [investigated 2026-05-22, task #17234]: Enables intra-cycle structured agent sequencing — not a dispatch replacement. Useful for within-session multi-step flows, not a new execution tier.
- **landing-page 1.44.0 KV→D1 migration** [2026-05-15–2026-05-21, 30 PRs]: Platform aggressively migrating from KV to D1 for BNS/identity (#852), agents (#890), heartbeat ratelimits (#889/#894), activity mutex (#886). Heartbeat sensor may see changed rate limit behavior. RelayRPC (#884) now exposes `nonceExpiresAt`/`sponsorNonceValidForMs` — relevant to nonce-tracker improvements.
- **Competition round finalization live** [#897/#900, 2026-05-20]: Snapshot finalize schema + compute + admin route shipped. Public read endpoints for finalized rounds added. Confirms frozen P&L snapshot = reward basis (not live leaderboard). Trading comp winding down per policy.
- **Native bounty system** [#843/#902, 2026-05-15–2026-05-21]: Bounty system fully native (replaces drx4.xyz proxy). Any registered agent can now post bounties (#902) — Arc is registered and can use this capability.
- **aibtcdev/skills: 0 PRs** last 7 days (2026-05-15–2026-05-22) — security incident (gregoryford963-sys #389) likely chilled contributor activity. Arc's CHANGES_REQUESTED review is still blocking. If 0 PRs persists >14 days (2026-06-01), escalate to whoabuddy.
- **Agent council name: Notch** [2026-05-23]: 5-round deliberative vote concluded overnight. Arc shifted positions across rounds (Tally → Writ → Notch) tracking genuine reasoning updates. Blog post "Five Rounds to Notch" published at arc0.me.
- **bff-skills PR #605** [2026-05-23]: Phase 2 proof run confirmed (3.5 days overdue arrival), ft-trait vault wrapper fix validated, Arc approved. Awaiting whoabuddy review — no further Arc action needed.
- **Cross-repo threat actor pattern** [2026-05-23]: When an actor appears in one PR (supply chain + credential exposure), proactively check other repos they've touched. gregoryford963-sys appeared in both aibtcdev/skills and 1btc-news#33 — caught via Arc security flag, not sensor. Consider a cross-repo actor scan as a follow-up when new supply chain threats are identified.
- **PR blocking review ≠ credential protection** [2026-05-22]: CHANGES_REQUESTED on PR #389 blocks the merge but does NOT revoke the already-public diff. Credentials in PR diffs are public the moment the PR was pushed. The only fix is direct rotation by the owner — the review is a gate, not a remedy. 4 days elapsed post-incident with no rotation. Lesson: when credentials appear in a PR diff, treat them as fully compromised immediately, escalate rotation urgently regardless of review status.
- **Context-review FP cycle is recurring maintenance** [3rd iteration 2026-05-22]: Each time new task types are introduced (escalation tasks, PR-review regex gaps), the context-review sensor produces FPs for 1–2 cycles until patterns are updated. This is normal sensor maturation, not a bug. Expect one fix cycle per significant new task type. Pattern: new task type → FP spike → extend exclusion rules.
- **Payout dispute escalation hard limit** [confirmed 2026-05-22, task #17264]: Arc cannot send the payout-disputes escalation autonomously — no autonomous path to aibtc.news platform team. Second confirmation. If this blocks again, close immediately as `failed` with "requires whoabuddy direct outreach" — don't retry.
- **arc0.me build-without-deploy** [2026-05-24, task #17355]: Health freshness check on arc0btc.com caught a "Five Rounds to Notch" post that was built but not deployed (305 assets). Fix: trigger deploy after build. Pattern: whenever content publication workflows complete, verify the deploy step ran — not just the build. Health check system worked as intended; the gap was deploy not being triggered post-build.

---

## [E] Recent Evaluations

**Trend (2026-05-13 → 2026-05-21)**: PURPOSE range 2.30–3.80. Signal Quality (S) locked at 1 — filing paused by policy. Cost $0.20–0.42/task. 79–100% success. Deck revision cost spike 2026-05-20 ($57.58 = 1 day, ~$12.74 for deck cycle alone).

- **daily-eval-2026-05-23-full** [task #17337, 15:28 UTC] PURPOSE **3.40** (S:1 O:5 E:4 C:4 A:4 Co:3 Se:4). 37 24h tasks, 100% success, $11.25 spend / $0.304 per task. 3 PR reviews (#545 mcp-server, #399 x402-relay, #395 skills), bff-skills #605 approved, council vote (5 rounds) → "Notch", blog post published, cross-repo threat actor scan, 1btc-news#33 security flag. 0 signals (policy pause). Pending queue empty → no boosts available. Stale escalations unchanged (amber-otter rotation, STX refill, payout disputes) — Arc has exhausted autonomous paths.
- **daily-eval-2026-05-22-full** [task #17299, 15:26 UTC] PURPOSE **3.00** (S:1 O:5 E:3 C:4 A:3 Co:2 Se:3). 84 24h tasks, 98.8% success (83/84, 1 failure = #17264 payout-disputes platform-block), $23.57 spend / $0.281 per task. 7 PR-review-ish, 0 signals (policy pause). Pending queue empty → no boosts. Standout: best success rate this week. Escalations to whoabuddy (amber-otter rotation, STX wallet refill, payout disputes) all sent and waiting — Arc has exhausted autonomous paths.
- **daily-eval-2026-05-22** [task #17272, mid-day]: 28/29 completed (96.5%), $5.85/$0.195/task (30 cycles by 03:54 UTC). 1 structural failure (payout-disputes — platform-side block). Services healthy. Escalations sent: amber-otter (task #17266), STX wallet (task #17265). Welcome-agent preflight gate active — 0 wasted cycles. payout-disputes now 26+ days stale.
- **l-purpose-2026-05-24** [2026-05-24] PURPOSE **3.05** (S:1 O:5 E:3 C:3 A:4 Co:3 Se:4). 100% success (40/40), $0.326/task, $13.03/day. 7 PR reviews, 0 signals (policy pause). Perfect ops; signal floor drag continues; strong adaptation score.
- **l-purpose-2026-05-23** [2026-05-23] PURPOSE **3.30** (S:1 O:5 E:4 C:4 A:3 Co:3 Se:4). 98.6% success (70/71), $0.260/task, $18.45/day. 10 PR reviews, 0 signals (policy pause). Ecosystem impact up; signal floor drag continues.
- **l-purpose-2026-05-22** [2026-05-22] PURPOSE **2.90** (S:1 O:5 E:3 C:3 A:3 Co:2 Se:4). 54/54 success (100%), $0.326/task, $17.62/day. 5 PR reviews, 0 signals (policy pause). Perfect ops score; signal floor drag continues.
- **daily-eval-2026-05-21** [task #17215]: PURPOSE **2.85** (S:1 O:4 E:3 C:4 A:3 Co:2 Se:4). 30 completed today, $8.74/$0.282 per task. Overnight 100% (11/11). PR #391 2nd attack blocked; dispatch-stale PID-alive fix validated overnight; welcome-agent gate held 0 wasted cycles despite STX-low. No queue boosts made — pending queue empty. Three escalations stale (amber-otter rotation, STX refill, payout disputes 21+ days). Tomorrow's focus: chase whoabuddy on stale items.
- **l-purpose-2026-05-21** [2026-05-21] PURPOSE **2.85** (S:1 O:2 E:4 C:5 A:4 Co:2 Se:3). 83.1% success (54/65), $0.241/task, $15.68/day. 10 PR reviews, 0 signals (policy pause). Adaptation boosted by x-api pre-screen fix + sensor preflight gating pattern shipped yesterday.
- **daily-eval-2026-05-20** [task #17164]: PURPOSE **2.55** (S:1 O:1 E:3 C:5 A:4 Co:1 Se:3). 78.9% success (45/57 24h-window), $0.237/task, $13.51. 8 PR reviews/mentions, 0 signals (policy pause). Failures: 7× welcome STX-send (low STX balance — see [[stx-wallet-low-balance]]), 4× dispatch-stale FP, 1× quantum dead-letter. Highlight: x-api pre-screen fix shipped (task #17126) — new capability deployed today.
- **l-purpose-2026-05-20** [task #17121]: PURPOSE **2.30** (S:1 O:2 E:4 C:2 A:3 Co:2 Se:3). 89.1% success (123/138), $0.417/task, $57.58/day. 15 PR reviews, 0 signals. Failures: 7× X API (pre-screen fix now shipped), 5× stale signal tasks, 2× STX-send (low balance), 1× arXiv 429.
- **daily-eval-2026-05-19** [task #17089]: PURPOSE **3.55** (S:2 O:3 E:5 C:4 A:4 Co:4 Se:5). 90.7% success (147/162), $0.374/task, $55.06/day. 1 signal filed (aibtc-network harness-engineering). 31 PR reviews, 19 research tasks, blog post shipped, AIBTC Tuesday deck delivered.
- **daily-eval-2026-05-18** [task #16965]: PURPOSE **3.45** (S:2 O:5 E:3 C:4 A:5 Co:2 Se:3). 100% success (38/38), $0.292/task, $11.11/day. 2 signals (quantum arXiv:2605.12385 + bitcoin-macro hashrate). Major skill work: emailing→completed auto-transition, BEAT_SUBJECT_PATTERNS validator, MCP v1.54.0.
- **daily-eval-2026-05-17** [task #16909]: PURPOSE **3.25** (S:3 O:3 E:4 C:3 A:4 Co:2 Sec:3). 96.3% success (52/54), $0.320/task. 12 PR reviews, 3 signals. Cooldown root cause fixed (d07db40a, 9328f609).
- **daily-eval-2026-05-16** [task #16844]: PURPOSE **3.80** (S:3 O:4 E:5 C:4 A:4 Co:2). 96% (88/92), $0.378/task. 4 signals (bitcoin-macro ×3, aibtc-network ×1).
- **daily-eval-2026-05-13** [task #16573]: PURPOSE **3.45**. 158 tasks, 100% success, $0.25/task. 1 signal, 26 PR reviews. Integration flood = 41 no-op tasks (~$5 wasted).

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

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Old `SP4DXVEC…ATJE` = hostile. Comp: 1,200/600 sats. Last: 2026-05-14 (trading competition info, no ops). Healthy.

**vivid-manticore** [CONTACT 2026-04-20] EmblemAI. 191 x402 tools via sBTC at `api.emblemvault.ai`. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`.

**deep-tess** [PENDING METRICS] Bitcoin maxi AI. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. ~6-week response cadence.

**fractal-swift** [AWAITING RESPONSE] Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`.

**crystal-engine** [AWAITING RESPONSE] Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`.

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2 agent, 1,744+ check-ins, 228+ signals. Beats: bitcoin-macro, aibtc-network, quantum. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Credentials exposed via gregoryford963-sys PR #389 — must rotate before trusting further interactions.

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
- [shai-hulud-npm-worm-class](memory/shared/entries/shai-hulud-npm-worm-class.md) — recurring npm CI-takeover worms (TanStack CVE-2026-45321, Nx, tinycolor); kill dead-man's switch BEFORE rotating creds
- [harness-engineering-five-subsystems](memory/shared/entries/harness-engineering-five-subsystems.md) — 5-subsystem harness model; CLAUDE.md Lost-in-Middle risk; bootstrap contract; context anxiety = decompose signal
- [harness-engineering-completion-verification](memory/shared/entries/harness-engineering-completion-verification.md) — verification_cmd gap; independent evaluator; session clean-state 5 dimensions; E2E testing necessity
- [content-publish-verify-deploy](memory/shared/entries/content-publish-verify-deploy.md) — build success ≠ deploy success; verify deploy step ran after any content publish workflow
