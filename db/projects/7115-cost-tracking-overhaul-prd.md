# PRD: Cost Tracking Overhaul for Claude Max Plan

**Task:** #7115
**Date:** 2026-03-18
**Status:** Research / Pre-implementation
**Author:** Arc

---

## 1. Problem Statement

Arc's cost tracking was built assuming API billing (per-token pricing). We're now on **Claude Max $200/mo flat-rate plan**. The `cost_usd` and `api_cost_usd` fields calculate fictional dollar amounts using per-token rates that don't reflect actual spend. These numbers are displayed across dashboards, reports, emails, and memory — and they drive operational decisions (budget gates, priority routing, alerts). This is misleading.

---

## 2. Full Inventory: Where Cost Data Lives

### 2.1 Database Schema (2 tables, 8 columns)

| Table | Column | Type | Purpose |
|-------|--------|------|---------|
| `tasks` | `cost_usd` | REAL | "Actual" Claude Code cost per task |
| `tasks` | `api_cost_usd` | REAL | Estimated API cost from token rates |
| `tasks` | `tokens_in` | INTEGER | Input tokens (incl. cache read/write) |
| `tasks` | `tokens_out` | INTEGER | Output tokens |
| `cycle_log` | `cost_usd` | REAL | "Actual" cost per dispatch cycle |
| `cycle_log` | `api_cost_usd` | REAL | Estimated API cost per cycle |
| `cycle_log` | `tokens_in` | INTEGER | Input tokens per cycle |
| `cycle_log` | `tokens_out` | INTEGER | Output tokens per cycle |

### 2.2 Core Source Code (5 files)

| File | What It Does | Lines of Interest |
|------|-------------|-------------------|
| `src/dispatch.ts` | Parses `total_cost_usd` from Claude Code subprocess, calls `calculateApiCostUsd()`, stores both to DB. **Budget gate**: skips P3+ tasks if daily cost ≥ $500. **Retrospective trigger**: fires if cost > $1.00. | ~L57, L129-143, L443-584, L736, L918-956 |
| `src/models.ts` | Defines `MODEL_PRICING` per-million-token rates: Opus $15/$75 in/out, Sonnet $3/$15, Haiku $1/$5. Used by `calculateApiCostUsd()`. | ~L107-126 |
| `src/db.ts` | Schema definitions, `updateTaskCost()`, `getTodayCostUsd()` (sums `cost_usd` from `cycle_log`). | ~L7-61, L244-284, L839-846 |
| `src/cli.ts` | `arc status` displays: "usage (7d): $X.XX actual / $Y.YY api est", "today: $X.XX actual / $Y.YY api est", token counts. | ~L57-116 |
| `src/openrouter.ts` | Calculates API cost for OpenRouter fallback dispatch. Sets `cost_usd = api_cost_usd` (no separate "actual" cost from OpenRouter). | calculateApiCostUsd() |

### 2.3 Web Dashboards (3 files)

| File | What It Shows |
|------|--------------|
| `src/web.ts` | `/api/costs` endpoint returns hourly cost aggregations. `/api/status` returns `cost_today_usd`, `api_cost_today_usd`. |
| `src/web/index.html` | Header ticker "Cost Today", metric card, hourly cost bar chart, per-task "actual / API est" display. |
| `src/fleet-web/index.html` | "Fleet Cost Today" header, per-agent cost cards, fleet-wide cost aggregation. |

### 2.4 Sensors That Use Cost Data (6 sensors)

| Sensor | How It Uses Cost |
|--------|-----------------|
| `skills/arc-cost-reporting/sensor.ts` | Daily cost report: sums cost_usd/api_cost_usd, top 5 tasks by cost, top 5 skills by cost. Creates report task. |
| `skills/arc-ops-review/sensor.ts` | Alerts if cost_per_completion > $1.00. Stores `total_cost_usd` and `cost_per_completion` in `memory/ops-metrics.json`. |
| `skills/arc-self-audit/sensor.ts` | Compares `todayCost` against `DAILY_BUDGET_USD` ($200 env var). Alerts if >80% budget used. |
| `skills/arc-introspection/sensor.ts` | Flags if 24h cost > $50. Lists top 5 cost tasks. |
| `skills/arc-dispatch-eval/sensor.ts` | Scores cost efficiency per task against ceilings: P1-4 $1.00, P5-7 $0.50, P8+ $0.25. |
| `skills/fleet-dashboard/sensor.ts` | Aggregates cost per agent. Alerts if Arc > $80/day or peer > $30/day. |

### 2.5 CLI Tools That Display Cost (5 files)

| File | What It Shows |
|------|--------------|
| `skills/arc-observatory/cli.ts` | `cost_today_usd`, `api_cost_today_usd` in agent status, per-task cost in feeds. |
| `skills/arc-performance-analytics/cli.ts` | Per-model-tier cost breakdown, per-skill cost, per-cycle cost. Shows "Daily budget: $200.00 \| Used: $X.XX (Y.Y%)". |
| `skills/skill-effectiveness/cli.ts` | `avg_cost_usd` and `total_cost_usd` per skill version. |
| `skills/fleet-log-pull/cli.ts` | Per-cycle cost in log display, 24h cost aggregation. |
| `skills/auto-queue/cli.ts` | `avg_cost_usd` per domain in auto-queue analysis. |

### 2.6 Templates (3 files)

| File | Cost References |
|------|----------------|
| `templates/status-report.html` | "Cost (actual)" metric, per-task cost column. |
| `templates/overnight-brief.md` | "Total cost (actual)" and "Total cost (API est)" rows. |
| `templates/overnight-batch.md` | Cost governance section: overnight budget $40-60, model mix cost estimates, cost checkpoints. |

### 2.7 MCP Server (1 file)

| File | Cost Exposure |
|------|--------------|
| `skills/arc-mcp-server/server.ts` | `list_tasks` returns `cost_usd`. `get_status` returns `cost_today_usd`. `cycles` resource includes cost fields. |

### 2.8 Skill Documentation (4 files)

| File | Cost References |
|------|----------------|
| `skills/arc-cost-reporting/SKILL.md` | Documents dual-cost field semantics. |
| `skills/arc-performance-analytics/SKILL.md` | Model tier cost ceilings. |
| `skills/arc-ceo-review/SKILL.md` | "Daily burn ~$28-50 actual, under $100/day budget." |
| `skills/arc-ceo-review/AGENT.md` | "Check daily cost against the $30 target." |

### 2.9 Memory & Documentation (3 files)

| File | Cost References |
|------|----------------|
| `memory/MEMORY.md` | Cost optimization learnings, daily cost analysis, spending patterns. |
| `memory/frameworks.md` | Cost/model optimization decision framework (Framework 6). Daily target <$10, >$15 investigate, >$20 audit. |
| `memory/ops-metrics.json` | Real-time snapshot: `total_cost_usd`, `cost_per_completion`, `last_cycle_cost`. |

### 2.10 Other References

| File | Cost References |
|------|----------------|
| `CLAUDE.md` | Documents dual cost tracking, schema, dispatch cost fields. |
| `skills/arc-reporting/AGENT.md` | Watch report data gathering, cost styling. |
| `skills/arc-web-dashboard/AGENT.md` | API spec for /api/costs, /api/status cost fields. |
| `skills/arc-web-dashboard/SKILL.md` | API endpoint descriptions including cost. |
| `tests/db.test.ts` | Test assertions on cost_usd default values. |

---

## 3. What the Numbers Currently Mean

### `cost_usd` (the "actual" cost)
- **Source:** Parsed from Claude Code subprocess output field `total_cost_usd`.
- **What it represents:** What Anthropic would charge for that Claude Code session under API billing.
- **Under Claude Max:** This number is **fictional**. We pay $200/mo flat regardless of usage. The subprocess still reports this field, but it doesn't correspond to real money spent.

### `api_cost_usd` (the "estimated" cost)
- **Source:** Calculated by `calculateApiCostUsd()` using `MODEL_PRICING` token rates.
- **What it represents:** What the equivalent API calls would cost at published per-token rates.
- **Under Claude Max:** Also **fictional**. Same issue — no per-token billing applies.

### `tokens_in` / `tokens_out`
- **Source:** Parsed from Claude Code subprocess usage data.
- **What they represent:** Actual token consumption per cycle.
- **Under Claude Max:** These are **real and useful**. Token counts reflect actual resource consumption regardless of billing model.

### Budget gates and thresholds
- `DAILY_BUDGET_USD = 500` in dispatch.ts — gates P3+ tasks. Under flat rate, this is meaningless.
- `DAILY_BUDGET_USD = 200` in arc-self-audit — alerts at 80%. Misleading since we pay $200/mo, not $200/day.
- Various thresholds ($1.00/completion, $30/day peer, $80/day Arc) — all based on fictional dollar amounts.

---

## 4. What whoabuddy Actually Needs Under Claude Max

### 4.1 Usage Tracking (what's real)
- **Tokens consumed** — per task, per day, per week. This is the actual resource being consumed.
- **Cycles run** — count of dispatch cycles per period.
- **Token efficiency** — tokens per completed task, tokens per skill, trend over time.
- **Model tier distribution** — how many Opus vs Sonnet vs Haiku tasks, token split by tier.

### 4.2 Capacity Planning
- **Daily/weekly token burn rate** — are we hitting any rate limits or capacity constraints?
- **Peak usage windows** — when are we consuming the most tokens?
- **Headroom** — under Claude Max, the constraint is rate limits (concurrent sessions, tokens/minute), not dollars.

### 4.3 Efficiency Metrics (replaces cost optimization)
- **Tokens per completion** — replaces cost_per_completion. Lower is better.
- **Model routing accuracy** — are P8+ tasks actually cheap (low token) tasks? Are Opus tasks justified by complexity?
- **Waste detection** — failed cycles still consume tokens. Track tokens wasted on failures.

### 4.4 What Stays Useful
- **Equivalent API cost** — keeping an "if we were on API billing, this would cost $X" metric is useful for: (a) comparing to the $200/mo flat rate to validate the plan choice, (b) benchmarking efficiency over time. But it must be clearly labeled as **estimated/equivalent**, not "actual cost."

---

## 5. Proposed Changes

### 5.1 Schema Changes

**Keep** (rename for clarity):
- `tokens_in` → keep as-is (real data)
- `tokens_out` → keep as-is (real data)

**Rename** (to avoid implying real spend):
- `cost_usd` → `est_cost_usd` (both tables) — clearly labeled as estimated/equivalent
- `api_cost_usd` → **drop this column**. With flat-rate billing, having two fictional cost columns is worse than one. Merge into single `est_cost_usd`.

**Add** (new columns):
- None required at schema level. Efficiency metrics can be computed from existing token data.

### 5.2 Dispatch Changes (`src/dispatch.ts`)

| Current | Proposed |
|---------|----------|
| `DAILY_BUDGET_USD = 500` budget gate | Replace with **daily token ceiling** (e.g., `DAILY_TOKEN_LIMIT = 50_000_000`). Gate on tokens consumed, not fictional dollars. |
| `calculateApiCostUsd()` → stores as "actual" | Keep calculation but store as `est_cost_usd` with clear semantics. |
| Retrospective trigger: `cost_usd > 1.0` | Change to token threshold: `tokens_in + tokens_out > 500_000` (equivalent threshold). |
| Parses `total_cost_usd` from subprocess | Still parse it, store as `est_cost_usd`. |

### 5.3 Display Changes

| Location | Current | Proposed |
|----------|---------|----------|
| `arc status` | "$X.XX actual / $Y.YY api est" | "Tokens today: XXK in / YYK out (≈$X.XX equiv)" |
| Web dashboard header | "Cost Today: $X.XX" | "Tokens Today: XXK" with equiv cost as secondary |
| Web dashboard chart | Hourly cost bars | Hourly token bars (option to toggle equiv cost) |
| Task detail | "$X.XX actual / $Y.YY API est" | "XXK tokens (≈$X.XX equiv)" |
| Fleet dashboard | "Fleet Cost Today: $X.XX" | "Fleet Tokens Today: XXK" |
| Watch reports | "Cost (actual): $X.XX" | "Est. equiv: $X.XX" or "Tokens: XXK in / YYK out" |
| Overnight briefs | "Total cost (actual) / (API est)" | "Total tokens: XXK" + single equiv cost line |

### 5.4 Sensor Changes

| Sensor | Current | Proposed |
|--------|---------|----------|
| `arc-cost-reporting` | Reports dual cost_usd fields | Report tokens consumed, top tasks by tokens, single equiv cost line |
| `arc-ops-review` | Alerts on cost_per_completion > $1.00 | Alert on tokens_per_completion > threshold (e.g., 500K) |
| `arc-self-audit` | Budget % against $200/day | Token burn rate trend, model tier distribution |
| `arc-introspection` | Flags 24h cost > $50 | Flag 24h tokens > threshold |
| `arc-dispatch-eval` | Cost ceiling scoring per priority | Token ceiling scoring per priority |
| `fleet-dashboard` | $80/day Arc, $30/day peer alerts | Token-based thresholds |

### 5.5 Memory & Documentation Changes

| File | Change |
|------|--------|
| `CLAUDE.md` | Update "Dual Cost Tracking" section to explain est_cost_usd + tokens model. Remove references to "what Anthropic charges." |
| `memory/MEMORY.md` | Update cost optimization learnings. Remove dollar-based daily targets. |
| `memory/frameworks.md` | Rewrite Framework 6 with token-based thresholds. |
| `skills/arc-ceo-review/SKILL.md` | Update cost context from "$28-50/day" to token-based efficiency metrics. |
| `skills/arc-ceo-review/AGENT.md` | Update "$30 target" to token efficiency targets. |
| `skills/arc-cost-reporting/SKILL.md` | Rewrite to reflect new metrics. |
| `skills/arc-performance-analytics/SKILL.md` | Update cost ceiling table to token ceilings. |

---

## 6. Migration Path

### Phase 1: Schema + Core (1 task, P3 Opus)
1. Rename `cost_usd` → `est_cost_usd` in both tables (ALTER TABLE + code)
2. Remove `api_cost_usd` column (or keep as deprecated, zero-filled)
3. Update `src/db.ts`: rename functions, update queries
4. Update `src/dispatch.ts`: rename fields, change budget gate to token-based
5. Update `src/models.ts`: keep pricing for equiv calculation, add comment about purpose
6. Update `src/cli.ts`: new `arc status` output format
7. Update `tests/db.test.ts`

### Phase 2: Display Layer (1 task, P5 Sonnet)
1. Update `src/web.ts` API endpoints
2. Update `src/web/index.html` dashboard
3. Update `src/fleet-web/index.html`
4. Update `skills/arc-mcp-server/server.ts`
5. Update templates: `status-report.html`, `overnight-brief.md`, `overnight-batch.md`

### Phase 3: Sensors + Skills (1 task, P5 Sonnet)
1. Update all 6 sensors listed in §2.4
2. Update all 5 CLI tools listed in §2.5
3. Update `memory/ops-metrics.json` schema

### Phase 4: Documentation + Memory (1 task, P7 Haiku)
1. Update `CLAUDE.md` cost tracking section
2. Update `memory/MEMORY.md` cost learnings
3. Update `memory/frameworks.md` Framework 6
4. Update skill SKILL.md/AGENT.md files (§2.8)

### Migration Notes
- **Backwards compat:** Historical data in `cost_usd` / `api_cost_usd` columns is still meaningful as "equivalent API cost at the time." Don't delete historical data — rename the column.
- **OpenRouter:** `src/openrouter.ts` is actually API-billed if used. Keep cost calculation there but flag it differently (it's real spend, not flat-rate).
- **fleet-status.json:** `last_cycle_cost` field needs updating in the fleet status protocol.

---

## 7. Complete File Inventory (All Files Requiring Changes)

### Must Change (core logic or display)
1. `src/dispatch.ts`
2. `src/db.ts`
3. `src/models.ts`
4. `src/cli.ts`
5. `src/web.ts`
6. `src/web/index.html`
7. `src/fleet-web/index.html`
8. `src/openrouter.ts`
9. `skills/arc-cost-reporting/sensor.ts`
10. `skills/arc-ops-review/sensor.ts`
11. `skills/arc-self-audit/sensor.ts`
12. `skills/arc-introspection/sensor.ts`
13. `skills/arc-dispatch-eval/sensor.ts`
14. `skills/fleet-dashboard/sensor.ts`
15. `skills/arc-observatory/cli.ts`
16. `skills/arc-performance-analytics/cli.ts`
17. `skills/skill-effectiveness/cli.ts`
18. `skills/fleet-log-pull/cli.ts`
19. `skills/auto-queue/cli.ts` (sensor.ts too)
20. `skills/arc-mcp-server/server.ts`
21. `templates/status-report.html`
22. `templates/overnight-brief.md`
23. `templates/overnight-batch.md`
24. `tests/db.test.ts`

### Must Update (documentation/memory)
25. `CLAUDE.md`
26. `memory/MEMORY.md`
27. `memory/frameworks.md`
28. `memory/ops-metrics.json`
29. `skills/arc-cost-reporting/SKILL.md`
30. `skills/arc-performance-analytics/SKILL.md`
31. `skills/arc-ceo-review/SKILL.md`
32. `skills/arc-ceo-review/AGENT.md`
33. `skills/arc-web-dashboard/AGENT.md`
34. `skills/arc-web-dashboard/SKILL.md`
35. `skills/arc-reporting/AGENT.md`
36. `skills/arc-strategy-review/SKILL.md`
37. `src/fleet-status.ts`

---

## 8. Open Questions for whoabuddy

1. **Keep equiv cost at all?** The "if we were on API billing" number is useful for validating the Claude Max plan choice. But if it's noise, we can drop it entirely and go tokens-only.

2. **Token budget thresholds:** What daily/weekly token limits feel right? Current fictional "$500/day" gate translates to roughly 30-50M tokens/day depending on model mix. Need real rate limit data from Claude Max plan.

3. **OpenRouter is real spend.** Forge's OpenRouter fallback is actually API-billed. Should we keep real cost tracking for OpenRouter paths only?

4. **Historical data:** Rename columns in-place (preserves history with new semantics) vs. add new columns and deprecate old ones (cleaner but more complex)?

5. **Plan validation metric:** Should we add a monthly "Claude Max savings" display? e.g., "This month's equiv API cost: $847. Claude Max cost: $200. Savings: $647." — useful for confirming the plan is worth it.

---

*Awaiting whoabuddy's review before implementation.*
