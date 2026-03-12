#!/bin/bash
# .claude/hooks/memory-save.sh
# Persists memory/MEMORY.md to git before context compaction or session end.
# Used by PreCompact and Stop hooks to prevent memory loss.

cd "$CLAUDE_PROJECT_DIR" || exit 0

MEMORY_FILE="memory/MEMORY.md"

# Nothing to do if file doesn't exist
[ -f "$MEMORY_FILE" ] || exit 0

# Read event info from stdin
INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)

# Check for uncommitted memory changes (staged or unstaged)
if git diff --quiet "$MEMORY_FILE" 2>/dev/null && \
   git diff --cached --quiet "$MEMORY_FILE" 2>/dev/null; then
  exit 0
fi

# Stage and commit
git add "$MEMORY_FILE"
git commit -m "chore(memory): auto-persist on ${EVENT}" 2>/dev/null

# Sync to Claude Code's auto-memory directory so interactive sessions see current state.
# Path formula: ~/.claude/projects/<project-path-with-slashes-as-dashes>/memory/
AUTO_MEMORY_DIR="$HOME/.claude/projects/$(echo "$CLAUDE_PROJECT_DIR" | sed 's|/|-|g')/memory"
if [ -d "$AUTO_MEMORY_DIR" ]; then
  for f in MEMORY.md archive.md patterns.md; do
    [ -f "memory/$f" ] && cp "memory/$f" "$AUTO_MEMORY_DIR/$f"
  done
fi

exit 0
