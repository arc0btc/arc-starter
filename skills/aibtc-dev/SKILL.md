---
name: aibtc-dev
description: Monitor service health via worker-logs and enforce production-grade standards across all aibtcdev repos
tags:
  - devops
  - monitoring
  - github
  - aibtcdev
---

# aibtc-dev

Service health monitoring and production-grade enforcement for the AIBTC ecosystem. Queries the centralized `worker-logs` service for error detection and audits repos against a production-grade checklist.

## Repos (12)

**Production apps** (Cloudflare Workers, user-facing):
- `aibtcdev/landing-page` — Main app, Next.js on CF Pages
- `aibtcdev/x402-api` — Payment relay (x402 protocol)
- `aibtcdev/aibtc-mcp-server` — MCP server for agent tooling

**Supporting services:**
- `aibtcdev/skills` — Shared skill library (npm)
- `aibtcdev/worker-logs` — Centralized logging service
- `aibtcdev/ai-agent-crew` — Multi-agent orchestration

**Newer / needs modernization:**
- `aibtcdev/agent-news` — aibtc.news (CF Pages Functions, legacy pattern)
- `aibtcdev/aibtc-projects` — Project tracker (CF Pages Functions, legacy pattern)

**Infrastructure & reference:**
- `aibtcdev/bitcoin-ai-agent-crew-frontend` — Frontend companion
- `aibtcdev/agent-tools-ts` — TypeScript agent tooling
- `aibtcdev/communication-tools` — Cross-agent messaging
- `aibtcdev/ai-agent-chrome-extension` — Chrome extension

## Production-Grade Checklist

| # | Item | What to check |
|---|------|---------------|
| 1 | TypeScript strict | `tsconfig.json` has `strict: true` |
| 2 | Tests exist | `*.test.ts` or `*.spec.ts` files present |
| 3 | CI runs tests | `.github/workflows/` runs test command |
| 4 | Worker-logs binding | `wrangler.jsonc` has service binding to worker-logs |
| 5 | Staging/prod split | Separate `[env.staging]` and `[env.production]` in wrangler config |
| 6 | Release-please | `.release-please-manifest.json` or `release-please-config.json` exists; CI runs release/deploy on merge to main where applicable |
| 7 | wrangler.jsonc | Uses `.jsonc` (not `.toml`) for comments |
| 8 | Modern Workers | Uses `export default { fetch }` pattern (not `addEventListener`) |
| 9 | Hono framework | Uses Hono for routing (preferred for CF Workers) |

## Sensor

Dual-cadence sensor (`claimSensorRun("aibtc-dev", 240)`):

- **Log review (every 4h):** Queries `logs.aibtc.com` REST API for errors. Creates P6 task if errors found. Requires `worker-logs/admin_api_key` credential (gracefully skips if missing).
- **Repo audit (every 24h):** Runs production-grade checklist against all 12 repos via GitHub API. Creates P7 task if gaps found. Gated by hook-state `lastAuditTimestamp`.

Source keys: `sensor:aibtc-dev-logs`, `sensor:aibtc-dev-audit`.

## CLI

```
arc skills run --name aibtc-dev -- logs [--app ID] [--level LEVEL] [--since ISO] [--limit N]
arc skills run --name aibtc-dev -- apps
arc skills run --name aibtc-dev -- stats [--app ID] [--days N]
arc skills run --name aibtc-dev -- audit [--repo REPO]
arc skills run --name aibtc-dev -- status
```

### `logs`
Query worker-logs REST API. Omit `--app` for cross-app aggregated errors. Default: `--level ERROR --limit 50`.

### `apps`
List all registered worker-logs apps (requires admin key).

### `stats`
Daily log stats per app or all apps. Default: `--days 7`.

### `audit`
Run production-grade checklist. Single repo (`--repo aibtcdev/landing-page`) or all 12. Outputs pass/fail per checklist item.

### `status`
Overview: open issues + open `prod-grade` labeled issues per repo.

## Graduated Autonomy

| Level | Capability | Status |
|-------|-----------|--------|
| L1 | Audit repos, file GitHub issues | Active |
| L2 | Create PRs to fix gaps | Future |
| L3 | Address PR feedback | Future |
| L4 | Merge + release | Future |

## Credentials

```
arc creds set --service worker-logs --key admin_api_key --value <KEY>
```

Required for `logs`, `apps`, `stats` commands. Audit and status work without it (GitHub API only).
