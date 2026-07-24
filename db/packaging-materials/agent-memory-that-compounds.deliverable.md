# Research Report — Agent Memory That Compounds

**Links:** @BraceSproul (LangChain OpenWiki Brains), @0xCodez (staged project memory),
@phosphenq (STATE.md loop state), @pauliusztin_ (4 agent-memory repos), @wandermist (Karpathy/Obsidian second-brain).

## TL;DR (3 lines)
- Two things are converging on the same shape: **memory synthesized from external sources you already use** (LangChain OpenWiki: Gmail/Notion/git/X/HN → local wiki) and **staged memory maturity** (0xCodez: facts you've *verified* outrank facts you're *guessing*).
- The best-in-thread idea is a **distillation pipeline with explicit stages** — 0xCodez annotates each memory line with `# stage 1→2 / stage 3 / stage 4 distillations`, so raw observations get promoted to durable rules only after verification.
- Arc's `memory/MEMORY.md` (ASMR v1: `[A] Active / [S] Signal / [P] Patterns / [E] Evals / [L] Validated / [N] Contacts`) is already sectioned, but has **no verification gate and no promotion pipeline** — the exact gap these links formalize.

## Key takeaways (cited)
- **@BraceSproul — OpenWiki Brains (LangChain, released 2026-07-09):** started as an OSS CLI that generates+maintains a wiki *for a codebase* and keeps it current as code changes; 0.1.0 expands to "a general-purpose brain for your agents" — connects to Gmail, Notion, git, Twitter/X, Hacker News, web search, turns them into a *local wiki your agents use as memory*, and keeps it auto-updated. `github.com/langchain-ai/openwiki`, `npm: openwiki`. (cache 08bb14135328fa82)
- **@0xCodez — staged project memory (5.1M impressions):** a `Project memory` file with labeled stages — `## Verified facts # stage 3 — stop guessing` (e.g. "prc is in dollars, verified via SELECT MIN/MAX"), `## General rules # stage 4 — consult before re-deriving`, `## Open failures (investigate next session) # stage 1→2`, `## Lessons learned # stage 4 distillations`. The insight: **memory has a maturity ladder**; a claim earns "rule" status only after verification, and open failures are first-class carryover state. (cache 9e11a5772c24a2da)
- **@phosphenq — STATE.md + hooks (auth quality loop):** a persistent `STATE.md` holding `## last run`, `## in progress`, `## lessons (write here, not in chat)` with dated entries ("2026-07-04: this runner hits a TLS issue in PowerShell, use bash"). Loop state and hard-won environment lessons live in a file, not the conversation. (cache 9ee0ba8fb8ed17b1)
- **@pauliusztin_ — 4 agent-memory repos to study:** signals a "general trend around knowledge graphs and LLM wikis" for agent memory (the specific repo list is in the thread's replies, not the root tweet). Directionally confirms OpenWiki's wiki-as-memory bet. (cache 5722c03b3e75bb94)
- **@wandermist — second-brain (1.1M impressions):** Karpathy-style Obsidian vault + Claude Code + web-clipper as a personal memory system; the durable-notes-as-memory pattern applied to a human, mirroring the agent case. (cache dcba59b694574ee9)

## Arc-alignment (grounded in repos)
- **Where Arc already does this:** `memory/MEMORY.md` is a sectioned, git-versioned long-term memory (ASMR v1, sections `[A]…[N]`). `memory/recent.log` is a per-task reflection log (one line per close). `memory/shared/entries/<slug>.md` are the "distilled" durable notes with frontmatter. `arc-link-research` already synthesizes *external links* into `research/` reports — Arc's closest analog to OpenWiki, but link-only, human-triggered, and not fed back into MEMORY.md automatically.
- **Where it's a gap (the actionable part):**
  1. **No verification stage.** MEMORY.md mixes verified facts and open hypotheses with no `stage` marker. 0xCodez's `# stage 3 — verified` / `# stage 1→2 — open` annotation is a cheap, copy-today upgrade to the ASMR schema. The DeepMind security audit ([research/2026-07-06_security-audit-...]) already flagged that `recent.log → MEMORY.md has no provenance check` — same gap, now with a concrete fix shape.
  2. **No automatic promotion.** Arc consolidates MEMORY.md by hand ("periodically consolidate," last 2026-07-07). OpenWiki's *auto-updated wiki* and Glean's *trace learning* (see harness report) are the automated version.
  3. **No external-source ingestion into memory.** OpenWiki pulls Gmail/git/X into a brain; Arc has `arc-email-sync`, git, and X access but never fuses them into MEMORY.md.
- **Port to agent-runtime?** The *schema upgrade* (staged/verified memory markers) is a arc-starter MEMORY.md edit today. The *mechanism* (auto-promotion + external-source fusion into a shared brain) belongs in **agent-runtime** — a fleet-wide memory substrate that every agent reads/writes is exactly the "single-player → multiplayer" jump already noted in `research/2026-06-29T14:30:10Z_research.md`.

## How this was verified
- Tweets cached 2026-07-10T12:58Z: `08bb14135328fa82` (OpenWiki), `9e11a5772c24a2da` (0xCodez), `9ee0ba8fb8ed17b1` (phosphenq), `5722c03b3e75bb94` (pauliusztin), `dcba59b694574ee9` (wandermist) — all under `skills/arc-link-research/cache/`.
- Dedup: extends `research/2026-06-27T15:00:00Z_agent-memory-hygiene.md` and `.../2026-06-29T14:32:33Z_agent-memory-store-search-update-cleanup.md`; new signal = OpenWiki product + staged-maturity schema.
