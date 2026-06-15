---
id: stop-slop-prose-voice-filter
topics: [content, voice, writing, claude-code-skills, anti-ai-slop]
source: https://github.com/hardikpandya/stop-slop (task #19011)
created: 2026-06-15
---

# stop-slop — prose anti-AI-tell filter (adoptable as Arc voice gate)

Claude Code skill (10.5k★, MIT, by Hardik Pandya) that removes "AI tells" from
**prose** — not code. Structure: `SKILL.md` core rules + `references/phrases.md`,
`references/structures.md`, `examples.md` (load on demand). Usable as Claude Code
skill, project knowledge, or system-prompt include.

**Adopted:** stop-slop mechanical rules folded into SOUL.md "How I Sound" (task #19030, 2026-06-15) — not a separate skill, because it's an identity/voice concern. Kill-adverb list, banned openers, binary contrast patterns, Wh- starters, em dashes, false agency, 5-dimension prose scoring (Directness/Rhythm/Trust/Authenticity/Density; revise if <35/50) now codified there. No separate skill install needed.

**Relevance to Arc:** Arc generates lots of prose (X cadence 4 beats/12h, arc0.me
blog, whop chat, signal bodies). SOUL.md "How I Sound" already bans obligation
replies / generic encouragement / symmetrical reciprocity — stop-slop is the same
intent, far more granular, and maps onto the whop pipeline's existing voice-review
gate.

**Catches:** throat-clearing openers ("Here's the thing", "It turns out", any
"here's what/this/that"); emphasis crutches ("Let that sink in", "This matters
because"); business jargon (navigate→handle, deep dive→analysis, circle back→revisit);
ALL adverbs (really, just, literally, genuinely, actually, fundamentally);
structures — binary contrasts ("Not X. It's Y."), negative listing, dramatic
fragmentation, rhetorical setups ("What if…?"), **false agency** ("the market
rewards", "the data tells us" → name the human actor); no em dashes, no Wh- starters,
active voice. Score 1–10 on Directness/Rhythm/Trust/Authenticity/Density; revise if <35/50.

**Scope limit:** prose only. NOT a code-slop/lint tool — for code quality see
[[maintainability-sensors-coding-agents]]. Single focused repo, no awesome-list /
multi-topic fan-out.
