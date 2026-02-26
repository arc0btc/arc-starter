---
name: credentials
description: Encrypted credential store for API keys, tokens, and secrets used by other skills
tags:
  - secrets
  - api-keys
  - encryption
---

# credentials

Encrypted key-value store for Arc. Holds API keys, tokens, and secrets needed by skills. AES-256-GCM encryption with scrypt KDF. Unlocked via a master password.

## Storage

| Field | Value |
|-------|-------|
| Store file | `~/.aibtc/credentials.enc` |
| Encryption | AES-256-GCM + scrypt KDF |
| Password env | `ARC_CREDS_PASSWORD` |

Shared directory with the wallet keystore. Same encryption pattern. First unlock creates the store empty.

## Operations

### List credentials (names only, no values)

```
arc creds list
```

### Get a credential value

```
arc creds get --service github --key pat
```

### Add or update a credential

```
arc creds set --service github --key pat --value ghp_xxxx
```

### Delete a credential

```
arc creds delete --service github --key pat
```

### Verify password and show store info

```
arc creds unlock
```

## Credential Schema

Each credential has three fields:

- `service` — which integration owns it (e.g., `github`, `stacks-api`, `openrouter`)
- `key` — the specific credential within that service (e.g., `pat`, `api_key`, `oauth_token`)
- `value` — the secret value (plaintext in memory, AES-256-GCM encrypted on disk)

## Importing in TypeScript

Other skills can import the store directly:

```typescript
import { credentials } from "../../skills/credentials/store.ts";

await credentials.unlock(); // reads ARC_CREDS_PASSWORD from env
const apiKey = credentials.get("openrouter", "api_key");
```

## Environment

`ARC_CREDS_PASSWORD` must be set in `.env` at the project root. Bun auto-loads `.env` on startup. Store is initialized empty on first unlock — no migration needed for new entries.

## Checklist

- [ ] `skills/credentials/SKILL.md` exists with valid frontmatter (name, description, tags)
- [ ] Frontmatter `name` matches directory name (credentials)
- [ ] `skills/credentials/store.ts` exists and compiles: `bun build --target bun skills/credentials/store.ts`
- [ ] `skills/credentials/AGENT.md` exists with subagent instructions
- [ ] `skills/credentials/cli.ts` exists (Phase 2)
- [ ] `ARC_CREDS_PASSWORD` is set in `.env`
- [ ] `~/.aibtc/credentials.enc` is listed in `.gitignore`
- [ ] SKILL.md is under 2000 tokens
