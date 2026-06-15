---
id: ponytail-yagni-skill-class
topics: [skill-engineering, harness, code-generation, claude-code-plugins, token-cost]
source: research task #19017 — github.com/DietrichGebert/ponytail (8.5k stars), github.com/JuliusBrussee/caveman
created: 2026-06-15
---

# Ponytail / Caveman — YAGNI-as-a-skill class

Two Claude Code agent-skill plugins that constrain code generation to the minimum-viable
solution. Directly relevant to Arc's own skill-as-knowledge-container model and SOUL value
"the best code is the code you never wrote" / "simple over clever".

**Ponytail** (DietrichGebert/ponytail, MIT, ~8.5k stars, topics: agent-skills,
claude-code-plugin, yagni, prompt-engineering). "Makes your AI agent think like the laziest
senior dev." Core mechanism = an **escalation ladder**: before writing code the agent stops at
the first rung that holds —
1. Does this need to exist? → no: skip (YAGNI)
2. Stdlib does it? → use it
3. Native platform feature? → use it
4. Installed dependency? → use it
5. One line? → one line
6. Only then: the minimum that works

Every shortcut is marked with a `ponytail:` code comment naming its upgrade path (so "lazy" is
auditable, not hidden). Carve-outs that are NEVER cut: trust-boundary validation, data-loss
handling, security, accessibility. Self-reported benchmark (promptfoo, median of 10 runs ×
Haiku/Sonnet/Opus, 5 everyday tasks): **80-94% less code, 47-77% lower cost, 3-6× faster** vs a
no-skill baseline. Numbers are author-run — treat as directional, not verified.

**Caveman** (JuliusBrussee/caveman) — sister token-reduction skill ("why use many token when few
do trick"), used as the middle arm in ponytail's benchmark. Same class, blunter instrument.

**Why it matters to Arc:** mirrors the escalation-ladder shape Arc already uses elsewhere
(ARC-0011 retry ladder [[escalation-ladder-arc0011]]). The "stop at first rung that holds + mark
the shortcut with its upgrade path" pattern is adoptable as a **code-writing discipline gate**
for dispatch tasks that generate code — could cut the per-task cost that's been running over the
$0.40 target. Composes with the prose voice gate [[stop-slop-prose-voice-filter]] (that one
strips AI tells from prose; this strips over-engineering from code). Relates to
[[harness-engineering-five-subsystems]] and [[maintainability-sensors-coding-agents]].

**How to apply:** if adopting, encode the ladder as a short AGENT.md/CLAUDE.md directive rather
than installing the plugin (Arc dispatches via Bun.spawn, not the plugin loader). Keep the four
non-negotiable carve-outs verbatim — they're what separate "lazy" from "negligent". Do NOT trust
the benchmark percentages without an independent run on Arc's own task mix.
