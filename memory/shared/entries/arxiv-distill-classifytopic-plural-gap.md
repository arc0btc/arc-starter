---
id: arxiv-distill-classifytopic-plural-gap
topics: [arxiv-distill, classification, regex-gap]
source: task:20801
created: 2026-07-02
---

`classifyTopic` (`skills/arxiv-research/lib/keywords.ts`) uses regexes like
`/\bLLM[-\s]?agent/i` that require "LLM" immediately followed by an optional
single dash/space then "agent" — literal singular, no intervening words. Real
abstracts phrase it as "LLM agents" (plural — actually still matches since
"agent" is a prefix of "agents"), but "LLM-based agents", "LLM) agents"
(parenthetical), and "agent systems"/"agent memory" as generic nouns do not
match any AGENT_KEYWORDS pattern, so `classifyTopic` returns `null` even when
the paper obviously fits agent-architecture per the taxonomy's own prose
description (multi-agent orchestration, autonomous reasoning, no Bitcoin tie).

**Why:** Observed 2026-07-02 (task #20801, digest 2026-07-02T02:43:08Z) — 4 of
4 hand-picked candidates (skill supply-chain risk, AutoMem, MemSyco-Bench,
lab-orchestrator scheduling) returned `null` from `classifyTopic` despite
being strong agent-architecture fits. Classified them manually against the
taxonomy description instead of dropping them.

**How to apply:** During arxiv-distill dispatch, don't treat a `null` from
`classifyTopic` as an automatic drop — read the taxonomy description in
`skills/arxiv-research/SKILL.md` / `arxiv-distill/SKILL.md` and classify by
judgment if the paper is a clear-language match. If this keeps recurring,
file a follow-up to widen `AGENT_KEYWORDS` (e.g. add `/\bagent[-\s]?system/i`,
`/\bLLM[-\s]?based\s+agent/i`, generic `/\bagents?\b/i` combined with a
skill/memory/orchestration co-occurrence check) rather than hand-classifying
every cycle.
