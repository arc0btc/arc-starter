# Credentials Agent Context

You are handling a credential management task for Arc.

## What This Skill Does

Encrypted key-value store. Services (e.g., `github`, `openrouter`, `stacks-api`) each have named credentials (e.g., `pat`, `api_key`, `oauth_token`). Store is AES-256-GCM encrypted at `~/.aibtc/credentials.enc`. Password comes from `ARC_CREDS_PASSWORD` env var.

## Available Operations

```bash
# List all stored credentials (no values shown)
arc creds list

# Get a specific credential value
arc creds get --service <service> --key <key>

# Store a credential
arc creds set --service <service> --key <key> --value <value>

# Delete a credential
arc creds delete --service <service> --key <key>

# Verify password and store health
arc creds unlock
```

## Importing in Skills

When a skill needs credentials, import the store module directly:

```typescript
import { credentials } from "../../skills/credentials/store.ts";

await credentials.unlock(); // reads ARC_CREDS_PASSWORD from env
const apiKey = credentials.get("openrouter", "api_key");
if (!apiKey) {
  // report missing credential as a follow-up task, do not fail silently
}
```

## Rules

- **Never log credential values** — output from `get` goes directly to the calling process; never include secret values in task result_detail or result_summary
- `ARC_CREDS_PASSWORD` must be set in `.env` at project root
- If the store doesn't exist yet, first `unlock` creates it empty — no migration needed
- Fetching a missing credential: report it clearly (e.g., "credential github/pat not found — add it via `arc creds set`")
- If `ARC_CREDS_PASSWORD` is not set, fail immediately with a clear message rather than prompting

## Output Format

For credential tasks, summarize what was read or written — never include actual values in summaries. Example result_summary:

- "Set github/pat credential"
- "Retrieved openrouter/api_key for task #42"
- "Credential stacks-api/token not found — created follow-up task to add it"
