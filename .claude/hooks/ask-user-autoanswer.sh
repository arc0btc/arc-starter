#!/bin/bash
# .claude/hooks/ask-user-autoanswer.sh
# PreToolUse hook: auto-answers AskUserQuestion during headless dispatch.
# Fires via PreToolUse hook scoped to AskUserQuestion (settings.json).
#
# Returns permissionDecision:allow + updatedInput.answer so AskUserQuestion
# resolves immediately instead of blocking on user input.
#
# Safe defaults for dispatch context (task is already authorized):
#   - Proceed/yes for confirmations
#   - sonnet for model selection
#   - First option for choice prompts
#   - No escalation (proceed autonomously)

INPUT=$(cat)
QUESTION=$(echo "$INPUT" | jq -r '.tool_input.question // .question // ""' 2>/dev/null)
Q=$(echo "$QUESTION" | tr '[:upper:]' '[:lower:]')

# Default — covers most procedural confirmations in dispatch context
ANSWER="yes, proceed"

# Model selection → prefer sonnet as the sensible dispatch default
if echo "$Q" | grep -qE 'which model|what model|select.*model|choose.*model'; then
  ANSWER="sonnet"

# Option/choice selection → pick first available option
elif echo "$Q" | grep -qE '(which|what) (option|choice|approach|path)|choose (between|from|one)|(select|pick) (an?|one)'; then
  FIRST=$(echo "$INPUT" | jq -r '.tool_input.options[0]? // ""' 2>/dev/null)
  ANSWER="${FIRST:-proceed with default}"

# Escalation prevention — dispatch runs headlessly, no human-hold
elif echo "$Q" | grep -qE 'should i (escalate|block|pause|stop|wait|ask.*human|request.*help)|do you want me to (escalate|stop|pause)'; then
  ANSWER="no, proceed autonomously with safe defaults"

# Commit/version control confirmation
elif echo "$Q" | grep -qE 'should i commit|do you want.*commit|commit.*changes|stage.*changes'; then
  ANSWER="yes, commit"

# Task lifecycle operations
elif echo "$Q" | grep -qE 'close.*task|complete.*task|fail.*task|mark.*(complete|done|fail)'; then
  ANSWER="yes"

# Follow-up task creation
elif echo "$Q" | grep -qE 'create.*(follow.?up|task|subtask)|add.*task|should i (add|create) a task'; then
  ANSWER="yes, create it"

# Generic yes/no
elif echo "$Q" | grep -qE '\byes\b.*or.*\bno\b|\bno\b.*or.*\byes\b|\(y\/n\)|\(yes\/no\)|are you sure|do you want to proceed'; then
  ANSWER="yes"
fi

jq -n --arg q "$QUESTION" --arg a "$ANSWER" \
  '{"permissionDecision": "allow", "updatedInput": {"question": $q, "answer": $a}}'
