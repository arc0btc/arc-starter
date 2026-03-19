# blog-deploy — Agent Briefing

You are executing a deploy task for the arc0me-site blog (arc0.me). This document is your execution guide.

## What You're Deploying

`github/arc0btc/arc0me-site` is an Astro static site deployed to Cloudflare Workers. The CLI handles the full pipeline automatically.

## Standard Deploy

```
arc skills run --name blog-deploy -- deploy
```

This single command runs the full pipeline in sequence:
1. **Pre-flight**: Verifies Cloudflare API token is valid
2. **Build**: Runs `npm run build` in the site directory
3. **Deploy**: Runs `npx wrangler deploy --env production` with `CLOUDFLARE_API_TOKEN` injected from the credential store
4. **Record SHA**: Writes the deployed git SHA to hook state so the sensor won't re-queue
5. **Verify**: Calls `blog-publishing verify-deploy` to confirm the live site is reachable

On success, outputs:
```json
{ "success": true, "sha": "<12-char-sha>", "site": "https://arc0.me" }
```

## Checking Status First

Before deploying, you can check whether a deploy is actually needed:

```
arc skills run --name blog-deploy -- status
```

Output shows `current_sha` vs `last_deployed_sha`. If `up_to_date: true`, no deploy is needed — close the task without running deploy.

## When to Use --skip-verify

Use `--skip-verify` only when:
- The verify-deploy check is known to be flaky (non-fatal anyway, but avoids noise)
- You are doing a forced re-deploy and the live site state doesn't matter for this task
- A previous attempt failed at the verify step but the deploy itself succeeded (check hook state SHA)

The verify step is **non-fatal** — a verify failure only prints a WARNING and does not fail the deploy. Credentials are already recorded before verify runs. So `--skip-verify` is safe any time you trust the deploy succeeded.

## Interpreting Deploy Output

**Successful wrangler output** contains lines like:
```
Uploaded arc0me-site (X.XX sec)
Published arc0me-site (X.XX sec)
  https://arc0.me
```

**Failed wrangler output** typically contains:
- `"Authentication error"` → credential issue (see below)
- `"Could not resolve"` / network errors → transient, retry once
- Build errors (TypeScript, missing modules) → code issue, needs investigation

## Failure Handling

### Pre-flight fails (Cloudflare token invalid)
```
arc creds get --service cloudflare --key api_token
```
If missing or invalid, set `status=blocked` — you cannot fix credentials autonomously.

### Build fails
- Check the error output for the specific file/line
- If it's a dependency issue: `npm install` may need to run in the site directory first
- If it's a code error: this needs a human to fix the site source
- Set `status=blocked` with the error details

### Wrangler deploy fails
1. Check if it's an auth error → see credential check above
2. Check if it's a transient network error → retry once with the same command
3. If it fails twice → set `status=failed` with the full error output

### Verify fails (WARNING only)
- Deploy succeeded. Close the task as `completed`.
- Optionally note the verify warning in `result_summary`.

## Hook State

The sensor deduplicates by comparing SHA in hook state. After a successful deploy, the CLI writes the new SHA automatically. You do not need to manage this manually.

If the sensor keeps re-queuing after a successful deploy, check:
```
arc skills run --name blog-deploy -- status
```
The `last_deployed_sha` should match `current_sha`. If it doesn't, run deploy again to re-sync.

## Closing the Task

```
# Success
arc tasks close --id <task-id> --status completed --summary "Deployed arc0me-site @ <sha> to arc0.me"

# Build/deploy failure
arc tasks close --id <task-id> --status failed --summary "Deploy failed: <brief error>"

# Needs human (credentials, code error)
arc tasks close --id <task-id> --status blocked --summary "Blocked: <reason>"
```
