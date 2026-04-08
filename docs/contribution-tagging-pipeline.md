# Contribution-Tagging Pipeline: 3 World Model for GitHub PRs

*Design spec — task #11451, derived from task #11450 (3 world model analysis)*
*References: cedarxyz gist, agent-news issues #33, #383*

---

## Problem

Arc reviews 20-40+ PRs/week across 8+ repos but captures zero structured metadata about *what kind* of contribution each PR represents. We know *that* a PR was reviewed but not *why it matters* — is it a new feature or a bugfix? Does it grow the ecosystem or maintain it? Was the reviewer Arc or a human? This gap blocks:

- **whoabuddy (Player Coach)**: Can't see contribution patterns across repos without reading every PR
- **Arc (Agent)**: Can't self-assess whether review effort aligns with strategic priorities
- **aibtc ecosystem (Company)**: Can't surface contribution health metrics to stakeholders

The 3 world model gives us a framework: every contribution is simultaneously a Company event (ops), a Customer event (demand), and an Agent event (self-describing).

---

## 1. Contribution Taxonomy Schema

Each PR review produces a `ContributionTag` — a JSON object stored in the task's `result_detail` alongside the review itself.

```typescript
interface ContributionTag {
  version: 1;

  // ── Company World (ops: velocity, skills, capacity) ──
  company: {
    repo: string;               // "aibtcdev/skills"
    repo_class: RepoClass;      // "managed" | "collaborative" | "external"
    contributor: string;        // GitHub login of PR author
    contributor_type: "human" | "agent" | "bot";  // bot = dependabot/release-please
    time_to_review_h: number;   // hours from PR open to Arc's first review
    review_cycle: number;       // 1 = first review, 2+ = re-review
    files_changed: number;
    lines_delta: number;        // insertions - deletions (net growth)
    skills_area: string[];      // which skill domains touched: ["defi-zest", "x402"]
  };

  // ── Customer World (demand: what the contribution addresses) ──
  customer: {
    type: "feature" | "bugfix" | "docs" | "refactor" | "test" | "chore" | "security";
    scope: string;              // conventional commit scope: "wallet", "relay", etc.
    linked_issue: string | null;  // "aibtcdev/skills#268" or null
    demand_signal: "user-reported" | "sensor-detected" | "contributor-initiated" | "unknown";
    beat_relevance: string[];   // which aibtc beats this touches: ["infrastructure", "agent-trading"]
  };

  // ── Agent World (self-describing: how Arc processed it) ──
  agent: {
    task_id: number;
    task_source: string;        // "sensor:github-mentions", "workflow:42", "human"
    sensor_origin: string;      // "github-mentions" | "aibtc-repo-maintenance" | "manual"
    model: string;              // "sonnet" | "opus"
    review_cost_usd: number;
    review_decision: "approved" | "changes-requested" | "commented" | "skipped";
    severity_counts: {          // from review body parsing
      blocking: number;
      suggestion: number;
      nit: number;
      question: number;
    };
    automated_pr: boolean;      // dependabot, release-please, etc.
  };
}
```

### Type Inference Rules

The `customer.type` field is inferred from PR title using conventional commits:

| Title Pattern | Type |
|---|---|
| `feat(...)` | `feature` |
| `fix(...)` | `bugfix` |
| `docs(...)` | `docs` |
| `refactor(...)` | `refactor` |
| `test(...)` | `test` |
| `chore(...)`, `build(...)`, `ci(...)` | `chore` |
| `security(...)`, CVE mention | `security` |
| No prefix match | Infer from diff: mostly `.md` = `docs`, mostly test files = `test`, else `feature` |

The `customer.demand_signal` field:

| Signal | Condition |
|---|---|
| `user-reported` | PR links to an issue opened by someone other than the PR author |
| `sensor-detected` | Task source contains `sensor:` or `workflow:` |
| `contributor-initiated` | PR has no linked issue, author opened it directly |
| `unknown` | Can't determine |

The `company.contributor_type` field:

| Contributor | Type |
|---|---|
| Login matches known agent BTC/STX addresses in contacts DB | `agent` |
| Login matches bot patterns: `dependabot`, `release-please`, `*[bot]` | `bot` |
| Everything else | `human` |

---

## 2. Tag Emission Points in Existing Pipeline

Tags are emitted at **review completion**, not at task creation. The reviewing Claude instance constructs the `ContributionTag` as part of its output.

### Pipeline Flow

```
PR opened on GitHub
  │
  ├─ aibtc-repo-maintenance sensor
  │   └─ Creates pr-lifecycle workflow (issue-opened → opened)
  │
  ├─ github-mentions sensor
  │   └─ Creates review task for @mentions / review_requested
  │
  └─ arc-workflows meta-sensor
      └─ PrLifecycleMachine evaluates → buildReviewAction() → task
          │
          ▼
      Dispatch picks up review task
          │
          ▼
      Claude reads PR diff, posts review via gh pr review
          │
          ▼
      ┌─────────────────────────────────────────────┐
      │  NEW: Claude emits ContributionTag JSON     │
      │  as structured block in result_detail       │
      │  Format: ```contribution-tag\n{...}\n```    │
      └─────────────────────────────────────────────┘
          │
          ▼
      Dispatch stores result_detail in tasks table
          │
          ▼
      ┌─────────────────────────────────────────────┐
      │  NEW: Post-cycle hook extracts tag block    │
      │  and inserts into contribution_tags table   │
      └─────────────────────────────────────────────┘
```

### Where Each Tag Field Gets Its Data

**Company fields — available at task creation time:**

| Field | Source |
|---|---|
| `repo` | Workflow context `owner/repo` or task subject parsing |
| `repo_class` | `classifyRepo()` from `src/constants.ts` |
| `contributor` | Workflow context `author` or `gh pr view --json author` |
| `contributor_type` | Cross-ref contacts DB + bot pattern match |
| `time_to_review_h` | `(task.started_at - pr.created_at)` via `gh pr view --json createdAt` |
| `review_cycle` | Workflow context `reviewCycle` |
| `files_changed` | `gh pr view --json changedFiles` |
| `lines_delta` | `gh pr view --json additions,deletions` |
| `skills_area` | Map changed file paths to skill names via `skills/*/` prefixes |

**Customer fields — inferred during review:**

| Field | Source |
|---|---|
| `type` | Parse PR title for conventional commit prefix |
| `scope` | Extract `(scope)` from conventional commit title |
| `linked_issue` | `gh pr view --json closingIssuesReferences` |
| `demand_signal` | Compare issue author vs PR author; check task source |
| `beat_relevance` | Map repo + scope to AIBTC beats (e.g., `x402-*` → `infrastructure`) |

**Agent fields — known at review completion:**

| Field | Source |
|---|---|
| `task_id` | Current task ID |
| `task_source` | `tasks.source` column |
| `sensor_origin` | Extract sensor name from source string |
| `model` | `tasks.model` column |
| `review_cost_usd` | `tasks.cost_usd` after cycle completes |
| `review_decision` | Parse `gh pr review` outcome from review output |
| `severity_counts` | Count `[blocking]`, `[suggestion]`, `[nit]`, `[question]` in review text |
| `automated_pr` | `shouldSkipPrReview()` patterns + `isAutomated` flag |

### Implementation: AGENT.md Addition

Add to `skills/aibtc-repo-maintenance/AGENT.md` — a structured output block that the reviewing Claude emits after posting its review:

```markdown
## After posting your review, emit a contribution tag:

\`\`\`contribution-tag
{
  "version": 1,
  "company": { ... },
  "customer": { ... },
  "agent": { ... }
}
\`\`\`
```

This keeps tag emission in the subagent (where the PR data is fresh) rather than adding a post-processing step.

### Extraction: Post-Cycle Hook

A lightweight post-cycle step in `dispatch.ts` (or a new `contribution-tagger` sensor):

1. After task completes, scan `result_detail` for `` ```contribution-tag `` block
2. Parse the JSON
3. Insert into `contribution_tags` table
4. If no tag block found and task subject matches `Review PR #*`, log a warning (tag emission gap)

---

## 3. Health Endpoint Surface: `/api/contributions`

New endpoint on the web dashboard, extending the existing `/api/status` pattern.

### `GET /api/contributions`

Returns aggregate contribution metrics for the current day (MDT-adjusted, matching existing cost queries).

```json
{
  "period": "2026-04-08",
  "total_reviews": 12,
  "by_type": {
    "feature": 4,
    "bugfix": 3,
    "docs": 2,
    "chore": 2,
    "security": 1
  },
  "by_repo": {
    "aibtcdev/skills": 5,
    "aibtcdev/agent-news": 3,
    "aibtcdev/aibtc-mcp-server": 2,
    "aibtcdev/landing-page": 2
  },
  "by_contributor_type": {
    "human": 8,
    "agent": 3,
    "bot": 1
  },
  "review_velocity": {
    "avg_time_to_review_h": 2.3,
    "median_time_to_review_h": 1.1
  },
  "review_quality": {
    "blocking_issues_found": 3,
    "suggestions_made": 14,
    "approval_rate": 0.75
  },
  "cost": {
    "total_review_cost_usd": 3.84,
    "avg_per_review_usd": 0.32
  }
}
```

### `GET /api/contributions?period=week`

Same shape, aggregated over 7 days. Also supports `?period=month`.

### `GET /api/contributions/stream`

Returns the last N contribution tags as an array, useful for Player Coach drill-down:

```json
[
  {
    "task_id": 11451,
    "tagged_at": "2026-04-08T00:39:00Z",
    "tag": { /* full ContributionTag */ }
  }
]
```

### Existing `/api/status` Enhancement

Add a `contributions_today` summary to the existing status response:

```json
{
  "pending": 3,
  "active": 1,
  "completed_today": 42,
  "failed_today": 2,
  "cost_today_usd": 12.50,
  "contributions_today": {
    "reviews": 8,
    "features": 3,
    "bugfixes": 2,
    "blocking_issues": 1
  },
  "last_cycle": { ... },
  "uptime_hours": 18.3
}
```

---

## 4. Player Coach Aggregation

The Player Coach (whoabuddy) needs three views:

### View 1: Daily Contribution Brief

A daily summary generated by a sensor (or appended to the existing daily eval). Format:

```
## Contribution Brief — 2026-04-08

### Demand (Customer)
- 4 features, 3 bugfixes, 2 docs, 1 security patch
- 3 PRs linked to user-reported issues (demand-driven)
- Beats touched: infrastructure (5), agent-trading (2), quantum (1)

### Ops (Company)
- 12 PRs reviewed across 4 repos
- Avg time-to-review: 2.3h (target: <4h)
- 8 human contributors, 3 agent contributors, 1 bot
- Top contributor: @flying-whale (3 PRs)
- Skills coverage: defi-zest, x402, mcp-server, landing-page

### Agent (Self)
- Review cost: $3.84 ($0.32/review)
- Model split: 11 sonnet, 1 opus (security review)
- 3 blocking issues caught, 14 suggestions made
- 75% approval rate (9/12)
- 0 tag emission gaps
```

### View 2: Trend Dashboard

Surfaced on the web dashboard (new `/contributions` page or section on existing index):

| Metric | D-1 | D-7 avg | D-30 avg | Trend |
|---|---|---|---|---|
| Reviews/day | 12 | 15.2 | 18.7 | declining |
| Features/day | 4 | 5.1 | 6.3 | declining |
| Bugfixes/day | 3 | 2.8 | 3.1 | stable |
| Avg review time (h) | 2.3 | 3.1 | 4.5 | improving |
| Review cost/day ($) | 3.84 | 4.50 | 5.20 | improving |
| Unique contributors | 6 | 8.2 | 9.4 | declining |
| Blocking issues caught | 3 | 1.5 | 2.1 | up |

### View 3: Contributor Profiles

Per-contributor aggregation (joins with contacts DB where possible):

```json
{
  "contributor": "flying-whale",
  "contributor_type": "agent",
  "contact_id": 151,
  "aibtc_level": "Genesis",
  "total_prs": 14,
  "by_type": { "feature": 8, "bugfix": 4, "docs": 2 },
  "repos": ["aibtcdev/aibtc-mcp-server", "aibtcdev/bff-skills"],
  "avg_review_cycles": 1.3,
  "first_contribution": "2026-03-15",
  "last_contribution": "2026-04-07",
  "approval_rate": 0.86
}
```

This directly feeds the competition (issue #383 — beat editor evaluation) and ecosystem health tracking (cedarxyz gist — measuring actual vs. perceived contributor activity).

---

## 5. Storage Schema

```sql
CREATE TABLE IF NOT EXISTS contribution_tags (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL,
  tagged_at TEXT DEFAULT (datetime('now')),

  -- Company
  repo TEXT NOT NULL,
  repo_class TEXT NOT NULL,
  contributor TEXT NOT NULL,
  contributor_type TEXT NOT NULL,
  time_to_review_h REAL,
  review_cycle INTEGER DEFAULT 1,
  files_changed INTEGER DEFAULT 0,
  lines_delta INTEGER DEFAULT 0,
  skills_area TEXT DEFAULT '[]',

  -- Customer
  contribution_type TEXT NOT NULL,
  scope TEXT,
  linked_issue TEXT,
  demand_signal TEXT,
  beat_relevance TEXT DEFAULT '[]',

  -- Agent
  sensor_origin TEXT,
  model TEXT,
  review_cost_usd REAL DEFAULT 0,
  review_decision TEXT,
  severity_blocking INTEGER DEFAULT 0,
  severity_suggestion INTEGER DEFAULT 0,
  severity_nit INTEGER DEFAULT 0,
  severity_question INTEGER DEFAULT 0,
  automated_pr INTEGER DEFAULT 0,

  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_ct_repo ON contribution_tags(repo);
CREATE INDEX IF NOT EXISTS idx_ct_type ON contribution_tags(contribution_type);
CREATE INDEX IF NOT EXISTS idx_ct_contributor ON contribution_tags(contributor);
CREATE INDEX IF NOT EXISTS idx_ct_tagged_at ON contribution_tags(tagged_at);
```

Flat table, not JSON blobs. Every field queryable. Matches Arc's DB convention of verbose column names.

---

## 6. Implementation Phases

### Phase 1: Schema + Manual Tagging (1 task, sonnet)
- Add `contribution_tags` table to `src/db.ts`
- Add ContributionTag type to a new `src/contribution-tags.ts`
- Add tag emission instructions to `skills/aibtc-repo-maintenance/AGENT.md`
- Add extraction logic to dispatch post-cycle (parse `` ```contribution-tag `` from result_detail)

### Phase 2: Health Endpoint (1 task, sonnet)
- Add `/api/contributions` endpoint to `src/web.ts`
- Add `contributions_today` summary to existing `/api/status`
- Add contribution stream endpoint

### Phase 3: Aggregation + Dashboard (1 task, sonnet)
- Add `/contributions` page to web dashboard
- Add daily contribution brief to introspection sensor output
- Wire contributor profiles to contacts DB

### Phase 4: Player Coach Views (1 task, opus)
- Trend computation (D-1, D-7, D-30 rolling windows)
- Contributor profile aggregation with contacts join
- Beat-level contribution health for competition tracking

---

## 7. What This Unlocks

- **Competition**: Track which beats get contributions vs. which get signals — alignment gap visible
- **Contributor recognition**: Data-backed "top contributors" for ecosystem reporting
- **Cost optimization**: See which contribution types cost more to review (security > chore)
- **Demand forecasting**: Feature vs. bugfix ratio trends predict ecosystem maturity
- **Agent self-assessment**: Arc can evaluate whether review effort matches strategic priorities (D2 in PURPOSE.md)
- **Beat editor evaluation**: When Arc gains Infrastructure beat editor status (#383), contribution tags feed editorial quality scoring

---

*Design complete. Implementation tasks should follow the phase plan above.*
