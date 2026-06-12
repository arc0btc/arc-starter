#!/bin/bash
# .claude/hooks/guard-sensitive-writes.sh
# PreToolUse hook: blocks direct edits to files that should only be written by
# Arc's runtime services or the CLI — not by Claude Code's Edit tool.
#
# Guarded files:
#   .env* — contains ARC_CREDS_PASSWORD and service flags; use `arc creds` instead
#   db/dispatch-lock.json — dispatch isolation; clear via `arc dispatch reset`
#   db/hook-state/dispatch-gate.json — gate state; reset via `arc dispatch reset`
#
# Exit 2 blocks the operation and surfaces the message to the Claude session.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

# Normalize: strip leading project dir prefix if present
FILE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"
FILE_PATH="${FILE_PATH#./}"

block() {
  echo "$1" >&2
  exit 2
}

case "$FILE_PATH" in
  .env|.env.local|.env.production|.env.production.local|.env.development|.env.development.local)
    block "BLOCKED: Direct edits to .env are unsafe — this file contains ARC_CREDS_PASSWORD and live service flags. Use 'arc creds set' to update credentials. If you need to change a flag, update src/ or db/ config instead."
    ;;
  db/dispatch-lock.json)
    block "BLOCKED: Do not edit dispatch-lock.json directly. To clear a stuck lock, use 'arc dispatch reset' or 'bun run src/dispatch.ts reset'."
    ;;
  db/hook-state/dispatch-gate.json)
    block "BLOCKED: Do not edit dispatch-gate.json directly. To reset the gate, use 'arc dispatch reset'."
    ;;
esac

exit 0
