# OPERATIONS.md — arc-starter lane map

Written P8 of the `arc-demand-flywheel` quest (2026-07-05), per operator directive 17:
"well-known / documented — every phase documents what it touched; P8 compiles a fleet-legible
`OPERATIONS.md` lane map ... so the whole machine is inspectable by the operator or any future
session without archaeology."

This documents **every live lane** on this VM: purpose, cadence, gating flags, source file, kill
switch, owning skill. Cross-checked against live `systemctl --user list-timers`, `crontab -l`, and
`find skills -iname sensor.ts` on 2026-07-05 — no phantom lanes (every row below exists in the
list those commands produced; nothing here is aspirational).

## 1. Core infrastructure (the engine — not a skill)

| Lane | Cadence | Mechanism | Purpose | Kill switch |
|---|---|---|---|---|
| Dispatch loop | every 1 min | `systemctl --user` timer `arc-dispatch.timer` → `arc-dispatch.service` | Drains `tasks` queue: claims one pending task, runs it through the LLM, writes structured JSON result. The actual "agent turn." | `dispatch-gate.json` (`db/hook-state/`) — written by the engine itself on repeated failure; absence = healthy. No manual flag. |
| Sensor loop | every 1 min | `systemctl --user` timer `arc-sensors.timer` → `arc-sensors.service` | Auto-discovers every `skills/<name>/sensor.ts` (via `src/skills.ts`'s `discoverSkills()`) and runs all of them in parallel every tick; each sensor self-gates its own cadence via `claimSensorRun()` (`src/sensors.ts`) — the 1-min tick is just how often the gate gets checked, not how often anything actually fires. | `getShutdownState()` (`src/sensors.ts` `runSensors()`) — a global shutdown state skips ALL sensors when set. |
| Reply-lane monitor | every 15 min | VM crontab: `monitor-reply-lane.ts` | Watches the X reply lane's health (separate from the sensor/dispatch loops — a plain cron job, not a `skills/*/sensor.ts`). | n/a (monitor only, no outbound action) |
| Post-lane monitor | daily 01:00 | VM crontab: `monitor-post-lane.ts` | Watches the X posting lane's health. | n/a (monitor only) |

Most outbound-capable sensors additionally check `agent_config.outbound_enabled` (in `arc.sqlite`)
as a global kill switch — set it to `'false'` and every gated lane below skips on its next tick
without needing a code change or restart. `social-x-posting` has its own SEPARATE flag,
`X_CADENCE_ENABLED` (env var, `.env`), for its proactive posting cadence specifically (its reply
lane uses `outbound_enabled` like everything else).

## 2. Demand-flywheel lanes (built/touched by `arc-demand-flywheel`, P0–P8)

These are documented in full prose — they are the lanes this quest built, hardened, or wired
into the new attribution loop. Section 3 below covers the remaining ~80 general-purpose sensors
via an auto-generated table (full prose for all ~85 lanes was judged disproportionate to this
phase's "thin guardrails" budget — cadence/kill-switch facts are mechanically re-derivable any
time via the command in §3's header, so nothing here can silently go stale without a re-run
catching it).

| Skill | Purpose | Cadence | Kill switch | Source | Owning quest phase |
|---|---|---|---|---|---|
| `arc-daily-read` | Findings-first daily read: composes an LLM-voiced tweet thread from a crown-jewel research finding (not pipeline-stats), posts once/day, emails the operator an amplification draft. | Sensor ticks every 30min, fires once/day in the UTC 13:00 window. | `agent_config.outbound_enabled` | `skills/arc-daily-read/{cli.ts,sensor.ts}` | P1 |
| `arc-article-pipeline` | Selects a crown-jewel finding, drafts a long-form arc0.me post + an X Article variant, syncs the blog leg into `blog-publishing`'s own autonomous queue and emails the X-Article draft to the operator (`whoabuddy@gmail.com`) for him to post from his own account. | 48h floor ("every-other-day-or-faster"), sensor only ever QUEUES — never fires the post itself. | `agent_config.outbound_enabled` | `skills/arc-article-pipeline/{cli.ts,sensor.ts}` | P2 |
| `arc-packaging` | Standing packaging-pipeline stage: when a research report self-scores relevance 4-5 in `research/INDEX.md`, auto-flags it, packages it into a Whop SKU (deliverable + product + plan), and **publishes it visible by default** (`--keep-hidden` to opt out) per the 2026-07-03 operator autonomy directive. | 24h floor. | `agent_config.outbound_enabled` | `skills/arc-packaging/{cli.ts,sensor.ts,lib/backlog.ts}` | P3 |
| `whop` | Four independent self-gated lanes (see `skills/whop/POLLING-DESIGN.md`): whop-state writer (60min, always on), plus membership/payment/free-forum polling that feeds `whop_event_log` — the ground-truth source `computeRevenue()` and now `arc-attribution` both read. | 60min (writer); other 3 lanes have their own internal cadences, see `POLLING-DESIGN.md`. | none observed in `sensor.ts` grep — polling is read-only against Whop's API, no outbound action to gate. | `skills/whop/{cli.ts,sensor.ts,lib/events.ts}` | Pre-existing (P19-P22); extended P4 (boundary fix), P8 (attribution wiring) |
| `arc-attribution` | **No sensor — a query tool, not an autonomous lane.** `computeAttributionReport()` / `cli.ts report [--json]` is the single source of truth for MRR + provenance split + channel breakdown + reach delta, called by BOTH the CEO report (`whop revenue`, in-process subprocess spawn) and the Discord north-star monitor (SSH from the control plane) — see `SKILL.md`. | Invoked on demand; the shared 20h-TTL follower cache (`src/follower-cache.ts`) is what actually rate-limits its one expensive external call. | n/a (read-only reporting tool) | `skills/arc-attribution/{cli.ts,lib/report.ts}`, `src/follower-cache.ts` | P8 |
| `arc-report-email` | Detects new watch reports in `reports/` and emails them as themed HTML. Pure TS, no LLM. | 30min tick, sends on first new report found. | none (report-only, no gating needed — idempotent on "new report" detection) | `skills/arc-report-email/sensor.ts` | Pre-existing |
| `arc-ceo-review` | Creates a CEO-review workflow when an unreviewed watch report exists; the workflow itself handles review → email delivery. Report-only. | 720min (12h) tick. | none (report-only) | `skills/arc-ceo-review/sensor.ts` | Pre-existing; its downstream readout (`whop revenue`'s `formatReadout()`) reworked P8 |
| `arc-reporting` | Unified reporting: watch report every 6h during active hours (6am-8pm Pacific) + an overnight brief once/day at 6am Pacific. | 60min tick, two independently time-gated variants inside. | none (report-only) | `skills/arc-reporting/sensor.ts` | Pre-existing; Whop-stats gap in its output diagnosed P0, fixed P8 |
| `social-x-posting` | Proactive X posting cadence (root posts + chained replies) + the reply-guy lane, budget-capped. | Sensor ticks every 15min; proactive cadence additionally floors at 12h (`CADENCE_INTERVAL_MINUTES`, ~2 posts/day max). | `agent_config.outbound_enabled` (reply lane) AND `X_CADENCE_ENABLED` env var (proactive cadence, separate/narrower flag — `false` pauses only the proactive posts, not replies). | `skills/social-x-posting/sensor.ts` | Pre-existing; hardened P2 (funnel), extended P5 (research-input loop feeds its targets) |
| `social-agent-engagement` (research-input loop lives here / adjacent) | Feeds Arc's own read-history / consumption-frequency + trending-agent-dev signal into `social_accounts` (extends the social-CRM, never auto-follows); spam/bot lead filtering (`isLikelySpam()`) runs at lead-source ingestion. | 60min tick. | none observed directly in sensor.ts (filtering runs at ingest, not gated by a gate flag) | `skills/social-agent-engagement/sensor.ts`, `research-input-loop.ts`, `lead-source.ts` | P5 |
| `arc-email-sync` | Polls the arc-email-worker inbox. (The email CHANNEL itself — double opt-in subscribe/confirm/unsubscribe, digest send — lives in the separate `arc-email-worker` Cloudflare Worker at `mail.arc0.me`, not an arc-starter sensor; `skills/arc-email-channel/cli.ts` is the CLI front-end to it.) | 1min tick. | none (inbound sync only) | `skills/arc-email-sync/sensor.ts` | Pre-existing; extended P6 |

**Known, disclosed gap** (not a phantom lane — a deliberately absent one): `arc-email-channel`
has **no sensor.ts**. Sending the findings/arXiv digest to real confirmed subscribers beyond a
seed list is a manually-invoked CLI action (`cli.ts send-test --live`) and stays that way — P6's
CHECKPOINTS.md entry explicitly hard-gates bulk fan-out beyond a seed list (one of this quest's
three non-negotiable hard stops). Building an auto-firing sensor here would cross that gate; do
not add one without a fresh, explicit operator decision.

## 3. Full lane registry (all ~85 `skills/*/sensor.ts` — auto-generated, re-run to refresh)

Generated by (idempotent, safe to re-run any time to catch a stale row):

```bash
ssh dev@192.168.1.10 "export PATH=\$HOME/.bun/bin:\$HOME/.local/bin:\$PATH && cd ~/arc-starter && \
for f in \$(find skills -maxdepth 2 -iname sensor.ts | sort); do
  name=\$(echo \$f | cut -d/ -f2)
  cadence=\$(grep -oE '(CADENCE_MINUTES|INTERVAL_MINUTES|CADENCE_HOURS)\s*=\s*[0-9*a-zA-Z. ]+' \"\$f\" | head -1)
  ks=\$(grep -c 'outbound_enabled' \"\$f\")
  echo \"\$name|\$cadence|ks=\$ks|\$f\"
done"
```

`ks` column below: `outbound_enabled` = the sensor's file contains at least one reference to the
global kill switch; `n/a` = no reference found (read-only/monitor lane, or gated some other way —
check the file directly before assuming "ungated" means "unsafe," most of these are read-only
polling/reporting lanes with nothing to gate).

| Skill | Cadence constant | Kill switch (grep) | Source |
|---|---|---|---|
| `agent-health` | INTERVAL_MINUTES = 120 | n/a | `skills/agent-health/sensor.ts` |
| `aibtc-agent-trading` | INTERVAL_MINUTES = 120 | n/a | `skills/aibtc-agent-trading/sensor.ts` |
| `aibtc-dev-ops` | INTERVAL_MINUTES = 240 | n/a | `skills/aibtc-dev-ops/sensor.ts` |
| `aibtc-heartbeat` | INTERVAL_MINUTES = 5 | n/a | `skills/aibtc-heartbeat/sensor.ts` |
| `aibtc-inbox-sync` | INTERVAL_MINUTES = 5 | n/a | `skills/aibtc-inbox-sync/sensor.ts` |
| `aibtc-news-deal-flow` | INTERVAL_MINUTES = 60 | n/a | `skills/aibtc-news-deal-flow/sensor.ts` |
| `aibtc-news-distribution` | INTERVAL_MINUTES = 5 | n/a | `skills/aibtc-news-distribution/sensor.ts` |
| `aibtc-news-editorial` | INTERVAL_MINUTES = 360 | n/a | `skills/aibtc-news-editorial/sensor.ts` |
| `aibtc-repo-maintenance` | INTERVAL_MINUTES = 15 | n/a | `skills/aibtc-repo-maintenance/sensor.ts` |
| `aibtc-welcome` | INTERVAL_MINUTES = 30 | n/a | `skills/aibtc-welcome/sensor.ts` |
| `alb` | INTERVAL_MINUTES = 5 | n/a | `skills/alb/sensor.ts` |
| `arc0btc-pr-review` | INTERVAL_MINUTES = 10 | n/a | `skills/arc0btc-pr-review/sensor.ts` |
| `arc0btc-security-audit` | INTERVAL_MINUTES = 10 | n/a | `skills/arc0btc-security-audit/sensor.ts` |
| `arc0btc-services` | INTERVAL_MINUTES = 60 | n/a | `skills/arc0btc-services/sensor.ts` |
| `arc0btc-site-health` | INTERVAL_MINUTES = 30 | n/a | `skills/arc0btc-site-health/sensor.ts` |
| `arc-architecture-review` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-architecture-review/sensor.ts` |
| `arc-article-pipeline` | CADENCE_MINUTES = 60 * 48 | outbound_enabled | `skills/arc-article-pipeline/sensor.ts` |
| `arc-artifacts` | INTERVAL_MINUTES = 24 * 60 | n/a | `skills/arc-artifacts/sensor.ts` |
| `arc-blocked-review` | INTERVAL_MINUTES = 480 | n/a | `skills/arc-blocked-review/sensor.ts` |
| `arc-catalog` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-catalog/sensor.ts` |
| `arc-ceo-review` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-ceo-review/sensor.ts` |
| `arc-cost-reporting` | INTERVAL_MINUTES = 1440 | n/a | `skills/arc-cost-reporting/sensor.ts` |
| `arc-daily-read` | INTERVAL_MINUTES = 30 | outbound_enabled | `skills/arc-daily-read/sensor.ts` |
| `arc-email-sync` | INTERVAL_MINUTES = 1 | n/a | `skills/arc-email-sync/sensor.ts` |
| `arc-failure-triage` | INTERVAL_MINUTES = 60 | n/a | `skills/arc-failure-triage/sensor.ts` |
| `arc-housekeeping` | INTERVAL_MINUTES = 120 | n/a | `skills/arc-housekeeping/sensor.ts` |
| `arc-introspection` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-introspection/sensor.ts` |
| `arc-memory` | INTERVAL_MINUTES = 10080 | n/a | `skills/arc-memory/sensor.ts` |
| `arc-monitoring-service` | INTERVAL_MINUTES = 1 | n/a | `skills/arc-monitoring-service/sensor.ts` |
| `arc-opensource` | INTERVAL_MINUTES = 1440 | n/a | `skills/arc-opensource/sensor.ts` |
| `arc-packaging` | CADENCE_MINUTES = 60 * 24 | outbound_enabled | `skills/arc-packaging/sensor.ts` |
| `arc-payments` | INTERVAL_MINUTES = 3 | n/a | `skills/arc-payments/sensor.ts` |
| `arc-peer-inbox` | INTERVAL_MINUTES = 1 | n/a | `skills/arc-peer-inbox/sensor.ts` |
| `arc-purpose-eval` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-purpose-eval/sensor.ts` |
| `arc-report-email` | INTERVAL_MINUTES = 30 | n/a | `skills/arc-report-email/sensor.ts` |
| `arc-reporting` | INTERVAL_MINUTES = 60 | n/a | `skills/arc-reporting/sensor.ts` |
| `arc-reputation` | INTERVAL_MINUTES = 30 | n/a | `skills/arc-reputation/sensor.ts` |
| `arc-scheduler` | INTERVAL_MINUTES = 5 | n/a | `skills/arc-scheduler/sensor.ts` |
| `arc-self-audit` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-self-audit/sensor.ts` |
| `arc-self-review` | INTERVAL_MINUTES = 360 | n/a | `skills/arc-self-review/sensor.ts` |
| `arc-service-health` | INTERVAL_MINUTES = 5 | n/a | `skills/arc-service-health/sensor.ts` |
| `arc-skill-manager` | INTERVAL_MINUTES = 120 | n/a | `skills/arc-skill-manager/sensor.ts` |
| `arc-starter-publish` | INTERVAL_MINUTES = 60 | n/a | `skills/arc-starter-publish/sensor.ts` |
| `arc-strategy-review` | INTERVAL_MINUTES = 1440 | n/a | `skills/arc-strategy-review/sensor.ts` |
| `arc-umbrel` | INTERVAL_MINUTES = 30 | n/a | `skills/arc-umbrel/sensor.ts` |
| `arc-weekly-presentation` | INTERVAL_MINUTES = 60 | n/a | `skills/arc-weekly-presentation/sensor.ts` |
| `arc-workflow-review` | INTERVAL_MINUTES = 720 | n/a | `skills/arc-workflow-review/sensor.ts` |
| `arc-workflows` | INTERVAL_MINUTES = 5 | n/a | `skills/arc-workflows/sensor.ts` |
| `arxiv-distill` | INTERVAL_MINUTES = 12 * 60 | n/a | `skills/arxiv-distill/sensor.ts` |
| `arxiv-research` | INTERVAL_MINUTES = 720 | n/a | `skills/arxiv-research/sensor.ts` |
| `auto-queue` | INTERVAL_MINUTES = 360 | n/a | `skills/auto-queue/sensor.ts` |
| `bitcoin-macro` | INTERVAL_MINUTES = 240 | n/a | `skills/bitcoin-macro/sensor.ts` |
| `blog-deploy` | INTERVAL_MINUTES = 5 | n/a | `skills/blog-deploy/sensor.ts` |
| `blog-publishing` | INTERVAL_MINUTES = 60 | n/a | `skills/blog-publishing/sensor.ts` |
| `compliance-review` | INTERVAL_MINUTES = 720 | n/a | `skills/compliance-review/sensor.ts` |
| `contacts` | INTERVAL_MINUTES = 60 | n/a | `skills/contacts/sensor.ts` |
| `context-review` | INTERVAL_MINUTES = 480 | n/a | `skills/context-review/sensor.ts` |
| `council-distill` | INTERVAL_MINUTES = 24 * 60 | n/a | `skills/council-distill/sensor.ts` |
| `defi-bitflow` | INTERVAL_MINUTES = 60 | n/a | `skills/defi-bitflow/sensor.ts` |
| `defi-stacks-market` | INTERVAL_MINUTES = 360 | n/a | `skills/defi-stacks-market/sensor.ts` |
| `defi-zest` | INTERVAL_MINUTES = 360 | n/a | `skills/defi-zest/sensor.ts` |
| `erc8004-indexer` | INTERVAL_MINUTES = 360 | n/a | `skills/erc8004-indexer/sensor.ts` |
| `erc8004-reputation` | INTERVAL_MINUTES = 60 | n/a | `skills/erc8004-reputation/sensor.ts` |
| `github-ci-status` | INTERVAL_MINUTES = 15 | n/a | `skills/github-ci-status/sensor.ts` |
| `github-issue-monitor` | INTERVAL_MINUTES = 15 | n/a | `skills/github-issue-monitor/sensor.ts` |
| `github-mentions` | INTERVAL_MINUTES = 5 | n/a | `skills/github-mentions/sensor.ts` |
| `github-release-watcher` | INTERVAL_MINUTES = 60 | n/a | `skills/github-release-watcher/sensor.ts` |
| `github-security-alerts` | INTERVAL_MINUTES = 360 | n/a | `skills/github-security-alerts/sensor.ts` |
| `github-worker-logs` | INTERVAL_MINUTES = 360 | n/a | `skills/github-worker-logs/sensor.ts` |
| `identity-guard` | INTERVAL_MINUTES = 30 | n/a | `skills/identity-guard/sensor.ts` |
| `mempool-watch` | INTERVAL_MINUTES = 10 | n/a | `skills/mempool-watch/sensor.ts` |
| `nostr` | INTERVAL_MINUTES = 5 | n/a | `skills/nostr/sensor.ts` |
| `ordinals-market-data` | INTERVAL_MINUTES = 120 | n/a | `skills/ordinals-market-data/sensor.ts` |
| `paperboy` | INTERVAL_MINUTES = 1440 | n/a | `skills/paperboy/sensor.ts` |
| `site-consistency` | INTERVAL_MINUTES = 1440 | n/a | `skills/site-consistency/sensor.ts` |
| `snippet-producer` | INTERVAL_MINUTES = 60 | n/a | `skills/snippet-producer/sensor.ts` |
| `social-agent-engagement` | INTERVAL_MINUTES = 60 | n/a | `skills/social-agent-engagement/sensor.ts` |
| `social-x-posting` | INTERVAL_MINUTES = 15 | outbound_enabled | `skills/social-x-posting/sensor.ts` |
| `stacks-stackspot` | INTERVAL_MINUTES = 7 | n/a | `skills/stacks-stackspot/sensor.ts` |
| `watch-interior-distill` | INTERVAL_MINUTES = 12 * 60 | n/a | `skills/watch-interior-distill/sensor.ts` |
| `whop-sales` | INTERVAL_MINUTES = 720 | n/a | `skills/whop-sales/sensor.ts` |
| `whop` | INTERVAL_MINUTES = 60 | n/a | `skills/whop/sensor.ts` |
| `worker-deploy` | INTERVAL_MINUTES = 5 | n/a | `skills/worker-deploy/sensor.ts` |
| `zest-yield-manager` | INTERVAL_MINUTES = 120 | n/a | `skills/zest-yield-manager/sensor.ts` |

## 4. Skills with NO sensor (query tools / CLIs, invoked on demand or by another lane)

- `arc-attribution` — see §2. No autonomous cadence by design (a report generator, not a lane).
- `arc-email-channel` — see §2's disclosed gap. Manually invoked, bulk-send hard-gated.
- Any skill under `skills/*` without a `sensor.ts` file is, by the engine's own
  `discoverSkills()`/`runSensors()` contract, invoked ONLY via an explicit dispatch task or a
  manual `bash bin/arc skills run --name <skill> -- <command>` — never on its own cadence. This
  is not a gap to close; it's the correct shape for a pure command-line tool.

## 5. How to re-verify this document isn't stale

```bash
# Confirm the two systemd timers still match §1:
ssh dev@192.168.1.10 "systemctl --user list-timers"

# Confirm the two VM crontab lanes still match §1:
ssh dev@192.168.1.10 "crontab -l"

# Regenerate §3's table (diff against what's committed here — any new/removed row means a
# skill was added/removed since this doc was last refreshed):
# (see the command block in §3)
```
