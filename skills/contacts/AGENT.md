# Contacts — Subagent Briefing

You are managing Arc's contact database. All operations go through the CLI.

## Quick Reference

```bash
# List all contacts
arc skills run --name contacts -- list

# Add a human
arc skills run --name contacts -- add --display-name "whoabuddy" --type human --bns-name "whoabuddy.btc" --stx "SP..." --github "whoabuddy"

# Add an agent
arc skills run --name contacts -- add --aibtc-name "Topaz Centaur" --type agent --btc "bc1q..." --stx "SP..." --beat "Dev Tools" --x402 "https://..."

# Show full details
arc skills run --name contacts -- show --id 1

# Update a contact
arc skills run --name contacts -- update --id 1 --notes "Key collaborator" --level "Genesis"

# Link two contacts (bidirectional)
arc skills run --name contacts -- link --a 1 --b 2 --relationship "operator" --notes "whoabuddy operates Topaz Centaur"

# Log an interaction
arc skills run --name contacts -- log --id 1 --type collaboration --summary "Reviewed PR #42 together" --task 500

# Search
arc skills run --name contacts -- search --term "arc0"
```

## Name Resolution

Contacts display using a fallback chain: `display_name > aibtc_name > bns_name > "Contact #N"`. Provide at least one when creating.

## Contact Types

- `human` (default) — Real people. Use display_name + bns_name.
- `agent` — AI agents. Use aibtc_name. Set agent_id, operator_contact_id, x402_endpoint, aibtc_beat, aibtc_level as available.

## Interaction Types

When logging interactions, use these types:
- `message` — Direct message sent/received (x402, email, etc.)
- `collaboration` — Joint work (PR review, shared research, co-authored content)
- `mention` — Referenced in conversation, post, or signal
- `meeting` — Synchronous interaction
- `other` — Anything else

## Relationship Labels

Common labels for `link --relationship`:
- `operator` — Human operates agent
- `collaborator` — Working together on shared goals
- `multisig-partner` — Multisig co-signer
- `mentor` / `mentee`
- `employer` / `employee`

## Importing in Code

```ts
import { initContactsSchema, searchContacts, insertContactInteraction } from "../contacts/schema";

// Always init first
initContactsSchema();

// Then query
const results = searchContacts("whoabuddy");
```

## Rules

1. Always use the CLI for mutations — no raw SQL.
2. Set `--type agent` for AI agents, `--type human` for people.
3. Link agents to their operators with `--relationship "operator"`.
4. Log interactions when meaningful — don't log routine/automated touches.
5. Use `--task <N>` on `log` to cross-reference the task that prompted the interaction.
