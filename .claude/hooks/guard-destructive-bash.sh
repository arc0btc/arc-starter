#!/bin/bash
# .claude/hooks/guard-destructive-bash.sh
# PreToolUse hook: blocks Bash commands matching a denylist of destructive
# operations (recursive deletes, hard resets, force pushes, permission
# bypasses, credential/lock-file removal). This is a backstop for
# sandbox.enabled:false + permissions.defaultMode:bypassPermissions —
# without it, a malformed or adversarially-injected Bash command is only
# intercepted if it happens to touch one of the four paths guarded by
# guard-sensitive-writes.sh.
#
# Exit 2 blocks the operation and surfaces the message to the Claude session.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)

block() {
  echo "BLOCKED: command matched destructive-command guard ($1). If this is genuinely needed, ask whoabuddy to run it manually or approve explicitly." >&2
  exit 2
}

# rm -rf / -fr / -r -f (any order/spacing) targeting more than a tmp/build dir
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)rm\s+(-[a-zA-Z]*[rf][a-zA-Z]*[rf]?[a-zA-Z]*|--recursive|--force)'; then
  block "rm -rf/-fr"
fi

# git reset --hard
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+reset\s+.*--hard'; then
  block "git reset --hard"
fi

# git push --force / -f / --force-with-lease
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+push\s+.*(--force([^-]|$)|--force-with-lease|\s-f(\s|$))'; then
  block "git push --force"
fi

# git clean -f / -fd / -fx / -fdx
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+clean\s+.*-[a-zA-Z]*f'; then
  block "git clean -f"
fi

# git checkout -- . / git checkout . (discards working tree changes)
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+checkout\s+(--\s+)?\.\s*$'; then
  block "git checkout . (discards uncommitted changes)"
fi

# git branch -D (force delete branch)
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+branch\s+.*-D(\s|$)'; then
  block "git branch -D"
fi

# skipping hooks / bypassing signing
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)git\s+commit\s+.*(--no-verify|--no-gpg-sign)'; then
  block "git commit --no-verify/--no-gpg-sign"
fi

# dd to a block device, mkfs, shred
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)(mkfs|shred)(\s|$)'; then
  block "mkfs/shred"
fi
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)dd\s+.*of=/dev/'; then
  block "dd to block device"
fi

# chmod/chown -R on root-ish paths
if echo "$COMMAND" | grep -qE '(^|[;&|]|\s)chmod\s+.*-R\s+.*\s(/|/home|/etc|/usr)(\s|$)'; then
  block "chmod -R on root-level path"
fi

exit 0
