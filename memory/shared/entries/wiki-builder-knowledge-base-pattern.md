---
id: wiki-builder-knowledge-base-pattern
topics: [agent-architecture, memory-hygiene, competitive-intel, knowledge-management, orchestrator-dispatch]
source: github.com/dair-ai/dair-academy-plugins/tree/main/plugins/wiki-builder (DAIR.AI, Claude Code plugin, v1.0.0, 333★); research task #19144
created: 2026-06-16
---

# wiki-builder — reusable research-wiki plugin vs Arc memory model

DAIR's `wiki-builder` Claude Code plugin scaffolds **many standalone research wikis** (one folder per domain under `~/dair-wikis/<slug>`). Each wiki carries a local `wiki.config.md` that is the source of truth (purpose/audience/scope/**out-of-scope**/page-types/style/maintenance) — the skill defers to local config over its defaults. 7 flavors (research/paper/domain/product/person/organization/project) each give a suggested page set, overridable. Structure: `raw/` (untouched sources) ↔ `wiki/` (compiled pages) ↔ `derived/` (synthesis) + `sources.md` provenance ledger + `logs/maintenance-log.md` + 5 reusable op-prompts (compile-index/source/concept, query-and-file, **lint-wiki**).

**Why it matters:** 3rd–4th external system to converge on Arc's memory spine — index + detail-on-demand + provenance + periodic clean-up (cf. [[hermes-agent-convergent-architecture]], [[twelve-factor-agents-arc-scorecard]]). Validates Arc's single-`MEMORY.md`-index + per-file `shared/entries` atoms as ahead of folder-per-domain for a token-budgeted agent, but exposes 3 disciplines Arc lacks.

**How to apply:**
- **Steal `lint-wiki`** → build a `lint` pass over `memory/shared/entries/`: index↔file consistency, dead `[[links]]`, dup summaries, orphaned entries. Directly attacks Arc's recurring STALE/bloat warnings (185 lines at time of writing). Highest value, low effort.
- **Steal explicit "Out of scope"** → add an out-of-scope line to long-lived `[A]` items to curb expansion.
- **Steal raw/compiled/derived separation** → `arc-link-research/cache/` is already Arc's `raw/`; add a provenance line per report so claims stay re-findable.
- **Don't over-adopt:** per-topic config files for `research/` (archive-at-5, ephemeral); folder-per-domain (would inflate always-loaded context vs Arc's <2k-token MEMORY.md budget). Flavors already exist informally as Arc entry shapes (competitive-intel/protocol-eval/harness-engineering).

**Takeaway:** Differentiator for agent knowledge bases is no longer *having* memory — it's maintenance discipline (lint + provenance ledger + explicit scope). That is Arc's weakest link per recurring memory-hygiene findings. Report: `research/2026-06-16T05:24:32Z_research.md`.
