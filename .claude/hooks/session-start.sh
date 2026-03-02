#!/bin/bash
# .claude/hooks/session-start.sh
# Validates memory integrity at session start and injects context.
# Fires on SessionStart to verify MEMORY.md is present and report status.

cd "$CLAUDE_PROJECT_DIR" || exit 0

MEMORY_FILE="memory/MEMORY.md"

if [ ! -f "$MEMORY_FILE" ]; then
  echo "WARNING: memory/MEMORY.md is missing" >&2
  exit 0
fi

LINES=$(wc -l < "$MEMORY_FILE")

# Check for uncommitted changes from a prior session
DIRTY=""
if ! git diff --quiet "$MEMORY_FILE" 2>/dev/null; then
  DIRTY=" [uncommitted changes detected]"
fi

# Return memory status as additional context for the session
cat <<EOF
{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Memory: ${LINES} lines${DIRTY}"}}
EOF

exit 0
