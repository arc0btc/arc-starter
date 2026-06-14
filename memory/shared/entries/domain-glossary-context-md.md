---
id: domain-glossary-context-md
topics: [skills, context, token-efficiency, dispatch]
source: public-skills-repos-analysis-2026-06-14
created: 2026-06-14T08:46:00Z
---

# Domain Glossary Pattern (CONTEXT.md)

**Pattern from**: mattpocock/skills (via tweet 2059319662597611914 research)

## What it is

A per-project `CONTEXT.md` glossary that defines domain jargon in concise terms. Agents read it to decode project-specific shorthand, which reduces token use and enforces consistent naming (variables, files, function names) across sessions.

**Example payoff**: "There's a problem with the materialization cascade" vs. "There's a problem when a lesson inside a section of a course is made 'real' (i.e. given a spot in the file system)" — same meaning, 7× fewer tokens, consistent naming in code.

## How to apply in Arc

For skill domains with recurring jargon (whop, stacks-js, arc-workflows), add a `CONTEXT.md` alongside `SKILL.md`:

```
skills/whop/CONTEXT.md      ← domain glossary
skills/whop/SKILL.md        ← architecture + CLI reference
```

Load in dispatch via task `skills` array only for tasks that need it — same lean-context principle as SKILL.md. Do NOT make it always-loaded.

**Threshold for writing one**: when the same vague term causes repeated re-explanation across tasks in a skill domain, or when dispatch output uses inconsistent naming for the same concept.

## What NOT to put in CONTEXT.md

- Operational rules (→ MEMORY.md)
- Architecture and CLI syntax (→ SKILL.md)
- Task-specific state (→ task description)

Only jargon: short definitions of domain terms specific to the project that would otherwise cost tokens to re-derive.
