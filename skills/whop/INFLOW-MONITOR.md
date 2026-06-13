# Inflow monitor — recurring health check for the artifact pool, dispatch, and consumers

*Drop into a fresh Claude Code session after /clear. Self-contained.*

You are the inflow-pool soak monitor. The source-artifact pool (commits
`3c5a15f2` + `d0e1651d`) wired 3 distill **producers** into 5 **consumers**, with
an asymmetry guarantee on routing. Your job each tick: verify dispatch is
healthy, producers are producing, consumers are consuming, and nothing is
spiraling — surface anomalies, do not silently absorb them.

## Run mode (recommended)

Either:

- **Dynamic /loop** (model-paced) — run this exact prompt under `/loop` with no
  interval; `ScheduleWakeup` between ticks. Use **270s** if a known event is
  imminent (dispatch cycle, sensor about to fire) and you want to catch it
  before cache expires; otherwise default **1800s** (30 min). Stop the loop
  when whoabuddy signals or a hard fault is escalated.
- **One-shot** — run once, print findings, exit. Use this for ad-hoc spot
  checks.

Do NOT use a fixed-cadence cron — the things being monitored have varying
cadences (1h reactive, 6h watch/synthesis, 24h vacuum/distill), and a fixed
tick will frequently land between events with nothing new to look at.

## Read first (only if needed)

You probably don't need these every tick — load on demand when triage requires:

- `src/artifacts.ts` — pool API (`recentArtifacts`, `markConsumed`, vacuum, TTLs)
- `skills/arc-artifacts/SKILL.md` — vacuum + audit CLI
- `skills/whop/POLLING-DESIGN.md` — whop lane architecture
- `skills/arc-workflows/PUBLISH-FANOUT.md` — Phase 3 fanout state machine
- `memory/MEMORY.md` → [A] whop-wedge, x-cadence

## Inventory under monitoring

**Producers (3)** — write `artifacts/distilled/<type>/<basename>.json`:

| Type | Cadence | TTL | Skill |
|---|---|---|---|
| `arxiv` | ~24h | 14d | `skills/arxiv-distill/` |
| `council` | ~daily | 90d | `skills/council-distill/` |
| `watch-interior` | ~12h | 7d | `skills/watch-interior-distill/` |

**Consumers (5)** — claim via `markConsumed(channel)`:

| Channel | Site | Notes |
|---|---|---|
| `blog` | `skills/blog-publishing/sensor.ts` `queueArtifactFedDraft` | rotates research/council/operating/philosophical |
| `whop-chat` | `skills/whop/sensor.ts` `pollWhopSynthesis` | pulls watch-interior + council + arxiv |
| `reactive` | `skills/whop/sensor.ts` `matchReactiveNugget` | topic-token overlap on inbound msg |
| `x` | `skills/social-x-posting/sensor.ts` `runCadenceBeat` | research-highlight + agent-philosophy beats |
| (audit) | `skills/arc-reporting/sensor.ts` `buildInflowSummary` | watch-report embed only, not a consumer |

**Asymmetry guarantee** (src/artifacts.ts:269): `recentArtifacts({channel})` also
filters `suggested_channels LIKE %channel%`. Watch-interior nuggets tagged
`[whop-chat, reactive]` MUST NOT leak into `blog` / `public-forum` queries.

**Gate flags** (current state — verify with `grep` each tick if behavior
surprises you):

- `WHOP_REPLY_ENABLED=true`, `WHOP_REPLY_DRY_RUN=false` — live
- `WHOP_SYNTHESIS_ENABLED=true`, `WHOP_SYNTHESIS_DRY_RUN=true` — dry-run
- `WHOP_FREE_FORUM_ENABLED=$env`, `WHOP_FREE_FORUM_DRY_RUN=$env` — env-gated
- `WORKFLOWS_PUBLISH_FANOUT_WHOP_ENABLED=true` (.env), DRY_RUN defaulted on
- `X_CADENCE_ENABLED=false` (hardcoded; credits state)
- `SIGNAL_FILING_DISABLED=true` (all signal-filing skills paused)

---

## Tick procedure

Run these in parallel where independent. Each block ends with a verdict line.

### 1. Dispatch health

```bash
# Lock + cycle activity
cat db/dispatch-lock.json 2>/dev/null
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
console.log("recent cycles:");
console.log(db.query("SELECT id, task_id, started_at, completed_at, duration_ms, cost_usd FROM cycle_log ORDER BY id DESC LIMIT 5").all());
console.log("active tasks:");
console.log(db.query("SELECT id, subject, model, source, started_at FROM tasks WHERE status = \"active\"").all());
console.log("pending top 10:");
console.log(db.query("SELECT id, priority, subject, model, source FROM tasks WHERE status = \"pending\" ORDER BY priority, id LIMIT 10").all());'
```

**Red flags:**
- `dispatch-lock.json` present + lock holder age > 35 min → stuck dispatch
- An `active` task with `started_at` > 35 min ago → same
- Pending count climbing tick-over-tick with no `completed_at` advancing → drain failure
- Latest `cycle_log` cost > $1 on a single task → cost spiral (record id; check `result_summary`)

### 2. Producer health (no stuck distillers)

```bash
arc skills run --name arc-artifacts -- stuck-check
arc skills run --name arc-artifacts -- audit --since 48
ls -1t artifacts/distilled/arxiv/ artifacts/distilled/council/ artifacts/distilled/watch-interior/ 2>/dev/null | head -10
```

**Red flags:**
- `stuck-check` warns for any type (>36h since fresh) → that producer's sensor
  is stalled. Sensor logs go to journald: `journalctl --user -u arc-sensors -n 200 --no-pager | grep <skill>`
  (or `arc services status`). Cross-reference `cycle_log` for any task-creating
  ticks that did fire.
- Produced count = 0 for >48h on a type expected daily → same triage.
- Orphan `.tmp` files in `artifacts/distilled/*/` → crash mid-write; vacuum
  should sweep within 24h, but call out if `.tmp` is recent (<1h) — points at
  ongoing breakage.

### 3. Consumer health (claims happening, no channel starvation)

```bash
# Consumption rate by channel last 24h — should match expected cadences
bun -e 'import { initDatabase, getDatabase } from "./src/db.ts";
initDatabase();
const db = getDatabase();
console.log(db.query("SELECT channel, COUNT(*) AS n, MAX(consumed_at) AS latest FROM distilled_consumption WHERE consumed_at >= datetime(\"now\", \"-24 hours\") GROUP BY channel ORDER BY n DESC").all());'

# Asymmetry spot-check — watch-interior must never appear in blog/public-forum
bun -e 'import { initDatabase, getDatabase } from "./src/db.ts";
initDatabase();
const db = getDatabase();
const leaks = db.query("SELECT c.channel, c.artifact_id, c.consumed_at FROM distilled_consumption c JOIN distilled_artifacts a ON a.id = c.artifact_id WHERE a.type = \"watch-interior\" AND c.channel IN (\"blog\", \"public-forum\")").all();
console.log(leaks.length === 0 ? "OK — no watch-interior leaks" : { LEAK: leaks });'
```

**Red flags:**
- `blog` channel: 0 consumption in 48h while arxiv/council/watch-interior
  pools are non-empty → `queueArtifactFedDraft` not running or budget exhausted.
- `reactive`: 0 consumption when whop-replies sensor is firing on real inbound
  → topic-token matcher broken; spot-check by reading a recent
  `skills/whop/artifacts/replies/*.json` and asserting `matched_nugget_id`
  appears when the inbound message has a clear topic.
- `whop-chat`: 0 consumption across multiple synthesis ticks despite nuggets
  in pool → embedding block silently failing; read latest
  `skills/whop/artifacts/synthesis/*.json` for `context_wells` shape.
- ANY watch-interior leak into `blog` or `public-forum` → asymmetry broken,
  HARD STOP — escalate immediately, do not flip any DRY_RUN off until fixed.

### 4. Whop reactive lane sanity (it's the only live whop lane)

```bash
ls -1t skills/whop/artifacts/replies/ | head -5
jq '{tick: .tick_at, seen: .messages_seen, candidates: .candidates_count, created: .tasks_created, dry_run, matched_nugget: .matched_nugget_id}' \
  "skills/whop/artifacts/replies/$(ls -1t skills/whop/artifacts/replies/ | head -1)"

# Recent reply task outcomes
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
console.log(db.query("SELECT id, status, substr(result_summary, 1, 200) AS s, completed_at FROM tasks WHERE source LIKE \"sensor:whop-replies:%\" ORDER BY id DESC LIMIT 10").all());'

# Relationship state — confirm not only-whoabuddy after we've been live a while
jq '.users | to_entries | map({user: .value.username, msgs: .value.message_count, arc_replies: .value.arc_replies_to_them, their_replies: .value.their_replies_to_arc}) | sort_by(-.msgs)' db/whop-relationships.json
```

**Red flags:**
- `thread_spiral_cap` or `daily_budget_exhausted` in any artifact → spiral
  guard tripped, investigate the conversation that triggered it.
- 3+ consecutive `failed` reply tasks with same root-cause → STOP, surface
  the failure class.
- Echo-chamber check: if still only whoabuddy as counterparty after 7d live,
  note it in the tick report (product signal, not a fault).

### 5. Workflows (PublishFanoutMachine — Phase 3)

```bash
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
console.log("workflow instances last 7d:");
console.log(db.query("SELECT id, template, instance_key, current_state, created_at, updated_at FROM workflows WHERE created_at >= datetime(\"now\", \"-7 days\") ORDER BY id DESC LIMIT 20").all());
console.log("fanout publish tasks last 7d:");
console.log(db.query("SELECT id, status, source, substr(result_summary, 1, 160) AS s FROM tasks WHERE source LIKE \"publish-fanout:%\" AND created_at >= datetime(\"now\", \"-7 days\") ORDER BY id DESC LIMIT 20").all());'
```

**Red flags:**
- Instance stuck in `whop_pending` > 6h with no progress → `autoAdvanceState`
  not firing or the dispatched task failed without falling through to `x_pending`.
  Cross-check workflow-context-clobber [[memory entry]] — anchor timing once at
  creation, not mid-flow.
- A `publish-fanout:<slug>:whop` task in `failed` with no follow-up to `:x` →
  fall-through policy not honored; surface.

### 6. Watch-report inflow embed integrity

Once a watch report runs (every 6h, P6, sensor `sensor:arc-reporting-watch`),
verify the `## Inflow pool` block rendered with non-empty numbers when the
pool is non-empty.

```bash
bun -e 'import { Database } from "bun:sqlite";
const db = new Database("db/arc.sqlite", { readonly: true });
const t = db.query("SELECT id, description, result_detail FROM tasks WHERE source = \"sensor:arc-reporting-watch\" ORDER BY id DESC LIMIT 1").get();
const block = (t.description || "").split("## Inflow pool")[1]?.slice(0, 800);
console.log("task", t.id, "inflow block:\n", block || "(MISSING)");'
```

If the block is missing or all zeros while `audit --since 24` shows
production, the embed wiring regressed.

---

## Tick report shape

End each tick with a one-line PASS / WARN / FAIL verdict plus a compact body.
Keep this terse — the loop's value is the trend across ticks, not depth in
one tick.

```
[INFLOW-MONITOR <ISO>] PASS | dispatch: ok (last cycle <id>, $<cost>)
  | producers: arxiv <Nh> council <Nh> watch-interior <Nh>
  | consumers (24h): blog=N whop-chat=N reactive=N x=N
  | asymmetry: ok
  | reactive: <N> replies, <N> defers, spiral=no
  | workflows: <N> fanout instances, longest age <Nh>
```

For WARN/FAIL: drop the compact body, give a 2-3 sentence triage with the
artifact id / task id / file path. One escalation per failure class per day —
don't spam the same issue on every tick.

## Escalation rules

- **HARD STOP triggers** (escalate to whoabuddy, then stop the loop):
  - Asymmetry leak (watch-interior into blog/public-forum)
  - Dispatch stuck > 2 ticks in a row (same lock holder)
  - Live whop reactive posting OUT-OF-VOICE content (spot-check 1 dry-run-free
    reply per tick against arc-brand-voice/whop voice card)
  - Any `cost_usd > $2` single task
- **Soft warn** (continue loop, surface once per day):
  - Stuck producer >36h
  - Empty channel with non-empty pool 48h+
  - Workflow instance stuck >6h
- **Note-only** (mention in compact body, no escalation):
  - Echo-chamber persistence
  - Zero pending-task drain (idle is fine)

## Loop termination

Exit the loop when:
- whoabuddy says "stop" / cancels
- A HARD STOP escalation has been raised AND the underlying cause is
  unresolved (don't keep firing escalations into the void)
- 7 consecutive PASS ticks at the longest cadence — the system is stable;
  switch to one-shot ad-hoc checks instead of standing watch

If unsure whether to continue, prefer terminating and surfacing — a quiet
monitor that someone has to remember to silence is worse than a quick
"all green, signing off" note.
