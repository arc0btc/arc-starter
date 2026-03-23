# ASMR Memory Design
# Arc Structured Memory Representation

*Quest: memory-asmr — Phase 1/4 (Design)*
*Created: 2026-03-23T20:24Z*
*Source: task:8452, parent chain: #8443 ← #8441*

---

## Motivation

Current `MEMORY.md` is a flat Markdown file — no temporal indexing, no category semantics, no selective retrieval. Entire file loads into every dispatch context (~2k tokens always, growing). Problems:

1. **No temporal reasoning** — can't distinguish "fact from 3 days ago" from "fact from 3 months ago" without reading prose
2. **No supersession** — stale entries coexist with fresh ones until manual consolidation
3. **No selective loading** — every dispatch pays for memory irrelevant to the current task
4. **No decay** — nothing expires; file grows without bound until manual trim

Research basis: Chronos (2603.16862) temporal event decomposition, OEL continuous accumulation, Resource-Aware Reasoning on when to pay for context.

---

## Category Schema (6 Categories)

### Category A — Operational State

**Purpose:** Current system status, active flags, live conditions. High churn.

**Examples:** dispatch gate status, active incidents, service UP/DOWN, wallet balances, circuit breakers, rate limit cooldowns

**Retention:** Until explicitly superseded OR 7 days from creation (whichever comes first)

**Supersession rule:** New observation of same condition replaces old. Old entry gets inline `[SUPERSEDED BY: new-entry-id]` marker.

**Load in dispatch:** Always — these are the most time-critical entries.

**Token budget share:** ≤ 600 tokens

---

### Category F — Fleet

**Purpose:** Agent roster, routing rules, capabilities, addresses, relationships. Medium churn.

**Examples:** agent IPs, online/offline status, ERC-8004 identities, email addresses, task routing decisions

**Retention:** Until explicitly updated. No automatic expiry.

**Supersession rule:** Explicit update with `[UPDATED: YYYY-MM-DD]` tag. Prior value noted in Temporal Events if change is significant.

**Load in dispatch:** Always — routing decisions require current fleet state.

**Token budget share:** ≤ 400 tokens

---

### Category S — Services

**Purpose:** External integrations, API endpoints, credential key names, SDK versions, rate limits. Medium churn.

**Examples:** Unisat API base URL, x402 relay version, Bitflow SDK endpoint, aibtc.news beat slugs, MCP server version

**Retention:** Until superseded by version bump or migration task. No automatic expiry.

**Supersession rule:** Version change creates new entry; old entry tagged `[SUPERSEDED BY: new]` with date.

**Load in dispatch:** Selective — load only Services entries whose `skills:` tag list overlaps with the current task's skills array.

**Token budget share:** ≤ 500 tokens (after filtering)

---

### Category T — Temporal Events

**Purpose:** Append-only log of significant incidents, resolutions, and changes. Immutable history.

**Examples:** x402 NONCE_CONFLICT resolution timeline, Hiro API shutdown, relay upgrade from v1.20.1→v1.20.2, fleet suspension/recovery events

**Retention:** 90 days rolling, then archive to `memory/archive.md`.

**Supersession rule:** Never supersede — history is immutable. New events append. Related events reference each other with `[FOLLOWS: event-ref]`.

**Load in dispatch:** Conditional — load only when task subject matches keywords: `incident`, `retrospective`, `audit`, `resolution`, `history`, `recover`, `debug`.

**Token budget share:** ≤ 600 tokens (when loaded); 0 tokens when not triggered

---

### Category P — Patterns

**Purpose:** Reusable operational patterns validated in ≥2 distinct task cycles. Low churn.

**Examples:** sentinel gate pattern, sensor dedup timing, dispatch model selection rules, fleet routing decisions

**Retention:** Permanent until explicitly retired. Retirement requires evidence it no longer applies.

**Supersession rule:** Refined pattern with same semantic scope replaces prior. Old pattern tagged `[RETIRED: YYYY-MM-DD reason]`.

**Load in dispatch:** For P1–P5 tasks (where judgment is needed). Skip for P8+ pure execution tasks.

**Token budget share:** ≤ 600 tokens

---

### Category L — Learnings

**Purpose:** Agent-specific insights, one-off discoveries, task post-mortems not yet promoted to Patterns. Medium churn.

**Examples:** beat ownership enforcement, PR comment etiquette, GitHub-only policy reminders, API field naming quirks

**Retention:** 30 days, then either promote to Patterns (if reusable) or archive.

**Supersession rule:** Explicit update or promotion. If a learning appears ≥3 times in retrospectives, it's a Pattern.

**Load in dispatch:** All tasks — these are the "working notes" layer.

**Token budget share:** ≤ 600 tokens

---

## Temporal Metadata Schema

Each entry in MEMORY.md uses inline temporal tags (no YAML frontmatter — file stays readable Markdown):

```
[STATE: 2026-03-23]          # Operational State — date created/last-confirmed
[EVENT: 2026-03-23T06:05Z]   # Temporal Event — precise timestamp (Chronos-style)
[UPDATED: 2026-03-23]        # Fleet/Services — last modification date
[PATTERN: validated]          # Pattern — validated status
[LEARNING: 2026-03-23]       # Learning — date captured
[SUPERSEDED BY: entry-id]    # Any category — nullifies this entry
[SUPERSEDES: entry-id]       # Any category — what this replaces
[EXPIRES: 2026-03-30]        # Operational State — explicit expiry date
[FOLLOWS: event-id]          # Temporal Event — links to prior event in chain
[SKILLS: skill1,skill2]      # Services — which skills this entry is relevant to
[RETIRED: 2026-03-23 reason] # Patterns — marks retired pattern
```

**Entry format:**
```markdown
**Entry title** [STATE: 2026-03-23] [EXPIRES: 2026-03-30]
Description of the state. One or two sentences max. No prose padding.
```

---

## Structured MEMORY.md Format

Replace the current flat structure with this section layout:

```markdown
# Arc Memory
*Schema: ASMR v1 — Last consolidated: YYYY-MM-DDTHH:MM:SSZ*
*Token estimate: ~XXXt (A:Xt F:Xt S:Xt T:Xt P:Xt L:Xt)*

---

## [A] Operational State
<!-- High-churn system status. Expires after 7 days unless refreshed. -->

## [F] Fleet
<!-- Agent roster, routing rules, capabilities. No automatic expiry. -->

## [S] Services
<!-- External integrations, API endpoints, versions. Skill-tagged for selective load. -->

## [T] Temporal Events
<!-- Append-only incident/resolution log. Load on incident/audit keywords only. -->

## [P] Patterns
<!-- Reusable operational patterns. Validated ≥2 cycles. Permanent. -->

## [L] Learnings
<!-- Working notes. 30-day lifecycle, then promote or archive. -->
```

The comment lines serve as category metadata hints for future tooling. They are stripped when loading into dispatch context.

---

## Supersession Rules

### Rule S-1: Same-condition replacement (Operational State)
When a new state observation contradicts an existing [A] entry, the old entry is tagged `[SUPERSEDED BY: new-slug]` and the new entry includes `[SUPERSEDES: old-slug]`. Consolidation task removes the superseded entries.

### Rule S-2: Version bump (Services)
When an external service changes version or endpoint, the old [S] entry is tagged `[SUPERSEDED BY: new-slug date]`. Old entries with `[SUPERSEDED BY:]` older than 14 days are removed at next consolidation.

### Rule S-3: Pattern refinement (Patterns)
When a pattern is revised, old version is `[RETIRED: date reason]`. New version references old: `[SUPERSEDES: old-pattern-ref]`. Retired patterns are archived after 30 days.

### Rule S-4: Temporal Events never supersede
[T] entries are append-only. To "correct" a prior event, append a new event that describes the correction, referencing the prior with `[FOLLOWS: prior-event-id]`.

### Rule S-5: Stale detection
At consolidation time, any [A] entry older than 7 days without an `[EXPIRES:]` extension is flagged as `[STALE: date]`. Flagged entries move to [T] as "last-known state" events and are removed from [A].

### Rule S-6: Learning promotion
Any [L] entry that appears in retrospectives ≥3 times OR is referenced in ≥2 task result_summaries is promoted to [P] by the consolidation task.

---

## Selective Retrieval Specification

### Current behavior (v1)
Dispatch inlines entire `MEMORY.md` into context. ~2k tokens, growing.

### Target behavior (ASMR v1)
`getMemoryForTask(task)` returns a filtered view based on:

```typescript
interface MemoryLoadSpec {
  always: ["A", "F"];           // Operational State + Fleet always loaded
  conditional: {
    "S": { when: "skills_overlap" };     // Services: filter by task.skills
    "T": { when: "keywords_match" };     // Temporal Events: incident keywords
    "P": { when: "priority_lte_5" };     // Patterns: P1-P5 tasks only
    "L": { when: "always" };             // Learnings: all tasks
  };
  token_budget: 2800;           // Hard cap (leaves room for SOUL + CLAUDE + SKILL.md)
  priority_order: ["A", "F", "L", "P", "S", "T"];  // Drop from right if over budget
}
```

**Keyword trigger list for [T] (Temporal Events):**
- incident, retrospective, audit, resolution, history, recover, debug, regression, outage, rollback, revert, failure-analysis, postmortem

**Skills overlap for [S] (Services):**
- Extract `skills` array from task record
- Load [S] entries where any `[SKILLS: ...]` tag intersects with task skills
- If task has no skills or skills don't match any [S] entries, load all [S] entries (safer default)

**Token budget enforcement:**
1. Compute token estimate per section (rough: 1 token ≈ 4 chars)
2. Build output in priority order: A → F → L → P → S → T
3. Stop adding sections once cumulative estimate exceeds budget
4. Always include complete sections (no mid-section truncation)

---

## Automated Consolidation Spec

Consolidation runs as a scheduled task (P9, haiku) triggered by the `arc-memory` sensor on a weekly cadence.

**Consolidation steps:**

1. **Stale sweep [A]:** Mark entries older than 7 days without refresh as `[STALE]`. Move to [T] as "last-known state" event. Remove from [A].

2. **Supersession cleanup:** Remove entries tagged `[SUPERSEDED BY:]` older than 14 days. Remove entries tagged `[RETIRED:]` older than 30 days.

3. **Temporal Events archive:** Move [T] entries older than 90 days to `memory/archive.md`.

4. **Learning review:** Flag [L] entries older than 30 days for promotion or archival decision.

5. **Token audit:** After consolidation, estimate token count per section. If any section exceeds budget share, create a follow-up task to manually review and compress that section.

6. **Commit:** Commit MEMORY.md changes with `chore(memory): consolidation YYYY-MM-DD — removed N stale, archived M events`.

---

## Migration Path (for Phase 2)

Current MEMORY.md sections map to new categories as follows:

| Current Section | New Category |
|----------------|--------------|
| Shared Reference Entries | [L] initially; review for promotion to [P] |
| Directives & Milestones | [F] (fleet/strategic) + [L] (tactical directives) |
| Fleet Roster | [F] |
| Critical Flags | [A] (active flags) or [T] (resolved incidents) |
| Fleet Architecture | [F] + [S] (service architecture) |
| Key Learnings | [L] or [P] (if ≥2 validation cycles) |
| Consolidated Retrospective Patterns | [P] |

Each migrated entry gets the appropriate temporal tag based on its content and the date it was last observed in a task.

---

## Phase Dependencies

- **Phase 1 (this):** Design doc ← current
- **Phase 2:** Implement `getMemoryForTask()` in dispatch context builder. Restructure MEMORY.md format (add section headers + entry tags).
- **Phase 3:** Migrate current MEMORY.md content to ASMR categories. Assign temporal tags based on last-known dates.
- **Phase 4:** Build consolidation sensor task. Validate token budgets across 10 recent tasks. Update CLAUDE.md to document new memory protocol.

---

## Design Constraints

1. **No new file types** — MEMORY.md stays as the primary file. No SQLite tables for memory entries. Markdown stays human-readable.
2. **No breaking changes to dispatch** — Phase 2 is additive. Old MEMORY.md format still works; new format is an enhancement.
3. **Inline tags only** — No YAML frontmatter in MEMORY.md. Tags are inline, grep-able, and backwards-compatible.
4. **Token budget is hard** — 2800 tokens for memory. If categories grow, consolidation is required before budget expands.
5. **Git is the version history** — Entry creation/modification dates come from the inline tags, not from git log. Git log is authoritative for audits but not for runtime retrieval.
