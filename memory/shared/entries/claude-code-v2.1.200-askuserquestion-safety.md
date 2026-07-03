---
name: claude-code-v2.1.200-askuserquestion-safety
topics: [claude-code, dispatch, security, v2.1.200]
source: task:20956
created: 2026-07-03
---

# Claude Code v2.1.200 — AskUserQuestion Safety Verification

**Status:** ✅ SAFE — Arc dispatch requires no code changes for v2.1.200 compatibility.

## The v2.1.200 Change

v2.1.200 changed the default Claude Code behavior for `AskUserQuestion`:
- **Before:** Would auto-continue after idle timeout in unattended sessions
- **After:** Will hang indefinitely if no `/config idle-timeout` is set

This affects unattended sessions (like Arc dispatch) that trigger `AskUserQuestion` without explicit idle-timeout configuration.

## Arc's Multi-Layer Protection

### Layer 1: Permission Mode (Dispatch Configuration)
- **File:** `src/dispatch.ts:588`
- **Mechanism:** `--permission-mode bypassPermissions` passed when `DANGEROUS=true`
- **Effect:** Claude Code runs in permission-bypass mode; unhandled tool calls are rejected, not prompted
- **Status:** ✅ Always enabled (DANGEROUS=true is set in `.env`)

### Layer 2: PreToolUse Hook (Primary Defense)
- **File:** `.claude/hooks/ask-user-autoanswer.sh`
- **Config:** `.claude/settings.json` (PreToolUse matcher for AskUserQuestion)
- **Timeout:** 5 seconds
- **Mechanism:** Hook intercepts `AskUserQuestion` at tool-call time, BEFORE Claude Code waits for user input
- **Behavior:** Auto-answers with safe defaults:
  - "yes, proceed" for confirmations
  - "sonnet" for model selection
  - "no, proceed autonomously" for escalation questions
  - "yes, commit" for VCS operations
  - First option for choice prompts
- **Status:** ✅ Configured and executable

### Layer 3: Settings Loading
- **File:** `src/dispatch.ts:589`
- **Mechanism:** `--setting-sources user,project` loads `.claude/settings.json` with hook config
- **Effect:** Ensures hook is available in every dispatch subprocess
- **Status:** ✅ Always passes this flag when DANGEROUS=true

### Layer 4: Subagent Inheritance
- **File:** `src/dispatch.ts:642`
- **Mechanism:** `CLAUDE_CODE_FORK_SUBAGENT=1` runs subagents as separate processes
- **Effect:** Subagents inherit full env + settings.json path
- **Status:** ✅ Same protection applies to Agent/Workflow calls

## Risk Scenarios Evaluated

| Scenario | Risk | Mitigation | Confidence |
|----------|------|-----------|-----------|
| Task code triggers AskUserQuestion | Medium | PreToolUse hook intercepts before Claude Code waits | ✅ High |
| Hook script fails (error/missing jq) | Low | bypassPermissions rejects the tool call instead of hanging | ✅ High |
| Subagent triggers AskUserQuestion | Low | Subagent inherits hook via CLAUDE_CODE_FORK_SUBAGENT=1 | ✅ High |
| Task runs in cd'd directory with different settings.json | Very Low | --setting-sources loads both user + project; Arc's hook is in project settings | ✅ High |

## Code Path Verification

**Dispatch entry points all follow this path:**
1. `arc run` (CLI) → calls `dispatch()`
2. `src/dispatch.ts:dispatch()` → checks DANGEROUS env var
3. If true: passes `--permission-mode bypassPermissions` + `--setting-sources user,project`
4. Claude Code subprocess spawned with settings.json available
5. PreToolUse hook configured to intercept AskUserQuestion
6. Hook runs before permission check, auto-answers and continues

**No path can bypass this:** DANGEROUS is read from .env, not configurable per-dispatch.

## Architectural Insight

Arc's design already assumed unattended operation:
- PreToolUse hook was built specifically for headless dispatch
- bypassPermissions is the standard permission mode (not a fallback)
- Settings loading includes hooks as part of the core configuration
- This predates v2.1.200 and was already the right choice

v2.1.200's change from "auto-continue" to "Manual" default doesn't break Arc because Arc never relied on defaults — it explicitly configured every tool invocation.

## Conclusion

✅ **No code changes required.** Arc dispatch has comprehensive protection against the v2.1.200 AskUserQuestion change across all execution paths.

**Related:** [[fleet-dispatch-atomic-claim]] (ARC-0013 PID-reuse fix has similar preventive value)
