# Agent Provisioning Checklist

*Template for onboarding a new Arc-based agent to the fleet.*
*Reference: arc-remote-setup skill for VM provisioning steps.*

---

## Agent: `{{AGENT_NAME}}`

**Provisioning date:** `{{DATE}}`
**Provisioned by:** `{{OPERATOR}}`
**VM IP:** `{{IP}}`
**Git identity:** `{{GIT_HANDLE}}`

---

## Phase 1 — Infrastructure

- [ ] VM reachable via SSH (`arc skills run --name arc-remote-setup -- ssh-check --agent {{AGENT_NAME}}`)
- [ ] Base packages installed (bun, git, build-essential, UTC timezone) (`provision-base`)
- [ ] whoabuddy SSH keys injected (`add-authorized-keys`)
- [ ] arc-starter cloned, `bun install`, build passes (`install-arc`)
- [ ] systemd sensor + dispatch services installed and active (`install-services`)
- [ ] Health check passes — services running, dispatch cycle completes (`health-check`)

## Phase 2 — Credentials

Each credential stored via: `arc creds set --service <service> --key <key> --value <value>`

- [ ] **Claude API key** — `arc creds set --service claude --key api-key --value <key>`
  - Source: Anthropic Console → API Keys. One key per agent.
- [ ] **ARC_CREDS_PASSWORD** — Set in systemd environment file (`~/.config/systemd/user/arc-*.service.d/env.conf`)
  - Format: `ARC_CREDS_PASSWORD=<password>` — choose a strong unique password per agent.
  - After setting, verify: `arc creds unlock`
- [ ] **Wallet generated and verified**
  - Run: `arc skills run --name arc-credentials -- generate-wallet` (or equivalent)
  - Record Bitcoin address, Stacks address, BNS name (if claimed)
  - Back up wallet seed to secure location (not in codebase)
  - Verify signing works (BIP-340 for Bitcoin, SIP-018 for Stacks)

## Phase 3 — Identity

- [ ] `SOUL.md` generated with agent-specific identity (name, addresses, mission)
- [ ] Git config set (name, email matching `<handle>@users.noreply.github.com`)
- [ ] `memory/MEMORY.md` initialized with agent name, mission, initial status
- [ ] GOALS.md copied or symlinked from shared fleet goals (if applicable)

## Phase 4 — GitHub Presence

**Decision required per agent** (spark0btc is permanently blocked from GitHub):

| Agent | GitHub Handle | Status | Decision |
|-------|--------------|--------|----------|
| arc   | arc0btc      | Active | Established |
| spark | spark0btc    | **Blocked** | GitHub-free / AIBTC-only |
| iris  | iris0btc     | TBD | Needs decision from whoabuddy |
| loom  | loom0btc     | TBD | Needs decision from whoabuddy |
| forge | forge0btc    | TBD | Needs decision from whoabuddy |

For agents with GitHub presence:
- [ ] GitHub account created and verified
- [ ] SSH deploy key added to arc-starter repo
- [ ] GitHub token stored: `arc creds set --service github --key token --value <token>`
- [ ] PR review / repo maintenance skills enabled

For agents without GitHub presence:
- [ ] Skills that require GitHub access disabled or skipped
- [ ] Alternative contribution path documented (e.g., AIBTC-only, X-only)

## Phase 5 — Skill-Specific Credentials

Install only the credentials for skills the agent will actively run.

| Service | Credential Keys | Notes |
|---------|----------------|-------|
| X (Twitter) | `x / api-key`, `x / api-secret`, `x / access-token`, `x / access-secret` | Per-account OAuth1 |
| Stacks node | `stacks / api-url` | Default: `https://api.mainnet.hiro.so` |
| AIBTC | `aibtc / api-key` | Required for Ordinals Business beat |
| Email (IMAP) | `email / imap-host`, `email / imap-user`, `email / imap-pass` | arc-email-sync skill |
| Cloudflare | `cloudflare / token`, `cloudflare / zone-id` | arc0btc-site-health, deploy |
| OpenRouter | `openrouter / api-key` | If using multi-SDK routing |

## Phase 6 — Verification

- [ ] `arc status` returns clean output (task counts, last cycle, cost today)
- [ ] `arc sensors` runs without errors
- [ ] `arc run` completes a full dispatch cycle
- [ ] First task (e.g., heartbeat or health-check) completes with `status=completed`
- [ ] `arc creds list` shows all expected credential keys
- [ ] Services survive reboot: `systemctl --user restart arc-sensor arc-dispatch && sleep 10 && arc status`

---

## Notes

*Add agent-specific notes, blockers, and decisions here.*

---

## Fleet Status (as of 2026-03-09)

| Agent | IP | Services | GitHub | Notes |
|-------|-----|----------|--------|-------|
| arc   | (local) | Running | arc0btc | Reference agent — fully operational |
| spark | 192.168.1.12 | TBD | **Blocked** | spark0btc permanently restricted by GitHub |
| iris  | 192.168.1.13 | TBD | TBD | Awaiting provisioning |
| loom  | 192.168.1.14 | TBD | TBD | Awaiting provisioning |
| forge | 192.168.1.15 | TBD | TBD | Awaiting provisioning |

**Escalation contact:** whoabuddy — GitHub presence decisions, wallet funding, API key issuance.
