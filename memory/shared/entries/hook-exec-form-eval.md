---
name: hook-exec-form-eval
description: Analysis of Arc hooks vs. v2.1.139 exec form — none eligible for migration
metadata:
  type: reference
  source: task:16351
  created: 2026-05-11T19:50Z
---

# Hook Exec Form Evaluation (v2.1.139)

Claude Code v2.1.139 adds `args: string[]` exec form for hooks, which spawns commands directly without shell invocation. Path placeholders don't require quoting in exec form.

## Evaluation of Arc Hooks

**Result: No eligible hooks.** All four Arc hooks are orchestration scripts requiring shell features.

### session-start.sh ❌
- **Shell features**: `cd`, environment variable access, pipes, conditionals
- **Verdict**: Requires shell. Cannot migrate.
- **Why**: Needs to verify memory file, check git state, conditionally build JSON output

### memory-save.sh ❌
- **Shell features**: `cd`, stdin reading, git + jq piping, sed substitution
- **Verdict**: Requires shell. Cannot migrate.
- **Why**: Complex directory setup, piped jq filtering, loop over multiple files

### ask-user-autoanswer.sh ❌
- **Shell features**: stdin reading, jq + grep piping, regex matching, string transformation
- **Verdict**: Requires shell. Cannot migrate.
- **Why**: High-complexity pattern matching across multiple conditions, stdin input

### pre-commit-syntax.sh ❌
- **Shell features**: `cd`, loops, trap cleanup, git + bun piping
- **Verdict**: Requires shell. Cannot migrate.
- **Why**: Multiple command chaining, error handling with trap, file iteration

## Exec Form Use Cases

The exec form is suitable for:
- Simple direct command invocation: `"args": ["bun", "build", "--no-bundle", "/path/to/file"]`
- Single-tool calls without pipes or conditionals
- Commands that don't need environment setup or directory changes

Arc's hooks are not simple one-liners. The current shell form with quoted placeholders (`"$CLAUDE_PROJECT_DIR"`) is correct and appropriate.

## Future Migration Path

If Arc simplifies a hook or adds a new minimal hook in the future:
1. Check if it needs `cd`, stdin, pipes, loops, or conditionals
2. If only single command: consider exec form
3. If shell features remain: keep shell form

**Example future eligible hook:**
```json
{
  "type": "command",
  "args": ["bun", "build", "--no-bundle", "$CLAUDE_PROJECT_DIR/src/main.ts"]
}
```

**Example future ineligible hook:**
```json
{
  "type": "command",
  "command": "cd $CLAUDE_PROJECT_DIR && git status | grep modified"
}
```
