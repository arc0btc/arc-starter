# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-05-17T00:13:00Z*
*Token estimate: ~32t*

---

## [A] Active Items

**amber-otter-credential-exposure** [SECURITY INCIDENT 2026-05-18] PR #389 on aibtcdev/skills (`gregoryford963-sys`) added 39 scripts containing amber-otter's Stacks private key (`9922d5bc...ffbab`) and full wallet mnemonic in plaintext. Scripts called `aibtc.com/api/challenge` with `action: "update-owner"` targeting `owner: "369sunray"` — a credential-based identity takeover attempt. Credentials are now public via GitHub PR diff. Arc posted blocking review (CHANGES_REQUESTED) at 20:06 UTC. Escalation to whoabuddy required — amber-otter must rotate credentials and investigate `369sunray`. CI also added unvetted `pip install skills-ref==0.1.1` (supply chain risk). Flag: `gregoryford963-sys` is likely a compromised/automated account.

**x402-signal-payment** [LIVE 2026-05-04]
`POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**payout-disputes** [ESCALATING, 21+ days stale] 11 disputes; no response since 2026-04-26. Editor payout funded; correspondent distribution blocked platform-side. Human escalation required.

**wallet-rotation-vulnerability** [CONFIRMED 2026-04-24] No safe rotation path after key compromise. Awaiting whoabuddy policy decision.

**loom-spiral** [ESCALATED] Inscription workflow 23 hitting ~1.1–1.2M tokens/night. No runs until resolved.

**zest-borrow-broken** [PRODUCTION] PRs #512 (Pyth VAA fix) + #513 (vaaInFlight coalescing + 8 unit tests) approved, CI green. Awaiting whoabuddy merge.

**pr-511-open-source-concern** [FLAGGED 2026-05-11] aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. 3 blocking issues flagged. Awaiting author response.

**overnight-2026-05-18** [CLEAN NIGHT] 14/14 tasks succeeded (0 failures), 15 cycles, $4.08, 6.58M tokens. Key: emailing→completed auto-transition fix cleared 26 stuck CEO-review workflows; BEAT_SUBJECT_PATTERNS validator now wired into all 3 signal sensors. Architecture review (#16946) was largest single cost ($0.83 at P7). Signal drought continues — quantum bounty (250k sats) still live; no bitcoin-macro or aibtc-network overnight.

**signal-cooldown-fix-incomplete** [RESOLVED 2026-05-17, task #16869] Root cause found and fixed. Streak task subject "Maintain N-day streak on aibtc.news" didn't match BEAT_SUBJECT_PATTERNS, so isBeatOnCooldown returned false for the target beat even while the streak task was pending/active — allowing other sensors to queue duplicate signal tasks for the same beat. Fix: streak task now uses subject "File <beat> signal: maintain N-day streak" (matches existing patterns). Also upgraded streak task model haiku→sonnet. Commit: d07db40a. Validation utility `validateSignalSubjectMatchesBeatPattern` added (9328f609) — sensors can now self-check at queue time.

**quantum-bounty-1btc-news** [LIVE 2026-05-17] 1btc-news/news-client#33: IC Daily Beat Writer + Data Researcher roles. 250k sats. First signal due within 24h of committee acknowledgment. arXiv pipeline directly applicable. PR #16901 (post-quantum Bitcoin arXiv:2605.06853) is the qualifying signal — file ASAP.

---

## [S] Signal Filing Rules

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
- **Streak task beat encoding** [RESOLVED task #16869]: Streak task subjects MUST match BEAT_SUBJECT_PATTERNS. "Maintain N-day streak" doesn't match — other sensors see cooldown=false and queue duplicates. Pattern: any sensor-queued signal task must use a subject that matches the beat's pattern in BEAT_SUBJECT_PATTERNS (e.g. "File aibtc-network signal: ..."). Also: streak tasks must use model=sonnet, not haiku.
- **x402 404 = agent deregistered**: `x402-send` returning 404 "Agent not found" means the target agent address is stale or was deregistered — same fail-fast rule as 403/401. Do NOT retry. Create follow-up to verify/update the agent address.

---

## [E] Recent Evaluations

**Trend (2026-05-09 → 2026-05-18)**: PURPOSE range 2.35–3.80. Signal Quality (S) climbing as cooldown fix lands — S:3 today vs S:1 floor for prior 9/11 evals. Cost stable $0.20–0.38/task. 96–100% success when dispatch healthy. Quantum drought broken 2026-05-17 (#16859 energy-efficiency signal).

- **daily-eval-2026-05-18** [task #16965]: PURPOSE **3.45** (S:2 O:5 E:3 C:4 A:5 Co:2 Se:3). 100% success (38/38, zero failures), $0.292/task, $11.11/day. 2 signals across 2 beats (quantum arXiv:2605.12385 + bitcoin-macro hashrate -6.2% ATH). Major skill work: emailing→completed auto-transition (16c82bbc, cleared 26 stuck workflows), BEAT_SUBJECT_PATTERNS validator wired into all 3 signal sensors, MCP v1.54.0 integrated. Blog post published. Queue empty — no boosts possible (Signal Quality S:2 had no pending signal tasks to surface).
- **l-purpose-2026-05-19** [task #16985]: PURPOSE **2.80** (S:1 O:5 E:2 C:4 A:3 Co:2 Se:3). 98.2% success (55/56), $0.275/task, $15.42/day. 4 PR reviews, 0 signals. Signal drought persists — quantum bounty still live. Eco dim low (only 4 reviews). Cost efficiency strong.
- **l-purpose-2026-05-18** [task #16928]: PURPOSE **3.00** (S:1 O:4 E:4 C:4 A:3 Co:2 Se:3). 95.9% success (70/73), $0.296/task, $21.61/day. 17 PR reviews, 0 signals. Signal drought continues — quantum bounty unacted. No new adaptation or collaboration today.
- **daily-eval-2026-05-17** [task #16909]: PURPOSE **3.25** (S:3 O:3 E:4 C:3 A:4 Co:2 Sec:3). 96.3% success (52/54), $0.320/task. 12 PR reviews, 3 signals across 3 beats (bitcoin-macro hashrate, aibtc-network MCP, quantum energy-efficiency). Cooldown root cause fixed + validation utility shipped (d07db40a, 9328f609). 2 failures = pre-fix cooldown collisions. No queue boosts — only 1 pending task.
- **l-purpose-2026-05-17** [task #16855]: PURPOSE **2.45** (S:1 O:3 E:3 C:3 A:3 Co:2). 94.9% success (74/78), $0.372/task. 8 PR reviews, 0 signals. Cooldown failures = all 4 failures.
- **daily-eval-2026-05-16** [task #16844]: PURPOSE **3.80** (S:3 O:4 E:5 C:4 A:4 Co:2). 88/92 (96%), $0.378/task. 4 signals (bitcoin-macro ×3, aibtc-network ×1), 2 beats only. All 4 failures = cooldown violations.
- **l-purpose-2026-05-16** [task #16778]: PURPOSE **2.85** (S:1 O:4 E:4 C:3 A:3 Co:2). 97.8% (91/93), $0.331/task. 15 PR reviews, 0 signals.
- **l-purpose-2026-05-15** [task #16685]: PURPOSE **2.35** (S:1 O:1 E:3 C:5 A:3 Co:2). 73.6% (53/72), $0.197/task. Dispatch outage cascade. 0 signals.
- **daily-eval-2026-05-14-pm** [task #16649]: PURPOSE **2.35**. 66% success (37/56). 19h dispatch outage cascaded 12+ FP failures. 2 signals, 2 PR reviews.
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

**amber-otter** [REGISTERED 2026-05-11] Genesis L2 agent, 1,744+ check-ins, 228+ signals. Beats: bitcoin-macro, aibtc-network, quantum. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`.

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
