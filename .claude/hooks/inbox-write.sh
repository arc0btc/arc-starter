#!/bin/bash
# .claude/hooks/inbox-write.sh
# On Stop: writes task result_summary + task_id to inbox/<peer>/<ts>.md
# when the completed/failed task was sourced from a known peer agent thread.
#
# Peer detection: source field pattern sensor:aibtc-inbox-sync:thread:<btc_addr>
# Arc's dispatch sets ARC_TASK_ID in env before spawning Claude Code.

cd "$CLAUDE_PROJECT_DIR" || exit 0

TASK_ID="${ARC_TASK_ID}"
[ -z "$TASK_ID" ] || [ "$TASK_ID" = "0" ] && exit 0

DB="$CLAUDE_PROJECT_DIR/db/arc.sqlite"
[ -f "$DB" ] || exit 0

# Query task source, status, result_summary — single pipe-delimited row
IFS='|' read -r TASK_SOURCE TASK_STATUS TASK_SUMMARY <<< "$(sqlite3 "$DB" \
  "SELECT COALESCE(source,''), COALESCE(status,''), COALESCE(result_summary,'') \
   FROM tasks WHERE id = ${TASK_ID};" 2>/dev/null)"

# Only write on terminal states
[[ "$TASK_STATUS" != "completed" && "$TASK_STATUS" != "failed" ]] && exit 0

# Extract peer BTC address from aibtc-inbox-sync thread source
PEER=$(echo "$TASK_SOURCE" | grep -oP '(?<=:thread:)[^\s|]+' 2>/dev/null)

# Fallback: workflow:aibtc-inbox-sync:<peer> pattern
if [ -z "$PEER" ]; then
  PEER=$(echo "$TASK_SOURCE" | grep -oP '(?<=workflow:aibtc-inbox-sync:)[^\s|]+' 2>/dev/null)
fi

[ -z "$PEER" ] && exit 0

TS=$(date -u +"%Y-%m-%dT%H-%MZ")
INBOX_DIR="$CLAUDE_PROJECT_DIR/inbox/$PEER"
mkdir -p "$INBOX_DIR"

cat > "$INBOX_DIR/${TS}.md" <<EOF
---
task_id: ${TASK_ID}
status: ${TASK_STATUS}
ts: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
from: arc
peer: ${PEER}
---

${TASK_SUMMARY}
EOF

exit 0
