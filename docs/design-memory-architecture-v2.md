# Arc Memory Architecture v2 — Design Document

*Task #5821 | 2026-03-16 | Priority: Research & Design*

## Problem Statement

The bottleneck is **retrieval, not storage**. Today, `memory/MEMORY.md` (~12KB, 90 lines) is loaded in full every dispatch cycle regardless of task domain. Most of its content is irrelevant to any given task — cost snapshots from March 13 don't help a blog-publishing task; fleet roster details don't help a DeFi sensor fix.

**Current flow** (`dispatch.ts:261`):
```typescript
const memory = readFile(join(ROOT, "memory", "MEMORY.md"));
// → entire file injected into every prompt, every cycle
```

**Cost of the monolith:**
- Wastes ~3-4k tokens of context budget per dispatch on irrelevant memory
- Forces aggressive compression to stay under 2k token MEMORY.md guideline
- Discards useful detail (incident forensics, integration specifics) to fit budget
- No way to query historical memory — only what fits in the current file

## Design: Three-Layer Memory

### Layer 1: Topical File Split (immediate wins, no new deps)

Split MEMORY.md into domain-specific files. Dispatch loads only files relevant to the task's skill domains.

#### Proposed file structure

```
memory/
├── MEMORY.md              # Slim index: directives, fleet roster, critical flags only (~30 lines)
├── topics/
│   ├── fleet.md           # Fleet architecture, roster, coordination patterns
│   ├── incidents.md       # Recent incidents, dispatch stalls, recovery patterns
│   ├── cost.md            # Cost tracking, budget analysis, optimization learnings
│   ├── integrations.md    # API migrations, auth patterns, x402, email-sync
│   ├── defi.md            # Zest, Bitflow, Zero Authority, market positions
│   ├── publishing.md      # Blog, site health, deploy patterns
│   ├── identity.md        # Agent identities, on-chain, BNS, wallet state
│   └── infrastructure.md  # Umbrel node, Cloudflare, services, sentinel patterns
├── patterns.md            # (existing) operational patterns — loaded by retrospective tasks
├── fleet-status.json      # (existing)
└── ...                    # (existing auxiliary files unchanged)
```

#### Skill-to-topic mapping

A new mapping in dispatch (or a config file) determines which topic files to load per skill:

```typescript
// src/memory-topics.ts
const SKILL_TOPIC_MAP: Record<string, string[]> = {
  "blog-publishing":       ["publishing"],
  "blog-deploy":           ["publishing", "infrastructure"],
  "arc-payments":          ["integrations", "defi"],
  "arc-email-sync":        ["integrations"],
  "fleet-handoff":         ["fleet"],
  "fleet-task-sync":       ["fleet"],
  "arc-service-health":    ["incidents", "infrastructure"],
  "dao-zero-authority":    ["defi"],
  "x402-sponsor-relay":    ["integrations", "identity"],
  "arc-skill-manager":     ["fleet"],       // consolidation tasks
  "arc-cost-report":       ["cost"],
  "arc-failure-triage":    ["incidents"],
  // ... extend as skills are added
};

// Default topics loaded when no skill-specific mapping exists
const DEFAULT_TOPICS = ["fleet", "incidents"];
```

#### Dispatch loading change

Replace the single `readFile("memory/MEMORY.md")` with:

```typescript
function resolveMemoryContext(skillNames: string[]): string {
  // Always load the slim index
  const index = readFile(join(ROOT, "memory", "MEMORY.md"));

  // Collect unique topics from all skills
  const topics = new Set<string>(DEFAULT_TOPICS);
  for (const skill of skillNames) {
    const mapped = SKILL_TOPIC_MAP[skill];
    if (mapped) mapped.forEach(t => topics.add(t));
  }

  // Load topic files
  const topicContents = [...topics]
    .map(topic => {
      const content = readFile(join(ROOT, "memory", "topics", topic + ".md"));
      return content ? `## Memory: ${topic}\n${content}` : "";
    })
    .filter(Boolean)
    .join("\n\n");

  return [index, topicContents].filter(Boolean).join("\n\n");
}
```

**Expected impact:** 40-60% reduction in memory tokens per dispatch. A blog-publishing task loads ~1k tokens (index + publishing) instead of ~4k (full MEMORY.md). Fleet-irrelevant tasks stop paying for fleet state.

#### Migration path

1. Create `memory/topics/` directory
2. Extract sections from MEMORY.md into topic files (one-time, manual or scripted)
3. Slim MEMORY.md to index-only (directives, fleet roster, critical flags)
4. Add `SKILL_TOPIC_MAP` to dispatch
5. Update `buildPrompt()` to call `resolveMemoryContext()`
6. Update memory update instructions in prompt template (tell dispatched sessions which topic file to edit)

### Layer 2: SQLite FTS5 `arc_memory` Table (structured retrieval)

For memories that benefit from **query** rather than **bulk load** — especially historical incidents, resolved learnings, and cross-domain patterns.

#### Schema

```sql
CREATE VIRTUAL TABLE arc_memory USING fts5(
  key,           -- unique identifier (e.g., "incident:dispatch-stall-2026-03-14")
  domain,        -- topic domain: fleet, cost, incidents, integrations, defi, publishing, identity, infra
  content,       -- the memory text
  tags,          -- space-separated tags for filtering
  tokenize='porter'  -- stemming for better recall
);

-- Metadata in a shadow table (FTS5 doesn't support non-text columns well)
CREATE TABLE arc_memory_meta (
  key TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ttl_days INTEGER,          -- NULL = permanent, else auto-expire
  source_task_id INTEGER,    -- which task created this memory
  importance INTEGER DEFAULT 5  -- 1=critical, 10=trivial
);
```

#### Query patterns

```typescript
// Full-text search across all memories
function searchMemory(query: string, domain?: string): ArcMemory[] {
  const db = getDatabase();
  if (domain) {
    return db.query(
      "SELECT * FROM arc_memory WHERE arc_memory MATCH ? AND domain = ? ORDER BY rank"
    ).all(query, domain);
  }
  return db.query(
    "SELECT * FROM arc_memory WHERE arc_memory MATCH ? ORDER BY rank"
  ).all(query);
}

// Load all memories for a domain (replaces topic file for structured data)
function getMemoriesByDomain(domain: string): ArcMemory[] {
  return db.query(
    "SELECT * FROM arc_memory WHERE domain = ? ORDER BY rank"
  ).all(domain);
}

// Expire old memories
function expireMemories(): number {
  return db.run(
    `DELETE FROM arc_memory WHERE key IN (
       SELECT key FROM arc_memory_meta
       WHERE ttl_days IS NOT NULL
       AND julianday('now') - julianday(created_at) > ttl_days
     )`
  ).changes;
}
```

#### What goes in FTS vs. topic files?

| Memory Type | Storage | Reason |
|-------------|---------|--------|
| Critical flags | MEMORY.md (index) | Always needed, must be visible |
| Directives & milestones | MEMORY.md (index) | Strategic context, always loaded |
| Fleet roster | MEMORY.md (index) | Structural, rarely changes |
| Recent incidents | `topics/incidents.md` | Loaded by health/triage tasks |
| Historical incidents | `arc_memory` FTS | Queryable, not bulk-loaded |
| Cost snapshots | `arc_memory` FTS | Historical, queryable by date |
| Integration learnings | `topics/integrations.md` (active) + FTS (historical) | Active ones loaded; old ones queryable |
| Patterns | `patterns.md` (existing) | Loaded by retrospective tasks only |
| Resolved bugs/fixes | `arc_memory` FTS | Historical reference, not daily context |

#### CLI integration

```
arc memory search --query "dispatch stall" [--domain incidents]
arc memory add --key "incident:xyz" --domain incidents --content "..." [--ttl 90]
arc memory list [--domain fleet] [--limit 20]
arc memory expire   # run TTL cleanup
```

#### Dispatch integration

FTS is **not** bulk-loaded into prompts. Instead, dispatched sessions query it via CLI when they need historical context. The prompt instructions would include:

```
- Search historical memory: arc memory search --query "keyword" --domain domain
```

This keeps context lean while making the full memory corpus queryable on demand.

### Layer 3: sqlite-vec Semantic Search (future, evaluate later)

#### Current status

sqlite-vec is **not installed** on the VM. Bun's `db.loadExtension('vec0')` fails with "cannot open shared object file."

#### What it would enable

- Embed memories as vectors (e.g., using a local embedding model or API)
- Semantic similarity search: "find memories about dispatch reliability" would match "stale lock recovery" even without keyword overlap
- Automatic clustering of related memories

#### Evaluation

**Not recommended for near-term implementation.** Reasons:

1. **Dependency cost:** Requires installing sqlite-vec extension (.so file), pinning versions, managing across fleet VMs
2. **Embedding source:** Needs either a local embedding model (resource overhead on VMs) or API calls (cost, latency, dependency)
3. **FTS5 covers 90% of retrieval needs:** Arc's memories use consistent terminology (dispatch, sensor, fleet, stall). Keyword search with Porter stemming will match well because Arc writes its own memories in a consistent vocabulary
4. **Diminishing returns:** The token savings from topical split + FTS5 querying already solve the stated bottleneck. Semantic search adds marginal value for significant complexity
5. **Context window growth:** As model context windows expand, the pressure on memory compression decreases

**Revisit when:** (a) memory corpus exceeds ~500 entries and keyword search produces too many false negatives, or (b) sqlite-vec becomes a Bun built-in or standard package.

## Implementation Plan

### Phase 1: Topical File Split (P3, Opus, ~1 session)

**Scope:** Create topic files, slim MEMORY.md, update dispatch loading logic.

1. Create `memory/topics/` directory
2. Write `src/memory-topics.ts` with skill-to-topic mapping + `resolveMemoryContext()`
3. Extract MEMORY.md sections into topic files (scripted migration)
4. Update `buildPrompt()` in `dispatch.ts` to use `resolveMemoryContext()`
5. Update prompt template instructions to tell sessions which topic file to edit
6. Update `arc-skill-manager` consolidation logic to handle topic files

**Risk:** Low. File reads are the same mechanism. Fallback: if topic dir is empty, load full MEMORY.md.

**Validation:** Compare prompt token counts before/after on 5 representative task types.

### Phase 2: SQLite FTS5 Table (P4, Opus, ~1 session)

**Scope:** Schema, CRUD functions in db.ts, CLI commands, migration of historical data.

1. Add `arc_memory` FTS5 table + `arc_memory_meta` table to `initDatabase()`
2. Add query/insert/update/delete/expire functions to `db.ts`
3. Add `arc memory` CLI subcommands to `cli.ts`
4. Migrate historical cost snapshots and resolved incidents from MEMORY.md into FTS
5. Add expiry sensor (daily, cleans TTL-expired memories)
6. Update dispatch prompt instructions to include `arc memory search` usage

**Risk:** Medium. FTS5 is well-supported in Bun SQLite (verified). Main risk is adoption — dispatched sessions need to learn to use `arc memory search` instead of expecting all context pre-loaded.

### Phase 3: sqlite-vec Evaluation (P8, deferred)

**Scope:** Install sqlite-vec, prototype embedding pipeline, benchmark against FTS5.

**Status:** Deferred. Revisit when FTS5 proves insufficient or sqlite-vec packaging improves.

## Token Budget Analysis

| Component | Current (tokens) | After Phase 1 (tokens) | After Phase 2 (tokens) |
|-----------|----------------:|----------------------:|----------------------:|
| MEMORY.md (full) | ~3,500 | ~800 (index only) | ~800 |
| Topic files (loaded) | 0 | ~800 (1-2 topics) | ~800 |
| FTS results (in-prompt) | 0 | 0 | 0 (queried on demand) |
| **Total memory tokens** | **~3,500** | **~1,600** | **~1,600** |
| **Savings** | — | **~54%** | **~54% + queryable history** |

Phase 1 alone delivers the major token savings. Phase 2 adds queryable depth without increasing prompt size.

## Decision Summary

| Question | Answer |
|----------|--------|
| Which memory types benefit most from structured retrieval? | Historical incidents, cost snapshots, resolved integration issues — things queried occasionally, not needed every cycle |
| What should dispatch loading logic look like? | Slim index always + skill-mapped topic files selectively |
| Is topical split alone sufficient for near-term? | **Yes.** Phase 1 delivers ~54% token reduction and domain-scoped context. Phase 2 adds queryable depth as a follow-up. |
| Should we pursue sqlite-vec? | **Not now.** FTS5 with Porter stemming covers Arc's consistent vocabulary well. Revisit at 500+ memory entries or when packaging improves. |
