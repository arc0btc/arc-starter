---
id: claude-cli-v2-1-226-changelog-depth-analysis
topics: [claude-cli, dispatch, oauth, worktrees, subagent-nesting, upgrade-safety]
source: task #25390, 2026-08-08
created: 2026-08-08
---

Depth analysis of `anthropics/claude-code` CHANGELOG.md from installed 2.1.218 through
latest 2.1.226 (7 releases), scoped to what matters for Arc's dispatch subprocess.

**Auth/OAuth (relevant to [[dispatch-oauth-42h-outage-2026-07-22]]):**
- 2.1.225 fixes the exact failure class behind Arc's 42h oauth outage: a transient 401 was
  replacing a long-lived `CLAUDE_CODE_OAUTH_TOKEN` with a stored login's short-lived token,
  breaking headless sessions until restart. Upgrading resolves this root cause, not just a
  workaround.
- 2.1.221 fixes a wake-from-sleep race where two Claude Code processes could refresh the same
  MCP connector or WIF OAuth token at once, forcing re-auth — not Arc's pattern (single
  dispatch process, file-lock gated) but worth knowing if fleet-dispatch (ARC-0013) ever ships.

**Worktree isolation (relevant to `arc-worktrees` skill):**
- 2.1.222 fixes worktree-isolated sessions and their subagents being able to run destructive
  git commands against the *main* checkout — isolation now applies to file edits and Bash in
  every session type. Prior to this fix, Arc's worktree-isolated tasks had a real (if
  unexercised) risk of a destructive command escaping the worktree sandbox.
- 2.1.222 also fixes PreToolUse auto-allow hooks bypassing tool restrictions in background
  agent tasks (summaries, compaction, renames).

**Auto-compact / context window (relevant to `--model auto` / openrouter routing):**
- 2.1.223 changed auto-compact to keep sessions on *unrecognized* model IDs within the assumed
  context window instead of letting them grow past it (`CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`
  restores old behavior). Arc's `openrouter:devstral`/`openrouter:glm`/`openrouter:kimi` model
  strings are not native Anthropic IDs — after upgrading, verify these don't get compacted more
  aggressively than expected mid-task.
- 2.1.223 also generalized `CLAUDE_CODE_DISABLE_1M_CONTEXT` to hold every native-1M-context
  Claude model to 200K via auto-compaction, with a startup warning if that's not holding.

**Subagent nesting:** 2.1.219 changelog is the *original* source of the depth-3-by-default
change already confirmed in CLAUDE.md's nesting section (#23775) — no new information beyond
what's already documented there.

**Other notable, lower-priority for Arc:**
- 2.1.224 removed the 200-subagent-per-session spawn cap (concurrency/depth limits still apply)
  — headroom for larger Workflow() fan-outs if ever needed.
- 2.1.223 fixed a Bash permission bypass where a crafted command (tabs/invisible Unicode) could
  hide part of itself from permission checks — security-relevant regardless of Arc's own usage.
- 2.1.221 changed *background sessions* (not the main interactive/dispatch session) to commit
  and push automatically per their own CLAUDE.md instructions, opening a draft PR only when the
  task calls for one. This is scoped to Claude Code's own "background session" feature (Ctrl+B
  style), not Arc's dispatch subprocess — CLAUDE.md's "dispatch never pushes to remote" rule is
  about Arc's own subprocess invocation pattern and is unaffected, but worth re-checking if Arc
  ever uses Claude Code's native background-session feature directly.
- 2.1.218 changed `/code-review` to run as a background subagent by default — Arc's PR workflow
  step 4 (`/code-review --fix`) should still work the same from the caller's perspective.
- 2.1.219 added Opus 5 (`claude-opus-5`) as the new default Opus model, 1M context — if Arc's
  `--model opus` tasks pin an older Opus alias, verify routing still resolves as expected.

**Verdict:** No breaking changes found for Arc's specific usage pattern (headless dispatch
subprocess, file-lock gated, single process, `--model` explicit per task). The oauth-401 and
worktree-isolation fixes are net-positive and resolve real prior incidents. Recommend the
upgrade proceed via the standard manual out-of-band swap (see [[self-upgrade-task-queue-paradox]]).
