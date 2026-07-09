---
id: disallowed-tools-not-enforced-in-dispatch
topics: [dispatch, skills, security, disallowed-tools]
source: task:21790
created: 2026-07-09
---

## Finding

`disallowed-tools` frontmatter in `SKILL.md` files (added 2026-07-05 to 14 skills, per
`skills/arc-skill-manager/SKILL.md`) has **no enforcement path in Arc's own dispatch
loop**. Confirmed empirically via task #21642 (2026-07-08): `arc0btc-site-health`
declares `disallowed-tools: [Edit, Write, NotebookEdit, Bash]`, yet the dispatch loaded
it alongside `blog-deploy` and used Bash/Edit/Write freely to patch `sensor.ts`/`cli.ts`
— no error, no block, task completed normally.

Root cause, two independent reasons either of which alone would defeat it:

1. **`resolveSkillContext()` (`src/dispatch.ts:245-253`) just concatenates raw SKILL.md
   text into the prompt.** It never parses the `disallowed-tools:` field. Skills loaded
   this way are plain context, not Claude Code's native skill objects — there's no
   `.claude/skills/` directory in this repo, so nothing ever registers them as skills
   Claude Code's own permission system would recognize.
2. **Dispatch always launches with `--permission-mode bypassPermissions` +
   `--allow-dangerously-skip-permissions`** (`src/dispatch.ts:587-588`). Even if
   `disallowed-tools` were wired through natively, bypass mode skips all tool
   permission checks entirely.

So `disallowed-tools` in these 14 skills is documentation of intent only — it does not
currently restrict what a dispatched session can do. Any task that loads one of these
skills alongside a second skill needing Bash/Edit/Write (as #21642 did) will use those
tools without friction, silently, because there was never a gate to fail loudly against.

## Why this matters

This is a false sense of security: `arc-skill-manager/SKILL.md` documents
`disallowed-tools` as "Claude Code fails the operation before it executes — better than
a silent write." That claim is false under Arc's own dispatch config. Anyone (including
future-Arc) auditing these 14 "read-only" skills and trusting the frontmatter would be
wrong.

## Fix options (not yet decided, needs owner sign-off)

- **A**: Real enforcement — parse `disallowed-tools` in `resolveSkillContext()` /
  `runDispatchCycle()` and pass an actual `--disallowedTools` flag to the Claude Code
  subprocess (needs checking whether v2.1.x supports a CLI flag for this, since
  bypassPermissions may still override it — needs verification).
- **B**: Prompt-level soft guard — inject explicit "do not use X tool" instruction text
  derived from the frontmatter (weaker, LLM-followed not enforced, but works under
  bypassPermissions).
- **C**: Documentation fix only — remove the "fails before executes" claim from
  `arc-skill-manager/SKILL.md`, reframe `disallowed-tools` as intent-signaling for
  human/agent readers, not a technical control.

## Related

Supersedes the "untested" framing in `disallowed-tools-spotcheck-2026-07-07` — it's now
tested and confirmed non-functional, not confirmed-safe.
