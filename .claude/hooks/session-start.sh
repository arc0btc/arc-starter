#!/bin/bash
# .claude/hooks/session-start.sh
# Validates memory integrity at session start and injects context.
# Fires on SessionStart to verify MEMORY.md is present and report status.

cd "$CLAUDE_PROJECT_DIR" || exit 0

MEMORY_FILE="memory/MEMORY.md"
RELOAD_FLAG="db/skills-pending-reload.flag"

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

# Build session title from task context if available
SESSION_TITLE=""
if [ -n "$ARC_TASK_ID" ] && [ -n "$ARC_TASK_SUBJECT" ]; then
  SESSION_TITLE="task #${ARC_TASK_ID}: ${ARC_TASK_SUBJECT}"
fi

# Check for pending skill reload flag
RELOAD_SKILLS="false"
if [ -f "$RELOAD_FLAG" ]; then
  RELOAD_SKILLS="true"
  rm -f "$RELOAD_FLAG"
fi

# Return memory status and session title as additional context for the session
if [ -n "$SESSION_TITLE" ]; then
  cat <<EOF
{"reloadSkills": ${RELOAD_SKILLS}, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Memory: ${LINES} lines${DIRTY}", "sessionTitle": "${SESSION_TITLE}"}}
EOF
else
  cat <<EOF
{"reloadSkills": ${RELOAD_SKILLS}, "hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "Memory: ${LINES} lines${DIRTY}"}}
EOF
fi

exit 0
