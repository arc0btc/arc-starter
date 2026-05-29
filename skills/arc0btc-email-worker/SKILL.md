---
name: arc0btc-email-worker
description: Manage arc0btc/arc-email-worker — Cloudflare Worker + Durable Object email store
tags:
  - email
  - cloudflare
  - worker
  - durable-object
disallowed-tools: [Edit, Write, NotebookEdit]
---

# arc0btc-email-worker

Cloudflare Worker + Durable Object email store. Repo: `arc0btc/arc-email-worker`.

## Architecture

- **EmailStoreDO** — singleton Durable Object via `idFromName('arc-email-store')`. Holds all emails in SQLite via `SqlStorage.exec()`.
- Hot indexes: `(folder)`, `(received_at DESC)`, `(folder, is_read)`.
- All `/api/*` routes gated by `X-Admin-Key` middleware — auth runs before any logic.
- DO `SqlStorage.exec()` handles multi-statement; do NOT split unnecessarily.

## Workflow

```
gh + git + wrangler

1. gh issue view <N>                          # read task context
2. git checkout -b fix/<slug>                 # branch off main
3. <implement changes>
4. wrangler deploy --dry-run                  # verify build locally
5. git commit -m "type(scope): message"
6. gh pr create --title "..." --body "Closes #N"
7. CI deploys via wrangler deploy on merge
```

Prefer commit-and-push so CI/CD deploys. Use `wrangler deploy` only when CI is unavailable or for urgent hotfixes.

## Schema-Health Pattern (issue #2)

Admin-gated `GET /api/schema-health` endpoint:
1. Diff `sqlite_master` against `EXPECTED_INDEXES` set — report missing/extra indexes.
2. Run `EXPLAIN QUERY PLAN` on each hot query — flag `SCAN` or `USE TEMP B-TREE`.

**Prior art**: `agentslovebitcoin.com` worker repo, ALB PR #21 — fetch via `gh pr view 21 --repo <alb-repo>` when implementing. Arc's local `alb` skill does NOT contain this pattern.

## Caching Safety Rule

`/api/stats` is admin-gated. If wrapping with `caches.default`:
- Cache key **must** include a hash of the admin header, OR
- Cache wrap sits **inside** the handler **after** auth.

Never cache before auth — exposes admin-only data to unauthenticated callers (admin-key leak class).

## CLI Reference

```
wrangler deploy --dry-run                    # verify build, no push
wrangler deploy                              # deploy to production
wrangler tail                                # live log stream
gh pr list --repo arc0btc/arc-email-worker   # open PRs
gh issue list --repo arc0btc/arc-email-worker
```

## When to Load

Load when: implementing schema-health endpoint (issue #2), adding/modifying `/api/*` routes, debugging DO storage issues, reviewing PRs against this repo.
