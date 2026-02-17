# ADR-001: Memory Architecture

**Status:** Accepted
**Date:** 2026-02-17
**Author:** Arc (arc0.btc)
**Scope:** arc-starter template

---

## Context

Arc-starter provides a skeleton for autonomous agents: a Hono HTTP server, typed event bus, interval-based scheduler, and example sensors/query-tools. What it does not provide is any persistence layer — agents built on this template have no way to remember what happened across restarts, accumulate knowledge, or let an operator inspect their internal state.

Two reference implementations were studied to inform this decision:

**Agent Zero** (arc0btc/agent-zero) uses FAISS vector embeddings for semantic memory search with LLM-driven consolidation. Memory has a rich area taxonomy (main/fragments/solutions) and knowledge is imported from files via MD5 checksum change detection. Consolidation runs a language model to decide whether new memories should merge, replace, update, or coexist with similar existing memories. This produces high-quality memory that improves over time — but it requires Python, Docker, LangChain, and a vector embedding model (GPU or API calls per memory op).

**drx4** (secret-mars/drx4) uses a self-modifying markdown file as its operational instructions. The agent reads `daemon/loop.md` at the start of every cycle and edits it at the end (the EVOLVE phase). Health state is written to `health.json` every cycle. Memory is split into human-readable markdown files: `journal.md`, `learnings.md`, `contacts.md`, `portfolio.md`. A `processed.json` deduplication file prevents double-replies. The dual-write pattern ensures both SQLite and human-readable files stay in sync.

Arc-starter is TypeScript/Bun, deployed as a single process under systemd. It needs a memory system that:
1. Works without external services (no vector DB, no embedding API)
2. Is human-readable for operators monitoring the agent
3. Is machine-queryable for the agent itself and external tooling
4. Handles the full agent lifecycle: accumulate knowledge, deduplicate events, track cycle health
5. Enables self-evolution without corrupting the agent's own instructions

---

## Decision

Arc-starter uses a **two-layer memory architecture**: file-based working memory for human readability, and SQLite for machine-queryable operational history.

### Layer 1: File Memory (`memory/`)

Human-readable, git-tracked markdown files that serve as the operator's window into agent state. These are written by the agent but designed to be read by humans.

```
memory/
  working.md    # Active context, recent events, current goals (~50-100 lines)
  learnings.md  # Accumulated knowledge, append-only with periodic consolidation
```

**`memory/working.md`** is the agent's active context buffer. It contains:
- Current task queue (what the agent is working on)
- Recent meaningful events (last N cycles, not every idle cycle)
- Open questions and unresolved observations
- Evolution log (dated entries from each EVOLVE phase)
- Handoff notes (expiring annotations between loop and interactive sessions)

Size target: 50-100 lines. When it grows beyond 150 lines, the agent's EVOLVE phase consolidates older entries into `learnings.md`.

**`memory/learnings.md`** is the accumulated knowledge base. It is:
- Append-only during normal operation
- Written to when the agent learns something worth preserving across months
- Consolidated (deduplicated and summarized) by the EVOLVE phase every N cycles
- Organized by topic with headers and dates

Size target: grows indefinitely but stays readable. Consolidation prevents unbounded growth.

### Layer 2: SQLite Operational Log (`state/agent.db`)

Machine-queryable, the single source of truth for operational history. Three tables:

**`cycle_log`** — one row per cycle. Records what happened, how long each phase took, and the final status. Enables trend analysis: is the agent getting faster? Are certain phases failing repeatedly?

**`learnings`** — structured knowledge extracted from cycles. Each learning has content, tags, area (main/fragments/solutions), and importance score. Full-text search via FTS5 virtual table. Subject to consolidation: before inserting a new learning, the system checks for near-duplicates and applies merge/replace/update logic.

**`event_history`** — append-only typed event stream. Every `eventBus.emit()` call that matters is recorded here with timestamp, type, source, and payload (JSON). This is the observability bridge: query-tools can `SELECT` from this table to answer "what has the agent observed/done in the last hour?"

### The Relationship Between Layers

SQLite is the authoritative record. File memory is a human-readable digest derived from SQLite.

After each cycle with meaningful events:
1. The event is written to `event_history` in SQLite (primary write)
2. A summary line is appended to `memory/working.md` (secondary write, human digest)

The operator never needs to open SQLite to understand what the agent is doing — `memory/working.md` provides that. But when they need to query history ("how many times has this sensor failed in the last week?"), SQLite is the tool.

### Self-Evolution

The EVOLVE phase (added between REFLECT and LOG in the pipeline) reads cycle outcomes and updates `config/agent-behavior.json`. This file contains tunable behavioral parameters: consolidation thresholds, cycle frequencies for expensive operations, task priority weights.

The agent can safely modify this structured JSON. It cannot modify its own TypeScript source or loop instructions — that would require the drx4 self-modifying markdown pattern, which risks corrupting the agent's operational instructions. Structured config is safe; freeform instruction editing is not.

Every config change is appended to an `evolution_log` array in `agent-behavior.json`, creating an auditable history of how the agent's behavior has changed over time and why.

### Health Observability

Every cycle writes `health.json` to the project root. This file contains cycle number, timestamp, phase-by-phase status, key stats, and time of next scheduled cycle. External monitoring systems (and the operator) can determine agent liveness by checking this file's timestamp without hitting an HTTP endpoint.

The existing `/health` HTTP endpoint remains and serves the same data for real-time inspection.

---

## Rationale

**Why SQLite over a vector database?**

Vector databases (FAISS, Qdrant, pgvector) provide semantic similarity search — finding memories by meaning rather than keywords. This is powerful but requires either a local embedding model (GPU-hungry, adds 2+ GB of dependencies) or an API call per memory operation (latency and cost). For an agent template designed to run on a single server without GPU access, this is too heavy.

SQLite's FTS5 extension provides full-text search using BM25 ranking, which is fast, has zero additional dependencies, and is "good enough" for the scale arc-starter targets. When an agent has accumulated thousands of learnings and keyword search proves insufficient, upgrading to vector search is a localized change (replace the search function, keep everything else).

**Why two layers instead of just one?**

SQLite-only: operators would need to open a database tool to understand agent state. Not acceptable for a template — debugging should require only a text editor.

File-only: no queryable history. Pattern analysis ("is this sensor failing more than usual?") requires parsing markdown. Interactive sessions can't ask structured questions about loop history.

Two layers: each serves its purpose. The cost is the dual-write step, which is a single function call at the end of each meaningful cycle.

**Why append-only for learnings?**

Mutation of past learnings without consolidation logic leads to unpredictable agent behavior — the agent might "unlearn" something important by overwriting a fact with a less accurate version. Agent Zero's consolidation pattern (merge/replace/update/keep_separate/skip) makes the decision explicit and LLM-informed.

Arc-starter implements a simplified consolidation: FTS5 BM25 search for near-duplicates, then a consolidation prompt if the top result exceeds a configurable threshold. The five actions still apply — only the similarity metric changes (BM25 vs. cosine distance).

**Why structured config for self-evolution instead of self-modifying markdown?**

drx4's self-modifying `loop.md` is elegant but risky: a malformed edit by the agent can corrupt its own operational instructions, causing failure on the next cycle. drx4's evolution log even acknowledges this: "if edit fails, skip — don't corrupt loop.md."

Structured JSON has a schema. Invalid JSON fails to parse before it can be applied. The agent's TypeScript code validates config on load and falls back to defaults if invalid. The evolution history is preserved in the `evolution_log` array, which is just as auditable as a markdown changelog.

---

## Consequences

**What becomes easier:**

- Operators can read `memory/working.md` to understand agent state without any special tools
- Interactive sessions can query `state/agent.db` with any SQL client or the built-in query-tools
- External monitoring systems can poll `health.json` for liveness without an HTTP endpoint
- Cycle history, phase timing, and failure patterns are queryable for analysis
- Knowledge consolidation improves memory quality over time without unbounded growth
- Self-evolution is auditable and reversible (git history + evolution_log)

**What becomes harder:**

- Initial implementation is more work than in-memory state or a flat JSON log
- Dual-write requires discipline in the cycle pipeline (write to SQLite first, then digest to file)
- Consolidation logic adds complexity to the REFLECT/EVOLVE phases
- The FTS5 similarity threshold needs tuning — too low creates false duplicates, too high lets near-duplicates accumulate

**What this does not address (future work):**

- Semantic vector search for retrieving memories by meaning (upgrade path: replace FTS5 search with embedding API calls)
- Multi-agent memory sharing (separate service required)
- Encrypted memory at rest (SQLite encryption extension)
- Memory access control (all cycle phases currently have full read/write access)

---

## Alternatives Considered

### Alternative 1: FAISS Vector Store (Agent Zero approach)

Full semantic memory with LLM-driven consolidation. Produces highest-quality memory retrieval. Rejected for arc-starter because:
- Requires Python runtime or FFI bindings in TypeScript
- Local embedding model requires GPU or expensive API calls per memory op
- Docker/LangChain dependency chain is inappropriate for a starter template
- Can be adopted by teams that need semantic search — FTS5 is the upgrade path

### Alternative 2: JSON log files only

Simple: write a `memory/log.json` with all events. Human-readable if pretty-printed. Rejected because:
- No structured query capability
- File grows without bound (no consolidation)
- Pattern analysis requires full file parse
- Not suitable for interactive session inspection

### Alternative 3: In-memory state only (no persistence)

Zero dependencies, simplest possible. Rejected because:
- Complete memory loss on restart
- No continuity across sessions
- Cannot accumulate knowledge or track patterns

### Alternative 4: External database (PostgreSQL, Redis)

More powerful querying, could support multi-agent scenarios. Rejected because:
- External service dependency — arc-starter targets single-server deployments
- Adds operational complexity (connection management, service health)
- SQLite is sufficient for single-agent use at arc-starter's scale

### Alternative 5: Self-modifying markdown (drx4 approach)

Agent edits its own operational instructions each cycle. Elegant feedback loop. Rejected because:
- Risk of instruction corruption if LLM generates malformed markdown
- Hard to version-control incremental changes (diff noise)
- Structured config JSON achieves the same evolution goal with type safety

---

## Implementation

Phase 4 of the Arc Levels Up quest implements this architecture in arc-starter. Key files:

```
src/memory/
  index.ts          # Memory module public API
  db.ts             # SQLite connection and schema migration
  learnings.ts      # Learning CRUD with FTS5 consolidation
  cycle-log.ts      # Cycle log write/read operations
  event-history.ts  # Event history write/query operations

src/state/
  logger.ts         # Event bus listener — writes events to SQLite

src/query-tools/
  memory-query.ts   # Query functions for cycles, learnings, events

memory/
  working.md        # Active context (operator-readable digest)
  learnings.md      # Accumulated knowledge (append-only)

state/
  agent.db          # SQLite database (created at first run, gitignored)
  .gitkeep          # Track directory in git without committing the DB
```

The `src/memory/index.ts` module exports the complete TypeScript API.
All pipeline phases import from this module — they never touch SQLite directly.

HTTP endpoints for external access:
- `GET /api/memory/cycles?count=10` — recent cycle history
- `GET /api/memory/learnings?search=<query>&count=20` — FTS5 search or top by importance
- `GET /api/memory/events?type=<event_type>&count=20` — event stream query
