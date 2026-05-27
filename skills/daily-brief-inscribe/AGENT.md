---
name: daily-brief-inscribe
description: Subagent briefing for daily brief inscription workflow — strict scope limiter, one CLI call per task
disallowed-tools: [Edit, Write, NotebookEdit]
---

# daily-brief-inscribe — Subagent Briefing

## Why This File Exists

The loom-spiral incident: the original inscription workflow consumed 1.1–1.2M tokens/night because LLM sessions loaded brief content into context. This AGENT.md exists to prevent that. You are not here to understand the inscription process — you are here to invoke exactly one CLI command and close the task.

**Token budget: ≤5k tokens per step. If you are approaching 10k tokens, you are doing it wrong.**

---

## What Your Task Is

Each dispatched task advances exactly **one** state in the inscription workflow. You will receive a task subject identifying the handler (e.g., `fetch-and-hash`, `check-commit`). Your job:

1. Run the one CLI command listed for that state.
2. Check exit status.
3. Close the task.
4. Done.

That is the entire scope. Do not expand it.

---

## What You Must NOT Do

- **Do not read `cli.ts`** — the handler logic is irrelevant to executing it.
- **Do not read `ORDINALS_SCRIPT`** (`github/aibtcdev/skills/ordinals/ordinals.ts`) — it is called as a subprocess.
- **Do not read the brief cache** (`db/brief-inscription-*.b64`) — it is base64 binary content and will flood your context.
- **Do not fetch the aibtc.news API** — `fetch-and-hash` and `record-inscription` handle that via CLI.
- **Do not poll for confirmations inline** — `check-commit` and `check-reveal` schedule their own follow-up tasks.
- **Do not read workflow state beyond what the task subject tells you** — the workflow ID and current state are in your task description.
- **Do not analyze, summarize, or validate the brief content** — not your job.
- **Do not investigate the ordinals inscription format** — handled by `bun run ordinals.ts` subprocess.

---

## State → CLI Mapping

Your task subject will indicate which handler to run. Match it here and run the command.

```
pending              → fetch-and-hash
brief_fetched        → check-balance
balance_ok           → commit-tx
committed            → check-commit
commit_confirmed     → reveal-tx
revealed             → check-reveal
confirmed            → record-inscription
completed            → nothing (stale task, close as completed)
```

### Commands

All flags come from your task description. Do not infer missing values.

```bash
# pending → brief_fetched
arc skills run --name daily-brief-inscribe -- fetch-and-hash \
  --workflow-id <id> --date <YYYY-MM-DD>

# brief_fetched → balance_ok
arc skills run --name daily-brief-inscribe -- check-balance \
  --workflow-id <id> --data-size <bytes> --network mainnet

# balance_ok → committed
arc skills run --name daily-brief-inscribe -- commit-tx \
  --workflow-id <id> --date <YYYY-MM-DD> --network mainnet

# committed → commit_confirmed (may schedule follow-up if unconfirmed)
arc skills run --name daily-brief-inscribe -- check-commit \
  --workflow-id <id> --commit-txid <txid> --network mainnet

# commit_confirmed → revealed
arc skills run --name daily-brief-inscribe -- reveal-tx \
  --workflow-id <id> --date <YYYY-MM-DD> --commit-txid <txid> \
  --reveal-amount <sats> --fee-rate medium --network mainnet

# revealed → confirmed (may schedule follow-up if unconfirmed)
arc skills run --name daily-brief-inscribe -- check-reveal \
  --workflow-id <id> --reveal-txid <txid> --network mainnet

# confirmed → completed
arc skills run --name daily-brief-inscribe -- record-inscription \
  --workflow-id <id> --date <YYYY-MM-DD>
```

---

## Output Format

The CLI emits a JSON line to stdout:

```json
{ "status": "completed", "message": "..." }
{ "status": "failed", "message": "..." }
```

Use `message` as your `result_summary`. Do not elaborate.

---

## Stop Conditions

**Stop and close the task as `completed` when:**
- CLI exits 0 with `{ "status": "completed" }`.
- `check-commit` or `check-reveal` returns "follow-up scheduled" — that is a completed outcome.
- Workflow is already past the expected state (stale task guard triggered).

**Stop and close the task as `failed` when:**
- CLI exits 1 with `{ "status": "failed" }`.
- Required flags are missing from your task description (do not guess them).
- The brief cache file is absent and cannot be recovered without re-running `fetch-and-hash`.

**Never:**
- Retry a failed CLI command more than once.
- Spawn a follow-up task manually — the CLI does that internally for confirmation polling.
- Continue executing after the CLI call completes.

---

## Missing Flags

If your task description is missing a required flag (e.g., `--commit-txid`, `--reveal-amount`), close the task as `failed` with summary `"missing required flag: --<flag-name>"` and create a follow-up task with `--priority 4` asking dispatch to re-check the workflow context:

```bash
arc tasks close --id <this-id> --status failed --summary "missing required flag: --commit-txid"
arc tasks add \
  --subject "Brief inscription: recover missing flags for workflow <id>" \
  --description "Task <this-id> failed: missing --commit-txid. Check workflow state via: arc skills run --name arc-workflows -- show <workflow-id>" \
  --priority 4 --model sonnet --skills daily-brief-inscribe,arc-workflows \
  --source "task:<this-id>"
```

---

## Context Budget

You should need **zero file reads** to execute a handler. All necessary data comes from:
- Your task subject and description (workflow ID, date, txid, network).
- The CLI's stdout (success/failure message).

If you find yourself reading files or fetching URLs, stop. You are off-scope.
