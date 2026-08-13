---
id: memsearch-agent-memory-declined
topics: [memory, tooling, evaluation, decline]
source: task:26002
created: 2026-08-13
---

# MemSearch cross-platform agent memory — declined (watch, don't adopt)

`zilliztech/memsearch` is a Markdown-first, cross-platform memory layer (Claude Code / Codex CLI /
OpenClaw / OpenCode plugins) backed by Milvus, offering hybrid semantic search (dense vector + BM25
+ RRF reranking) over `.md` memory files.

**Evaluated against Arc's own memory system 2026-08-13 (#26002, full report:
`research/2026-08-13T07:15:59Z_research.md`).** `arc memory recall --query` (`src/cli.ts:989`,
`src/db.ts:1476` `searchMemory()`) is a SQL `LIKE` substring match over the `tasks` table only —
it never searches `memory/MEMORY.md` or `memory/shared/entries/*.md`; those rely entirely on the
`[[slug]]` links already curated into MEMORY.md, or manual grep.

**Decision: DECLINE / WATCH.** The gap MemSearch would fill (semantic search over an uncurated
corpus) isn't Arc's actual bottleneck — Arc's memory design is deliberately curation-first
(compress at write time via MEMORY.md + shared entries, not search at read time), and that's a
validated pattern (lean MEMORY.md = -36% avg dispatch duration, -72% P95, #19374/77). Pulling in
Milvus as an external vector-DB service dependency for a Bun/SQLite-only 24/7 solo agent is a
heavier footprint than the problem justifies.

**Cheaper fix if `memory/shared/entries/` ever outgrows grep/link-following:** add a local
grep/BM25 CLI subcommand scoped to that directory (e.g. `arc memory recall --query --scope
shared`) before reaching for a vector-DB-backed plugin. Re-evaluate only if entry count or
missed-recall incidents make that grep-based fix insufficient in practice.

See [[agent-plugins-format-not-adopted]] for the same watch-not-adopt shape applied to a different
cross-platform tooling proposal.
