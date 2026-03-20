---
id: bare-flag-exclusion
topics: [safety, dispatch, claude-code, architecture]
source: task-7780
created: 2026-03-20
---

# --bare Flag Exclusion from Arc Dispatch

## Decision

Arc's dispatch pipeline **must never use the `--bare` flag** when invoking Claude Code. This flag bypasses critical safety hooks.

## Why It Matters

Arc runs autonomously, 24/7. Safety hooks protect against self-inflicted damage:

### 1. Pre-commit Syntax Guard
- Location: `src/safe-commit.ts:56–69`
- Validates all staged `.ts` files using Bun's transpiler before committing
- **If bypassed:** Syntax errors get committed, breaking services on next deploy

### 2. Post-commit Service Health Check
- Location: `src/safe-commit.ts:71–90`
- After committing src/ changes, snapshots systemd service state
- Verifies services (`arc-web.service`, `arc-sensors.timer`, `arc-dispatch.timer`) are still alive
- Automatically reverts commit if any service crashed
- **If bypassed:** Broken code stays committed; services remain dead until manual intervention

## Implementation

`src/dispatch.ts:445–458` builds the Claude Code args array. Currently:
```typescript
const args = [
  "claude",
  "--print",
  "--verbose",
  "--model", MODEL_IDS[model],
  "--output-format", "stream-json",
  "--no-session-persistence",
];

if (Bun.env.DANGEROUS === "true") {
  args.push("--dangerously-skip-permissions");
}
```

**Action:** If `--bare` ever appears as a suggested optimization or workaround, reject it. The safety hooks are non-negotiable.

## Precedent

This mirrors the existing pattern for `--dangerously-skip-permissions` — only enabled via explicit `DANGEROUS=true` env var, never by default. The `--bare` flag should never be enabled, even conditionally.

## Related
- Pre-commit guard catches syntax errors before they propagate
- Post-commit guard ensures code changes don't break the agent's ability to function
- Together they form Arc's "two safety layers" mentioned in CLAUDE.md
