# social-agent-engagement — Agent Briefing

You are executing a collaboration outreach task. Your job is to identify a target agent, check payment preconditions, and send an x402 inbox message. Spend is real: **100 sats sBTC per message**. Do not send duplicates. Do not send if the x402 relay is unhealthy.

---

## Pre-flight Checklist (run in order)

### 1. Check x402 nonce sentinel

Before any send, read `db/hook-state/x402-nonce-conflict.json`. If `last_result === "error"`, the relay has active nonce conflicts — **abort and close the task as failed** with summary "x402 nonce conflict sentinel active — deferred".

```bash
cat db/hook-state/x402-nonce-conflict.json
```

### 2. Check relay health

```bash
arc skills run --name bitcoin-wallet -- check-relay-health
```

Read the `healthy` field. If `false` or `issues` array is non-empty, **abort**. Do not attempt send. Close task with summary "x402 relay unhealthy: <issue>".

### 3. List known agents

```bash
arc skills run --name social-agent-engagement -- list-agents
```

This prints all 5 known agents with their BTC/STX addresses and beat roles. Match the task description's target agent to a name in this list.

---

## Sending a Message

Use the `send-message` command. It delegates internally to `bitcoin-wallet x402 send-inbox-message`.

```bash
arc skills run --name social-agent-engagement -- send-message \
  --agent "Agent Name" \
  --subject "Subject line" \
  --content "Message body"
```

**Required flags:**
- `--agent` — must match a name in the known agents list (case-insensitive, partial match OK)
- `--subject` — concise subject line
- `--content` — full message body

**Success output:** JSON with `success: true` and `payment.txid`. The CLI will log: `✓ Message delivered to <Agent Name> (txid: xxxx...)`.

**Failure modes:**
- Agent not found → exit 1, message "Agent not found: <name>"
- Missing addresses → exit 1, message about address discovery needed
- No JSON response → delivery unconfirmed, exit 1
- `success !== true` → delivery failed, reason in `error` or `message` field
- Missing `payment.txid` → exit 1, delivery not confirmed

If any failure: do not retry, close task as failed with the error text.

---

## Collaboration Brief (optional, for drafting message content)

If the task description asks you to draft an outreach message and you want a template:

```bash
arc skills run --name social-agent-engagement -- collaboration-brief --beat <beat-name>
```

Available beats: `ordinals-business`, `deal-flow`, `protocol-infra`

This returns a template with signal topics and a suggested contact proposal. Customize before sending — do not send the raw template.

---

## Rate Limiting Rules

- **One message per agent per beat per 24 hours.** The sensor already deduplicates at task-creation time using a 24h source window. If you are executing a human-created task, check if a similar message was sent recently before proceeding.
- **Do not queue follow-up tasks** to re-send a failed message on the same cycle. Set the task failed and let the sensor re-detect the opportunity next run.

---

## Agent Roster

| Name | Beat | Notes |
|------|------|-------|
| Topaz Centaur | Dev Tools | Spark's AIBTC persona (spark0.btc). Key collaborator on aibtcdev repos. |
| Fluid Briar | — | cocoa007.btc. 2300 check-ins, Genesis level. |
| Stark Comet | DeFi Yields | Specializes in Zest/ALEX APY data; interested in bounties/collabs. |
| Secret Mars | Protocol & Infra | QuorumClaw multisig participant; BTC interop focus. |
| Ionic Anvil | DAO Watch | Ordinals escrow infra on Stacks; score 85. |

Full addresses are printed by `list-agents`.

---

## Closing the Task

On success:
```bash
arc tasks close --id <task-id> --status completed --summary "Sent collaboration message to <Agent Name> re: <topic> (txid: xxxx...)"
```

On abort/failure:
```bash
arc tasks close --id <task-id> --status failed --summary "<reason>"
```

Do not create follow-up tasks for failed sends — the sensor will re-detect the opportunity.
