---
name: aibtc-dev-ops
description: Monitor service health via worker-logs and enforce production-grade standards across all aibtcdev repos
updated: 2026-03-05
tags:
  - devops
  - monitoring
  - github
  - aibtcdev
---

# aibtc-dev

Service health monitoring and production-grade enforcement for the AIBTC ecosystem. Queries the centralized `worker-logs` service for error detection and audits repos against a production-grade checklist.

## Repos

Repo list is sourced from `AIBTC_WATCHED_REPOS` in `src/constants.ts` (shared with repo-maintenance, github-mentions, arc-workflows, and github-security-alerts).

**Audited repos** (production-grade checklist):
All repos in `AIBTC_WATCHED_REPOS` — currently 7 repos.

**Log monitoring** (worker-logs API):
`aibtcdev/worker-logs` is queried for error detection via its REST API, but excluded from the production-grade audit (it's infrastructure, not a product repo).

## Production Repo Standard

Not every repo needs every check. Each watched repo has a profile defining what's expected based on its tech stack (TypeScript vs JavaScript, Workers vs non-Workers, etc.). This prevents false positives from applying a one-size-fits-all checklist.

### Automated checks (sensor-enforced)

| Check | Applies when | What to check |
|-------|-------------|---------------|
| TypeScript strict | `typescript: true` | `tsconfig.json` has `strict: true` |
| Tests exist | `tests: true` | `*.test.ts`, `*.spec.ts`, `*.test.js`, or `*.spec.js` files present |
| Release-please | `releasePlease: true` | `.release-please-manifest.json`, `release-please-config.json`, or `.github/workflows/release-please.yml` exists |

### Repo profiles

| Repo | TypeScript | Tests | Workers | Release-please |
|------|-----------|-------|---------|---------------|
| `aibtcdev/landing-page` | yes | yes | yes | no |
| `aibtcdev/skills` | yes | yes | no | yes |
| `aibtcdev/x402-api` | yes | yes | yes | yes |
| `aibtcdev/aibtc-mcp-server` | yes | yes | no | yes |
| `aibtcdev/agent-news` | no | no | yes | no |

Profiles are defined in `sensor.ts` as `REPO_PROFILES`. Update them when repos change tech stack.

### Aspirational (manual review only, not sensor-enforced)

These are good practices to look for during PR review but not worth automated flagging:

- CI runs tests (`.github/workflows/` runs test command)
- Worker-logs binding in wrangler config
- Staging/prod split in wrangler config
- Modern Workers pattern (`export default { fetch }`)
- Hono framework for CF Workers routing
- RPC bindings for inter-worker communication

## Sensor

Dual-cadence sensor (`claimSensorRun("aibtc-dev-ops", 240)`):

- **Log review (every 4h):** Queries `logs.aibtc.com` REST API for errors. Creates P6 task if errors found. Requires `worker-logs/aibtc_api_key` credential (gracefully skips if missing).
- **Repo audit (every 24h):** Runs production-grade checklist against `AIBTC_WATCHED_REPOS` via GitHub API. Creates P7 task if gaps found. Gated by hook-state `lastAuditTimestamp`.

Source keys: `sensor:aibtc-dev-ops-logs`, `sensor:aibtc-dev-ops-audit`.

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
Run production-grade checklist. Single repo (`--repo aibtcdev/landing-page`) or all watched repos. Outputs pass/fail per checklist item.

### `status`
Overview: open issues + open `prod-grade` labeled issues per repo.

## When to Load

Load when: reviewing worker-logs errors flagged by the sensor, running a production-grade audit on aibtcdev repos, or investigating service health regressions. Tasks with subject containing "worker-logs errors" or "production-grade audit" include this skill.

## Credentials

```
arc creds set --service worker-logs --key aibtc_api_key --value <KEY>
arc creds set --service worker-logs --key aibtc_admin_api_key --value <KEY>
```

API key required for `logs` command (data queries use `X-Api-Key` + `X-App-ID`). Admin key required for `apps`, `stats` commands (management queries use `X-Admin-Key`). Audit and status work without either (GitHub API only).
