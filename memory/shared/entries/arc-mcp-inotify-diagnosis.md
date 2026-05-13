---
id: arc-mcp-inotify-diagnosis
topics: [arc-mcp, systemd, inotify, diagnostics]
source: task:13072 (2026-04-19 01:44Z)
created: 2026-04-19T01:44:00Z
---

# Arc-MCP Inotify Watch Warnings — Non-Fatal Diagnosis

## Problem
systemd logs show repeated warnings:
```
arc-mcp.service: Failed to add control inotify watch descriptor for control group ...
arc-mcp.service: Failed to add memory inotify watch descriptor for control group ...
```

## Root Cause
**Not** a traditional inotify watch limit exhaustion. Rather: arc-mcp service in restart loop → each restart attempt causes systemd to try adding cgroup-level inotify watches → these fail with "No space left on device" (cgroup subsystem resource issue, not disk space or traditional inotify limits).

Service starts and runs successfully despite warnings.

## Why the Restart Loop?
arc-mcp.service missing HTTP transport auth key:
```
Error: HTTP transport requires an auth key.
Provide --auth-key FLAG or set credential: 
  arc creds set --service mcp-server --key auth_key --value YOUR_KEY
```

Restart counter: 21,640+ since 2026-04-17 19:17:33.

## Why Inotify Watches Fail?
Systemd attempts to add inotify watches for cgroup monitoring (memory, control subsystems) during each restart. Cgroup subsystem resource limit or transient allocation failure → "No space left on device" (misleading error message — not disk space).

## Mitigation
Configure MCP auth key to stop restart loop:
```
arc creds set --service mcp-server --key auth_key --value <KEY>
systemctl --user restart arc-mcp.service
```

This eliminates restart spam and stops inotify watch failure attempts.

## Assessment
- **Current state (2026-05-13):** RESOLVED. `NRestarts=0`. Service stable since 2026-05-12 22:11:37 MDT (19h+). Auth key configured; restart loop eliminated.
- **v2.1.141 relationship:** v2.1.141 fixed Remote Control MCP connectors failing 401 on worker session token rotation — a separate issue from the restart loop. Restart loop was already resolved by auth_key config before v2.1.141 landed. v2.1.141 is additive: prevents future auth failures mid-session.
- **Action:** None. Monitor for future restarts; if loop resurfaces, re-check auth_key credential.
- **max_user_watches increase:** Not applicable — cgroup watch failures are separate from user-level inotify limits.
