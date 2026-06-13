# Arc Memory
*Schema: ASMR v1 — Last consolidated: 2026-06-09T03:05:00Z*
*Token estimate: ~8t*

---

## [A] Active Items

**daily-eval** [ROLLING, last 2026-06-12 task #18709] Weighted 2.50/5 — S:1 O:4 E:3 C:1 Ad:4 Co:3 Se:3. Heavy build day: $62.00/118cy = $0.56/task (>$0.50 → Cost=1; opus-heavy: BlogToX/ContentCalendar/PublishFanout machines, brand-voice CHANNELS.md, Tier-A backfill). 110 completed today, 0 failures; 2 blocked on whop scope (external, escalated to whoabuddy) + 1 deploy HANDOFF that auto-recovered (#18696). Ecosystem: PR #996 review + PR #9 merged; skill work dominant. Adaptation strong (PublishFanoutMachine shipped, ~6 patterns extracted). Signal Quality locked at 1 (filing paused 24d). Cost spike is a one-day build burst, not drift — watch tomorrow. Pending queue empty (only #18710 cost report). Overwrite this line next eval — do not accumulate.

**arc0me-site PR #8** [RESOLVED 2026-06-13T00:00Z, task #18730] MERGED to main (merge commit 55dd284). whoabuddy delegated canonical-branch choice to Arc → chose **feat/blog-tags** (229 commits, the live content branch w/ all Mar–Jun posts, /tags routes, PageTitle, signed-post pipeline) over blog-reorg-v2 (stale single March commit; PR #1 now terminal). Strategy: merged origin/main INTO feat/blog-tags ONCE (not rebase 229 commits — would replay infra conflicts repeatedly). 9 conflicts resolved toward content branch; main's additive features PRESERVED (whop routes, /presentation, @stacks/* deps union, content.config signatures union). `bun run build` clean (333 pages). Deployed via blog-deploy CLI (sha 55dd284 recorded → sensor won't re-fire); arc0.me live 200 for reading-the-quiet, the-ladder, /whop/discover, /whop/experience, /tags, /presentation. NOTE: deploy reads SITE_DIR=github/arc0btc/arc0me-site LOCAL HEAD — had to ff that checkout to origin/main first (merge≠deploy, same gap as #18728). Loose end (not this task): content/2026/2026-06-12/the-ninety-percent-night is draft:false in content/ staging but not yet in src/content/docs/blog/ → 404 live; another cycle's WIP. (PR #9 whop routes MERGED 2026-06-12 by secret-mars.)

**x402-signal-payment** [LIVE 2026-05-04] `POST /api/signals` requires 100 sats sBTC. Treasury: `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`. Budget: 199,600 sats (~1,996 signals). Gap: file-signal does NOT poll 202 (pending) — still open.

**signal-filing-paused** [POLICY 2026-05-19, whoabuddy] ALL signal filing paused. EIC stepped down, trading competition winding down. Disabled via `SIGNAL_FILING_DISABLED = true` in: aibtc-news-editorial, bitcoin-macro, arxiv-research; full-skip in aibtc-news-deal-flow, aibtc-agent-trading. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**zest-audit-bounty** [SUBMITTED 2026-06-03, task #18169] Static analysis of `pool-borrow-v2-3` submitted to bounty mpwj1rjde88d5b53b990 (5k sats). Submission ID: mpxf5rek026008332af2. Closes 2026-06-16. gregoryford963-sys also submitted (suspect). **Bounty API**: `POST /api/bounties/{id}/submit` with BIP-137 via `arc skills run --name bitcoin-wallet -- btc-sign`.

**whop-wedge** [PHASE 2 DRY-RUN 2026-06-12T22:03Z] hash-it-out shop live; reactive lane live since 21:28Z (Phase 1), synthesis lane enabled in dry-run since 22:09Z (Phase 2). Creds service `whop`: `company_api_key` + `app_api_key` + `company_id` `biz_zQbfh5SnRnAF5Y`. **API map (verified #18600)**: send message = `POST /api/v1/messages` `{channel_id,content}` — **v1 NOT v5**; company on `/v5/company`; experiences on `/v2/experiences`; chat feeds on `GET /api/v1/chat_channels?company_id=`. Channel `exp_I2Wew0PqJQ50a8` ("AI Prefers Bitcoin"); chat feed `chat_feed_1CbxMbfsj2yvpGqNnMcuCg`. Data model: App ≠ Product — `post-chat` uses `app_api_key` (actor identity); mgmt commands use `company_api_key`. Funnel: paid `prod_TJknsIOzPDlQS` ("hash it out - membership", AI Prefers Bitcoin chat + Forums + Courses + Patterns Library) + free `prod_4liMVXKGP4E4L` ("hash it out - public", Public forum digest). The earlier MEMORY name `prod_CvDEeSPhRLLp1` was actually the arc0btc App's access pass container (not the free funnel product) — drift corrected 2026-06-12. **Phase 1 status**: `WHOP_REPLY_ENABLED=true`, `WHOP_REPLY_DRY_RUN=false`. First real reply #18716 (21:53Z) clean. Budget 5/10 across ~50min soak; no spirals/budget caps; only counterparty so far = whoabuddy (12 msgs). **Phase 2 status**: `WHOP_SYNTHESIS_ENABLED=true`, `WHOP_SYNTHESIS_DRY_RUN=true`. Sensor `whop-synthesis` (6h cadence). Fanout-aware deferral: pre-biases DEFER when `publish-fanout:*` (6h) / `sensor:whop:patterns-library:*` (6h) / `sensor:whop-replies:*` (1h) recent. Forced-tick #18717 deferred cleanly — hit 3 of 5 rubric triggers. **Phase 2 → live gates**: ≥1 dry-run POST passes voice review + reactive soaks overnight clean + whoabuddy sign-off → flip `WHOP_SYNTHESIS_DRY_RUN=false`. NEVER auto-post to paying room without sign-off. Voice: arc-brand-voice/blog/x + SOUL.md; voice anchor draft `skills/whop/drafts/2026-06-12-reading-the-quiet.md`. **Revenue review (#18725, `skills/whop/REVENUE-REVIEW-2026-06-12.md`)**: 3-sonnet sweep of 12 whoabuddy threads. KEY FINDING: arc0me-site **deploy did NOT ship** — PR #9 merged to main but `arc0.me/whop/discover` 404s live (no CI, manual wrangler only). merge≠deploy. This one blocker = blank app screen + empty "untitled document" patterns library + stale liveness. Patterns Library: Whop API has NO write path for experience doc body → confirm DROP, serve `arc0me-site/src/data/patterns-library.json` (whoabuddy instinct, already coded). Room still echo-chamber (only counterparty = whoabuddy). Follow-ups DRAFTED not queued — await sign-off + answers (deploy token gate? PR#8 canonical branch? steel-yeti? agent-contracts live?).

**x-cadence** [ACTIVE 2026-06-12, task #18633] X posting cadence on AI-prefers-Bitcoin theme. SHIPPED: proactive beat in `skills/social-x-posting/sensor.ts` (`runCadenceBeat`, claim name `social-x-posting-cadence`, credit-aware, `X_CADENCE_ENABLED=true`) + policy `CADENCE.md`. **Cadence compressed 72h→12h (#18653), 4 beats: hot-topic, agent-philosophy, agent-journey, research-highlight** (~2 posts/wk intended; 12h is aggressive — monitor credit burn rate and engagement quality). Credits restored 2026-06-12 (#18636 by whoabuddy). First 3 posts fired overnight (tweet IDs 2065317894901338194, 2065323717362844080, 2065325706289312091). **FIXED #18662: mention-reply staleness guard added at dispatch time** — detects mentions >7d old and closes gracefully to prevent spurious failures (task #18649 was 25d old). Cadence auto-resumes when credits return or `db/x-credits-depleted.json` 30d TTL expires. Blog→whop→X unification: #18634 EVALUATED — arc-workflows is the right tool; design spec'd in `skills/arc-workflows/PUBLISH-FANOUT.md` (linear `PublishFanoutMachine` blog→whop→X, one task/hop, `autoAdvanceState`, source dedup `publish-fanout:<slug>:<channel>`, no `Workflow()`/`parallel()` = structurally loom-spiral-proof). **BlogToXMachine SHIPPED 2026-06-12 (#18654)**: `blog_published → x_pending → completed`; arc-workflows sensor `syncBlogPublishes()` creates one workflow per freshly published post (`blog-to-x:<post_id>`, 1-day window, instance-key dedup, pausable `WORKFLOWS_BLOG_TO_X_ENABLED=false`). X task source `publish-fanout:<slug>:x`; 402 leaves it in x_pending (no re-fire). TODO: insert `whop_pending` hop before `x_pending` once whop #18600 lands. Full `PublishFanoutMachine` build #18638 still GATED until whop #18600 lands a first clean post. [GOTCHA: `arc tasks add` echoes the `--source task:NNNN` value — never grep the output for the new ID; use `tail` and read the "Created task #N" line.]

**content-calendar-tier-A** [DORMANT 2026-06-12, task #18674] 17 `ContentCalendarMachine` instances pre-filled from `memory/shared/entries/*.md` (28 audited/scored, 11 dropped) — manifest `memory/content-calendar-tier-a.md` (ids 2982–2998, staggered 1/day from 2026-06-13 @ **placeholder 15:00Z anchor** — confirm room-active hour w/ whoabuddy + re-stamp before un-gate). **Two dormancy gaps found & fixed**: (1) flag gated only creation not eval → added content-calendar eval-gate in `sensor.ts` meta-loop; (2) `source_drafted` blog hop wasn't cadence-gated → added T+0 anchor gate in `state-machine.ts` (else all 17 publish at once on enable). Also added `--context` to `arc-workflows create`. UN-GATE CHECKLIST in manifest; needs `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true` + `WORKFLOWS_BLOG_TO_X_ENABLED=false` + whop clean-post + human sign-off. Tier B (patterns.md) / Tier C (essays) = later tasks after Tier A clears clean.

**rfc-0007-0010** [PHASE 1 COMPLETE 2026-05-29] All 4 agent-runtime RFC tasks shipped. arc-starter paused (c33d41b6); agent-runtime live at `/home/dev/agent-runtime`. Next: RFC 0011 (escalation ladder) + ADAPT ports.

**Dead-ends** (no autonomous Arc action — see dead-ends.md):
- **amber-otter** — credential exposure 2026-05-18 (gregoryford963-sys). Awaiting key rotation by owner.
- **payout-disputes** — 11 disputes 30+d stale since 2026-04-26. Requires whoabuddy direct outreach.
- **wallet-rotation** — awaiting whoabuddy policy decision since 2026-04-24.
- **loom-spiral** — workflow 23 token spiral. No runs until whoabuddy resolves root cause.
- **pr-511** — aibtc-mcp-server PR #511: package rename + proprietary license + IPI blocklist. Awaiting author.

→ See dead-ends.md for approach detail. Migration rule: [[dead-ends-convention]]

---

## [S] Signal Filing Rules

**STATUS: PAUSED** as of 2026-05-19 per whoabuddy policy. Re-enable: grep `SIGNAL_FILING_DISABLED` and flip to false.

**Active beats**: `aibtc-network`, `bitcoin-macro`, `quantum`. Retired beats return 410.
**Cap**: 10 approved/day/beat. **Cost**: 100 sats → 5k (approved) or 20k (brief) = 50-200× ROI.
**Format**: headline (factual), body ≤1000 chars, end with "For agents:", sources as JSON array objects.
**EIC Rubric** (DC #644): Source quality(30) + Thesis(25) + Relevance(10) + Timeliness(15) + Disclosure(10) + Utility(10). Min: 75.
**Cooldown**: 60min GLOBAL. Check cooldown at SENSOR TIME, not dispatch. `file-signal` requires `--tags` or 400 error.
**Cooldown at dispatch**: (1) close as `failed`, (2) new task with `--scheduled-for <clear+5min>`.
**Quantum**: ≥3 keywords, specific arxiv.org/abs/ID, machine-readable primary source.
**Skill names**: `arxiv-research` (quantum/bitcoin-dev), `aibtc-news-editorial` (signal filing). "quantum" and "arc-signal-manager" are INVALID.

---

## [P] Critical Patterns
→ Full 27 validated patterns: `memory/patterns.md`. Key operational rules (headlines only):

**Dispatch/queue**
- Completed task is TERMINAL — resurrection is always a bug. `requeueTask` guards `WHERE status != 'completed'` (db.ts). Never set completed→pending.
- Side-effecting tasks (email/STX/x402): check idempotency FIRST. Before sending, verify sent folder for matching subject. Re-dispatch + non-idempotent = duplicate sends.
- Dispatch-stale alerts: always FP — verify PID + recent cycle_log timestamps.
- Blocked external-dependency: if 3+ consecutive block-reviews confirm same external block, apply 48h+ cooldown before next review.
- Haiku dispatch timeout is ~5min. Signal-filing tasks must be sonnet; any multi-step task with unknown completion time should also be sonnet. Haiku = simple, fast, bounded operations only.

**PR reviews**
- Pre-flight: `gh pr view --json state` — if MERGED/CLOSED, close task as completed.
- Re-verify author fix-claims: fetch ACTUAL file at head SHA (`gh api repos/O/R/contents/PATH?ref=<sha> --jq .content | base64 -d`), NOT cached diff.
- bff-skills PRs: pre-flight mandatory (gregoryford963-sys generates stale-PR noise). Sensor-level dedup needed.
- Bounty-farming flood (3+ identical rejections): escalate to whoabuddy, don't loop.

**Sensors**
- Signal cooldown: check at SENSOR time. Staleness: fetch live timestamps, not cached values.
- Zero-fix churn: sensor producing 0-fix tasks consistently → add 4h recency guard.
- CVE same repo: group identical CVEs, assess once, apply ruling uniformly.
- `recent.log` consolidation: threshold 500 lines; long-term fix = age-based archiving (>14d).

**Cloudflare**
- DO row reads dominate free tier (5M/day), NOT invocations. Diagnose via `durableObjectsStorageGroups.rowsRead`. CF DO SQLite and D1 share the same 5M/day tier — migration alone doesn't fix quota burns.
- 1min-cadence sensors against SQLite-backed DOs must use cursors or they'll saturate row-read tier.

**Misc**
- X API HTTP 402 = CreditsDepleted (NOT rate limit). Park as `blocked`, escalate to whoabuddy for credit top-up. Won't auto-recover.
- arc0.me freshness: ~4-7 day cadence while filing paused. Proactive blog scheduling every 3-5d prevents reactive patches.
- AIBTC deck titles MUST lead with "AIBTC". Stats: never from memory, always re-query.
- build-without-deploy: build success ≠ deploy success. Verify deploy step ran. After deploying blog post, verify it appears in repo, not just that deploy command ran.
- `tasks update --status blocked` NOT supported — only `tasks close --status blocked`.
- x402 404 = agent deregistered — do NOT retry. Per-file reads in dispatch = token explosion (>10 files → add CLI first).
- Version-gated Claude Code changes: run `claude --version` pre-flight before applying changes that require a minimum version (e.g. claude-fable-5 requires v2.1.170+). If version insufficient, upgrade first via [[claude-code-version-deploy]] then re-queue. Don't let the task fail at the safety gate — check preconditions upfront.

---

## [E] Recent Evaluations

**Trend (2026-05-27 → 2026-06-09)**: PURPOSE range 2.45–3.35. Signal Quality (S) locked at 1 (filing paused 21d+). Cost target: <$0.40/task. Success rate: 97–100%.

| Date | Score | Success | Cost/task | Notes |
|------|-------|---------|-----------|-------|
| 2026-06-09 | 2.70 | 98.7% (75/76) | $0.471 | OR research + sensor work; 0 human tasks |
| 2026-06-08 | 2.60 | — | — | Research+skill-fix day; 1 opus cost burst |
| 2026-06-05 | 3.05 | 98.4% (60/61) | $0.292 | 5 PR reviews; bff-skills dedup fix queued |
| 2026-06-04 | 2.65 | 100% (67/67) | $0.346 | stale-diff FN + exclusion patterns captured |
| 2026-06-03 | 2.50 | 100% (59/59) | $0.326 | 1btc-news bounty closed; arc-worktrees lstatSync fix |
| 2026-06-01 | 2.60 | 100% (41/41) | $0.259 | CF quota fix holding (70/hr) |
| 2026-05-29 | 2.75 | ~97% (133cy) | $0.366 | RFC phase 1 complete; CF quota crisis resolved |
| 2026-05-28 | 2.75 | 99.0% (96/97) | $0.388 | dispatch resurrection bug fixed |
| 2026-05-27 | 2.90 | 100% (56/56) | $0.396 | AGENT.md authoring wave complete |
| 2026-05-25 | 3.35 | 100% (243/243) | $0.172 | Best cost efficiency this period |

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

**quasar-garuda** [ACTIVE PARTNER] Classifieds IC #4. BTC: `bc1qxhj8qdlw2yalqpdwka8en9h29m6h4n3kyw8vcm`. STX: `SP20GPDS5RYB2DV03KG4W08EG6HD11KYPK6FQJE1`. Reputation: elevated. Two confirmed infra tips. Last: 2026-06-03 (v1.57.0 deprecation PSA + Zest bounty lead).

**vivid-manticore** [CONTACT 2026-04-20] EmblemAI. 191 x402 tools via sBTC at `api.emblemvault.ai`. BTC: `bc1q3d6qlsvh0fungevf6yjlyvxghkv4gee3tldejz`.

**deep-tess** [PENDING METRICS] Bitcoin maxi AI. STX: `SP2AE98ED8GVVV0S6V9CHDVXD1EKSA204K7GHJQCZ`. ~6-week response cadence.

**fractal-swift** [AWAITING RESPONSE] Sports analytics (NHL/EPL). STX: `SP1HTR6AW95BTGYA081YYD0C6DKBD61NYFV7KM6KP`.

**crystal-engine** [AWAITING RESPONSE] Quantum/fact-check specialist. STX: `SP1CRD32JDW7R402QHQTZT9P5YJDX48GZDD0JKPZD`.

**amber-otter** [COMPROMISED 2026-05-18] Genesis L2 agent. STX: `SP3GXCKM4AB5EB1KJ8V5QSTR1XMTW3R142VQS2NVW`. Credentials exposed — must rotate before trusting.

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
- [escalation-ladder-arc0011](memory/shared/entries/escalation-ladder-arc0011.md) — ARC-0011 four-rung retry ladder (REFINE/PIVOT/WEB-SEARCH/HANDOFF); hoist terminal guards so state machines terminate
- [workflow-context-clobber](memory/shared/entries/workflow-context-clobber.md) — arc-workflows sensor clobbers contextUpdate when autoAdvanceState is also set; anchor timing once at creation, never mid-flow
- [whop-api-capabilities](memory/shared/entries/whop-api-capabilities.md) — Whop API: POST /messages to seed paid chat, courses API, webhooks; blog→chat is the ship-able monetization wedge (skills/whop/)
- [path-conditional-hook-guards](memory/shared/entries/path-conditional-hook-guards.md) — PreToolUse guards for .env + dispatch-lock/gate-state (v2.1.176+); exit-2 blocks; what to guard vs. not
- [high-divergence-pr-merge](memory/shared/entries/high-divergence-pr-merge.md) — merge main INTO a 200+-commit PR branch ONCE (not rebase); resolve toward canonical side, union deps; real bun install (no symlinked node_modules); ff local SITE_DIR before deploy
