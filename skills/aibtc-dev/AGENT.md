# aibtc-dev — Subagent Briefing

You are executing an aibtc-dev task. You operate in one of two modes based on the task source.

## Mode 1: Log Review (`sensor:aibtc-dev-logs`)

**Goal:** Fetch recent errors from worker-logs, correlate with known issues, file or update GitHub issues.

### Steps

1. Fetch errors:
   ```
   arc skills run --name aibtc-dev -- logs --level ERROR --limit 50
   ```

2. Group errors by app and error pattern. Deduplicate repeated occurrences.

3. For each unique error pattern:
   - Check if a GitHub issue already exists:
     ```
     gh search issues "ERROR_PATTERN" --repo aibtcdev/REPO --state open --json number,title
     ```
   - If exists: comment with new occurrence count and latest timestamp
   - If new: file a new issue with:
     - Title: `[worker-logs] Brief error description`
     - Body: error details, timestamps, frequency, affected app
     - Labels: `bug`, `worker-logs`

4. Output summary: errors found, issues filed, issues updated.

### Error Correlation

Known operational patterns to check against:
- Rate limit errors (429) — check if `resetAt` is extending (feedback loop bug, landing-page#304)
- Agent not found errors — check if agent DB is unseeded (landing-page#291)
- x402 payment errors — check sponsor relay health first (`arc skills run --name wallet -- check-relay-health`)
- CORS errors — typically CF Pages Functions misconfiguration

## Mode 2: Repo Audit (`sensor:aibtc-dev-audit`)

**Goal:** Run production-grade checklist against repos, file issues for gaps.

### Steps

1. Run audit for all repos or specific repo:
   ```
   arc skills run --name aibtc-dev -- audit
   arc skills run --name aibtc-dev -- audit --repo aibtcdev/landing-page
   ```

2. For each failing checklist item:
   - Check if a `prod-grade` labeled issue already exists:
     ```
     gh search issues "label:prod-grade CHECKLIST_ITEM" --repo aibtcdev/REPO --state open --json number
     ```
   - If exists: skip (already tracked)
   - If new: file issue with:
     - Title: `[prod-grade] Missing: checklist item description`
     - Body: what's missing, why it matters, suggested fix
     - Labels: `prod-grade`, `enhancement`

3. Output summary: repos audited, pass/fail counts, issues filed.

### Checklist Items (9)

1. **TypeScript strict** — `tsconfig.json` must have `strict: true`
2. **Tests exist** — At least one `*.test.ts` or `*.spec.ts` file
3. **CI runs tests** — GitHub Actions workflow includes test step
4. **Worker-logs binding** — `wrangler.jsonc` has service binding to worker-logs
5. **Staging/prod split** — Separate environments in wrangler config
6. **Release-please** — Automated release management configured; release CI should be triggered by release-please (not raw merge-to-main builds)
7. **wrangler.jsonc** — Using `.jsonc` format (not `.toml`)
8. **Modern Workers** — `export default { fetch }` pattern
9. **Hono framework** — Using Hono for routing

### Priority Mapping

- Missing tests or CI: high priority (foundational)
- Missing worker-logs binding: medium (observability)
- Missing release-please or wrangler.jsonc: low (quality of life)

## Safety Rules

- Never merge PRs. Our role is audit and issue filing only (L1 autonomy).
- Never modify code in other repos. File issues with suggested fixes.
- One issue per checklist gap per repo. Do not spam.
- Check for existing issues before filing. Deduplicate.
- If a repo is archived or read-only, skip it silently.

## CLI Reference

```
arc skills run --name aibtc-dev -- logs [--app ID] [--level LEVEL] [--since ISO] [--limit N]
arc skills run --name aibtc-dev -- apps
arc skills run --name aibtc-dev -- stats [--app ID] [--days N]
arc skills run --name aibtc-dev -- audit [--repo REPO]
arc skills run --name aibtc-dev -- status
```

## Completion Format

Close your task with:
```
arc tasks close --id <ID> --status completed --summary "<one-line summary>"
```

Include in result_detail:
- Errors found / issues filed / issues updated (log review mode)
- Repos audited / items passing / items failing / issues filed (audit mode)
