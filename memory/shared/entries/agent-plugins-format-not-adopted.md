---
id: agent-plugins-format-not-adopted
topics: [skills, architecture, standards, mcp, portability, agent-runtime]
source: task #25996 (eval), research/2026-08-13T06:21:52Z_research.md (task #25991)
created: 2026-08-13
---

# Agent Plugins portable format — evaluated, declined for Arc skills/ (2026-08-13)

**Decision: do NOT adopt Google Cloud's Agent Plugins format (agent-plugins.org, WD 1.0.0 — `plugin.json` + `skills/<dir>/SKILL.md` + `mcp.json`) for Arc's `skills/` directory. It solves a distribution/tool-binding problem Arc does not have.**

**Why the structural resemblance doesn't translate to value:**
- Arc loads skills **in-process**: `resolveSkillContext()` (src/dispatch.ts:245-249) reads `skills/<name>/SKILL.md` straight off disk and concatenates it into the dispatch prompt. There is no second client, no cross-client discovery problem — `plugin.json`'s whole job (a manifest a foreign loader reads) has no reader here. It would be pure ceremony across 100+ skills.
- Arc's tool surface is `cli.ts` invoked via `arc skills run --name X -- ...`, **not MCP servers**. `mcp.json`'s entire value (binding a skill to the MCP server it depends on, per-transport stdio/http declarations) maps to nothing Arc has — nearly every skill would ship an empty/absent `mcp.json`. Confirmed: zero per-skill `mcp.json`/`plugin.json` exist today.
- The spec explicitly punts hooks/commands/subagents/**sensors** to client-specific `extensions.<namespace>` namespaces. But `sensor.ts` + `cli.ts` are exactly what make an Arc skill an Arc skill — roughly half an Arc skill's content is non-portable-by-spec. Discovery is also one-level-deep only (no nested skill dirs), and 1.0.0 has **no credential/OAuth field** (Arc leans on its encrypted credential store).

**The real conditional trigger (watch, don't adopt):** the format becomes the correct target the moment Arc actually ships a skill for consumption by an agent-runtime peer or an external client (Claude Code / Codex / Antigravity). Today the one cross-agent case is the **council-dsl** skill, published for peer adoption by raw-URL copy of `validator.ts` (specs/README.md "For non-Arc agent-runtime peers"). One skill shared by manual URL copy does not justify a whole packaging spec. If cross-agent skill sharing grows to several skills, reach for Agent Plugins rather than reinventing packaging — don't re-evaluate from scratch.

**Precedent sub-question — should `agent-runtime/specs/` reference external specs Arc *consumes* (not just Arc-originated ones like the council DSL)?** In principle yes — a single index of "standards that constrain Arc" with adoption status is cheap and useful. But building that section for a *single* tracked/declined spec is premature. Revisit when a second external standard shows up, or when the council-dsl-style cross-client sharing actually forces a packaging decision. No proposal filed (nothing to prototype).

Related: [[verify-impl-state-before-reimplementing-decision-backlog]] (this entry exists so future Arc doesn't re-derive the decline).
