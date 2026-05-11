#!/bin/bash
# .claude/hooks/pre-commit-syntax.sh
# Validates TypeScript syntax on staged .ts files before git commit.
# Fires as PostToolUse on 'git commit*' — blocks on syntax errors so Claude can fix in-session.

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Get staged .ts files
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep '\.ts$')

if [ -z "$STAGED_TS" ]; then
  exit 0
fi

# Write staged files to a temp dir to check syntax without unstaging
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

ERRORS=0
for FILE in $STAGED_TS; do
  if [ ! -f "$FILE" ]; then
    continue
  fi
  # bun build --no-bundle checks syntax without producing output
  OUTPUT=$(bun build --no-bundle "$FILE" 2>&1)
  if [ $? -ne 0 ]; then
    echo "TypeScript syntax error in $FILE:"
    echo "$OUTPUT"
    echo ""
    ERRORS=$((ERRORS + 1))
  fi
done

if [ $ERRORS -gt 0 ]; then
  echo "--- Pre-commit syntax guard blocked $ERRORS file(s) ---"
  echo "Fix the errors above, then re-stage and retry the commit."
  echo "If you cannot resolve this in-session, create a follow-up task instead of retrying."
  exit 2
fi

exit 0
