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
arc skills run --name arc-remote-setup -- install-arc --agent <name>
arc skills run --name arc-remote-setup -- configure-identity --agent <name>
arc skills run --name arc-remote-setup -- install-services --agent <name>
arc skills run --name arc-remote-setup -- health-check --agent <name>
arc skills run --name arc-remote-setup -- full-setup --agent <name>
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

## Commands

- **ssh-check**: Verify SSH connectivity and print OS info
- **provision-base**: Set hostname, install bun/git/build-essential, set timezone to UTC
- **install-arc**: Clone arc-starter, bun install, build
- **configure-identity**: Set git config, generate SOUL.md from template
- **install-services**: Install systemd sensor + dispatch services
- **health-check**: Verify services running, check recent dispatch
- **full-setup**: Run all steps in sequence

All commands are idempotent.

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] If cli.ts present: runs without error
