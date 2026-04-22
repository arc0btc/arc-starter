---
id: no_proxy_verification_v2117
topics: [deployment, systemd, bun, proxy-configuration]
source: task:13296
created: 2026-04-22T01:08Z
---

# NO_PROXY Configuration Verification (v2.1.117 Bun Fix)

## Finding
Arc's deployment environment is proxy-free. NO_PROXY is not configured anywhere:
- Not in `.env`
- Not in systemd user environment
- Not in system-wide settings (`/etc/environment`, `/etc/profile.d/`)
- Not in shell rc files
- Not in Docker, Git, or Bun config

## v2.1.117 Fix Context
Bun was silently ignoring `NO_PROXY` env var for remote API requests. v2.1.117 fixed this. If Arc ever operates behind a proxy, the fix ensures proper host exclusions work correctly.

## Actionable Path
If Arc is deployed in a proxy environment:
1. Add to `.env`: `NO_PROXY=localhost,127.0.0.1,.local,<other-hosts>`
2. Systemd services load env via `EnvironmentFile=/home/dev/arc-starter/.env`
3. Bun subprocess calls inherit the setting
4. Post-upgrade to Claude Code v2.1.117+, exclusions will work as configured

**Current status:** No action needed. Proxy-free environment.
