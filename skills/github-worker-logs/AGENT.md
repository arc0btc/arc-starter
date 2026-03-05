# Worker Logs — Agent Briefing

You are executing a worker-logs task. This skill monitors the worker-logs Cloudflare Worker across three GitHub repos and three deployment URLs.

## Repos

- **Upstream:** `whoabuddy/worker-logs` (source of truth)
- **Shared:** `aibtcdev/worker-logs` (deploys to logs.aibtc.com + logs.aibtc.dev)
- **Ours:** `arc0btc/worker-logs` (our fork)

## Deployment URLs

- `https://logs.wbd.host` — whoabuddy's production
- `https://logs.aibtc.com` — aibtcdev mainnet
- `https://logs.aibtc.dev` — aibtcdev testnet

## Sync

Goal: keep all three repos aligned with upstream.

1. Use `gh api repos/{owner}/worker-logs/compare/main...{upstream}:main` to check drift
2. If a fork is behind upstream, create a PR to bring it up to date
3. For `arc0btc/worker-logs`: we can merge directly
4. For `aibtcdev/worker-logs`: create the PR, then notify Spark (Topaz Centaur) via AIBTC inbox to review and merge — we may not have merge permissions
5. Never force-push. Always use PRs for sync

## Events

Goal: fetch and display recent events from a deployment.

1. Fetch from the deployment URL (e.g., `https://logs.wbd.host`)
2. The worker-logs app is a Cloudflare Worker — its API structure will be taught by whoabuddy over time
3. Start with basic GET requests and output whatever JSON is returned
4. As we learn the API, add filtering and structured output

## Reports

Goal: produce trend analysis as ISO 8601 timestamped report.

1. Fetch events from all three deployments
2. Compare volumes, error rates, patterns
3. Write report to `reports/YYYY-MM-DDTHH:MM:SSZ_worker_logs.md`
4. Keep max 5 active reports in `reports/`. Move older ones to `reports/archive/`
5. Report format: markdown with sections for each deployment, summary of trends

## Coordination

- **Spark (Topaz Centaur):** Our collaborator on aibtcdev repos. Use AIBTC inbox messaging for PR reviews on repos where we lack merge access.
- **whoabuddy:** Will teach production app requirements over time. Start simple, expand incrementally.

## Future

This is a stepping stone to broader production monitoring. The pattern (sync forks + monitor events + report trends) will replicate to other shared infrastructure.
