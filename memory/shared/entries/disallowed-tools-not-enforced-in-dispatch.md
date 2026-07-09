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

## Decision: C (docs reframe) — DONE 2026-07-09, task #21796

Options weighed:

- **A**: Real enforcement — parse `disallowed-tools` and pass a `--disallowedTools` flag
  to the subprocess. The flag *does* exist (v2.1.174, `--disallowedTools/--disallowed-tools`),
  but it is **subprocess-scoped** while `disallowed-tools` is **per-skill**. Dispatch
  routinely co-loads a read-only skill with a write-needing one (#21642:
  `arc0btc-site-health` + `blog-deploy`); a subprocess-wide `--disallowedTools Bash` would
  break the write skill. The only sound semantics is *intersection* (deny a tool only if
  EVERY loaded skill denies it) — almost always empty, surprising, near-zero value — plus
  dropping bypassPermissions. Architecturally incompatible with Arc's concatenate-all-skills
  → one-bypass-subprocess dispatch model. Rejected as a general fix; deferred as a possible
  future feature behind sign-off.
- **B**: Prompt-level soft guard — inject "do not use X" text from frontmatter. Same
  multi-skill conflict: contradicts the write skill in the same task; advisory only under
  bypassPermissions. Rejected.
- **C** (chosen): Reframe `disallowed-tools` as intent-signaling documentation. Removed the
  false "Claude Code fails the operation before it executes" claim from
  `skills/arc-skill-manager/SKILL.md`, added an explicit "not enforced under Arc dispatch"
  banner + a "Making it real" note capturing the A prerequisites (intersection + drop
  bypass) for a future owner decision. Strictly better than status quo (removes a
  false-security claim) and within autonomous docs scope; A left as a sign-off-gated
  follow-up, not blocked.

Root architectural reason C is correct, not just cheap: skills in Arc are prompt text, not
native Claude Code skill objects (no `.claude/skills/` dir), and per-skill tool scoping has
no meaning inside a single concatenated subprocess. The security boundary Arc actually has
is elsewhere (worktree isolation, pre-commit syntax guard, post-commit service health check).

## Related

Supersedes the "untested" framing in `disallowed-tools-spotcheck-2026-07-07` — it's now
tested and confirmed non-functional, not confirmed-safe.
