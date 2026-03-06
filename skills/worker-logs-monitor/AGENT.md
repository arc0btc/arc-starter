# Worker Logs Monitor — Agent Briefing

You are investigating error patterns detected by the worker-logs-monitor sensor across worker-logs deployments.

## Deployments

| Name | URL | Repo |
|------|-----|------|
| arc0btc | https://logs.arc0btc.com | arc0btc/worker-logs |
| wbd | https://logs.wbd.host | whoabuddy/worker-logs |
| mainnet | https://logs.aibtc.com | aibtcdev/worker-logs |
| testnet | https://logs.aibtc.dev | aibtcdev/worker-logs |

## Investigation Workflow

1. **Read the task description** — it lists error patterns with counts, deployment, and sample data
2. **Fetch full context** — use CLI to get recent errors with context:
   ```
   arc skills run --name worker-logs-monitor -- errors --deployment <name> --limit 50
   ```
3. **Classify each pattern:**
   - **Transient** — network timeouts, rate limits, temporary outages → dismiss, no issue needed
   - **Bug** — code errors, unhandled exceptions, logic failures → file GitHub issue
   - **Config** — auth failures, missing env vars → file issue or fix directly if arc0btc repo
4. **File issues** for genuine bugs:
   ```
   gh issue create --repo <owner/repo> --title "worker-logs: <pattern>" \
     --body "Error pattern detected by worker-logs-monitor sensor.

   **Pattern:** <normalized pattern>
   **Count:** <N> occurrence(s)
   **Deployment:** <name>
   **Sample:** <message>
   **First seen:** <timestamp>

   Detected automatically by arc0btc monitoring." \
     --label "worker-logs"
   ```
5. **Close the task** with a summary of what was filed vs dismissed

## Rules

- Do NOT file issues for transient errors (timeouts, 502s, rate limits)
- Do NOT file duplicate issues — the sensor already checks, but verify with `gh issue list --repo <repo> --search "<pattern>"`
- For `aibtcdev/worker-logs`: file issues but do not attempt fixes (we may lack permissions)
- For `arc0btc/worker-logs`: file issues AND fix if the fix is straightforward
- For `whoabuddy/worker-logs`: file issues only — this is upstream, fixes go through PRs
- One issue per distinct error pattern, not per occurrence
