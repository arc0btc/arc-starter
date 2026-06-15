#!/bin/bash
# .claude/hooks/model-gate.sh
# PreToolUse hook: blocks Bash and Agent tool calls that would spawn a claude
# subprocess or sub-agent with a more expensive model tier than the current
# dispatch session. Prevents cost escalation (e.g., a haiku task spawning opus).
#
# Only active inside a dispatch context (ARC_DISPATCH_MODEL is set).
# Exit 2 blocks the operation and surfaces the message to the Claude session.

INPUT=$(cat)

# Not in a dispatch context — no gate needed
if [ -z "$ARC_DISPATCH_MODEL" ]; then
  exit 0
fi

# Map full model ID to numeric tier (higher = more expensive)
model_tier() {
  case "$1" in
    claude-haiku*)  echo 1 ;;
    claude-sonnet*) echo 2 ;;
    claude-opus*)   echo 3 ;;
    *)              echo 0 ;;  # unknown — allow through
  esac
}

tier_name() {
  case "$1" in
    1) echo "haiku" ;;
    2) echo "sonnet" ;;
    3) echo "opus" ;;
    *) echo "unknown" ;;
  esac
}

CURRENT_TIER=$(model_tier "$ARC_DISPATCH_MODEL")

block_escalation() {
  local REQUESTED_MODEL="$1"
  local REQUESTED_TIER
  REQUESTED_TIER=$(model_tier "$REQUESTED_MODEL")

  # Unknown model or no tier — allow through
  if [ "$REQUESTED_TIER" -eq 0 ] || [ "$CURRENT_TIER" -eq 0 ]; then
    exit 0
  fi

  if [ "$REQUESTED_TIER" -gt "$CURRENT_TIER" ]; then
    local CURRENT_NAME
    CURRENT_NAME=$(tier_name "$CURRENT_TIER")
    local REQUESTED_NAME
    REQUESTED_NAME=$(tier_name "$REQUESTED_TIER")
    echo "BLOCKED by model-gate: dispatch tier is ${CURRENT_NAME} (${ARC_DISPATCH_MODEL}), but sub-process requests ${REQUESTED_NAME} (${REQUESTED_MODEL}). To use a higher-cost model, create a new task: arc tasks add --model ${REQUESTED_NAME} ..." >&2
    exit 2
  fi
}

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)

case "$TOOL_NAME" in
  Bash)
    COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""' 2>/dev/null)
    # Only gate explicit claude binary invocations
    if ! echo "$COMMAND" | grep -qP '(^|\s)claude(\s|$)'; then
      exit 0
    fi
    # Extract --model <value> (first occurrence)
    REQUESTED_MODEL=$(echo "$COMMAND" | grep -oP '(?<=--model\s)\S+' | head -1)
    if [ -z "$REQUESTED_MODEL" ]; then
      exit 0  # No explicit model — allow (inherits caller's model)
    fi
    block_escalation "$REQUESTED_MODEL"
    ;;

  Agent)
    REQUESTED_MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // ""' 2>/dev/null)
    if [ -z "$REQUESTED_MODEL" ] || [ "$REQUESTED_MODEL" = "null" ]; then
      exit 0  # No model override — inherits parent, allowed
    fi
    block_escalation "$REQUESTED_MODEL"
    ;;
esac

exit 0
