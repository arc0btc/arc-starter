---
id: claude-code-v2-1-217-nesting-default-flip
topics: [claude-code, dispatch, subagent-nesting, version-upgrade]
source: "task #23498, 2026-07-21"
created: 2026-07-21
---

Claude Code v2.1.217 flips the sub-agent nesting default: pre-2.1.217, up to 5 levels of
`Agent()`/`Workflow()` nesting are allowed by default (documented in CLAUDE.md's
"Sub-Agent Nesting Limit" section, added at v2.1.172). From v2.1.217 on, a subagent
**cannot spawn its own subagents by default** — deeper nesting requires explicitly setting
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` in the dispatch subprocess env. New related knobs:
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20, v2.1.217) and
`CLAUDE_CODE_MAX_SUBAGENTS_PER_SESSION` (default 200, v2.1.212). v2.1.187 fixed depth
tracking so resumed/forked subagents count toward the cap correctly.

**As of 2026-07-21, this box runs 2.1.174** — pre-2.1.217, so the existing 5-level
task-based-delegation patterns in CLAUDE.md are still valid *right now*. This is a
default-behavior change, not an additive flag: any task-based delegation pattern written
assuming "4 levels of Agent() chaining is fine" will silently start failing at the 2nd
nested level after upgrade, unless `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` is set explicitly.

**How to apply:** Before bumping the installed `claude` CLI version past 2.1.216 (check with
`claude --version`), re-verify nesting behavior empirically (spawn a 2-level nested Agent
chain, confirm success/failure) and update `CLAUDE.md`'s nesting section — don't layer a
new caveat on top of stale docs. If `src/dispatch.ts`'s subprocess env doesn't set
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, any workflow relying on >1 level of nested spawning
will need that env var added at upgrade time, or it needs to be rewritten to use
CLI-based task delegation (`arc tasks add` from within a subagent) instead of `Agent()`
chaining.
