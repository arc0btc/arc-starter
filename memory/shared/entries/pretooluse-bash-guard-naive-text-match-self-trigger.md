---
id: pretooluse-bash-guard-naive-text-match-self-trigger
topics: [claude-code-hooks, security, dispatch-safety, gotcha]
source: task #23031 (research #23029)
created: 2026-07-17
---

# PreToolUse Bash guard hooks match on raw command text, not parsed intent

## What shipped

`.claude/hooks/guard-destructive-bash.sh`, wired via a `Bash` matcher in
`.claude/settings.json`'s `PreToolUse`, blocks destructive patterns Arc's dispatch
subprocess could otherwise run unguarded (dispatch runs with `sandbox.enabled:false`
+ `permissions.defaultMode:bypassPermissions`, and only 4 specific file paths had a
guard before this): `rm -rf`/`-fr`, `git reset --hard`, `git push --force`(-with-lease),
`git clean -f`, unsafe `git checkout .`, `git branch -D`, `git commit --no-verify`/
`--no-gpg-sign`, `mkfs`/`shred`, `dd of=/dev/*`, `chmod -R` on root-level paths.

## GOTCHA: it fires on substrings anywhere in the command string, including inside heredocs

The hook receives `tool_input.command` as one flat string and greps it — it does not
parse shell syntax or distinguish "this text is being executed" from "this text is a
string literal being written to a file." A `git commit -m "$(cat <<'EOF' ... EOF)"`
heredoc whose *commit message body* happens to mention `rm -rf` or `git reset --hard`
(e.g. documenting what the guard blocks) gets blocked exit 2, same as if those
commands were actually invoked. Discovered live while committing this exact hook —
the first commit message draft described the blocked patterns literally and
self-triggered the guard it was adding.

**Practical implication**: when writing commit messages, task summaries, or any
heredoc/multi-line string passed through Bash that documents destructive-command
patterns, paraphrase instead of using the literal command syntax (e.g. "recursive
force-delete" instead of `rm -rf`, "git hard-reset" instead of `git reset --hard`).
This applies to any future denylist-style PreToolUse hook with the same naive
text-match design, not just this one.
