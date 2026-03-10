---
name: arc-remote-setup
description: SSH-based VM provisioning for agent fleet deployment
updated: 2026-03-08
tags:
  - infrastructure
  - fleet
  - provisioning
---

# arc-remote-setup

Provisions arc-starter on remote Ubuntu VMs via SSH. Foundation for agent fleet deployment.

## CLI Commands

```
arc skills run --name arc-remote-setup -- ssh-check --agent <name>
arc skills run --name arc-remote-setup -- provision-base --agent <name>
arc skills run --name arc-remote-setup -- add-authorized-keys --agent <name>
arc skills run --name arc-remote-setup -- install-arc --agent <name>
arc skills run --name arc-remote-setup -- configure-identity --agent <name>
arc skills run --name arc-remote-setup -- install-services --agent <name>
arc skills run --name arc-remote-setup -- health-check --agent <name>
arc skills run --name arc-remote-setup -- full-setup --agent <name>
arc skills run --name arc-remote-setup -- setup-api-key --agent <name>
arc skills run --name arc-remote-setup -- setup-x-credentials --agent <name>
```

## Agent Names

| Agent | IP | Git Identity |
|-------|-----|-------------|
| spark | 192.168.1.12 | spark0btc |
| iris  | 192.168.1.13 | iris0btc |
| loom  | 192.168.1.14 | loom0btc |
| forge | 192.168.1.15 | forge0btc |

## Credentials

- `vm-fleet` / `ssh-password` — SSH password for dev@<ip>
- `vm-fleet` / `<agent>-ip` — IP override (defaults to table above)
- `anthropic` / `api-key` — Shared API key for all agents (or `<agent>-api-key` per agent)
- `x-{agent}` / `account|consumer_key|consumer_secret|bearer_token|app_name|client_id|client_secret|access_token|access_token_secret` — X OAuth credentials (stored in Arc, deployed to agent VM)

## Commands

- **ssh-check**: Verify SSH connectivity and print OS info
- **provision-base**: Set hostname, install bun/git/build-essential, set timezone to UTC
- **add-authorized-keys**: Inject whoabuddy's SSH keys into ~/.ssh/authorized_keys (idempotent)
- **install-arc**: Clone arc-starter, bun install, build
- **configure-identity**: Set git config, generate SOUL.md from template
- **install-services**: Install systemd sensor + dispatch services
- **health-check**: Verify services running, check recent dispatch
- **full-setup**: Run all steps in sequence
- **setup-api-key**: Inject ANTHROPIC_API_KEY from creds store into VM .env, reload services
- **setup-x-credentials**: Deploy X OAuth 1.0a credentials from Arc's `x-{agent}/` creds store to agent VM. Requires whoabuddy to first create the X account + developer app and store 9 credentials under `x-loom/` (or `x-iris/`, etc.) in Arc's creds store.
- **setup-mesh-ssh**: Generate keypairs, distribute to all agents, test peer-to-peer SSH

All commands are idempotent.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
