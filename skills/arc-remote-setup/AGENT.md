# arc-remote-setup — Subagent Briefing

You are provisioning Ubuntu VMs for the Arc agent fleet via SSH. All commands are idempotent and use `sshpass` for password auth.

## Agent Roster

| Agent | Default IP | Git User | Hostname | BNS |
|-------|-----------|----------|----------|-----|
| spark | 192.168.1.12 | spark0btc | spark | spark0.btc |
| iris  | 192.168.1.13 | iris0btc  | iris  | iris0.btc |
| loom  | 192.168.1.14 | loom0btc  | loom  | loom0.btc |
| forge | 192.168.1.15 | forge0btc | forge | forge0.btc |

SSH user is always `dev`. Remote arc directory: `/home/dev/arc-starter`.

IP overrides: `arc creds get --service vm-fleet --key <agent>-ip` takes precedence over defaults.

## Credentials Required

Before any provisioning, ensure these are set:

| Service | Key | Purpose |
|---------|-----|---------|
| `vm-fleet` | `ssh-password` | SSH password for `dev@<ip>` (shared across fleet) |
| `anthropic` | `api-key` | Shared Anthropic API key (fallback) |
| `anthropic` | `<agent>-api-key` | Per-agent API key (takes precedence if set) |
| `x-<agent>` | 9 keys (see below) | X/Twitter OAuth credentials per agent |

X credential keys (all under service `x-<agent>`): `account`, `consumer_key`, `consumer_secret`, `bearer_token`, `app_name`, `client_id`, `client_secret`, `access_token`, `access_token_secret`.

Verify credentials exist: `arc creds list`

## Command Reference

All commands require `--agent <name>` (spark, iris, loom, forge).

### ssh-check
Verify SSH connectivity. Prints `uname -a`, OS release, uptime.
```
arc skills run --name arc-remote-setup -- ssh-check --agent spark
```
**Run this first.** If this fails, nothing else will work. Check: password correct, VM is up, port 22 open.

### provision-base
Sets hostname, timezone (UTC), installs `git build-essential curl sshpass unzip`, installs Bun, symlinks bun to `/usr/local/bin/bun`.
```
arc skills run --name arc-remote-setup -- provision-base --agent spark
```

### add-authorized-keys
Injects whoabuddy's SSH public keys into `~/.ssh/authorized_keys`. Deduplicates — safe to run multiple times.
```
arc skills run --name arc-remote-setup -- add-authorized-keys --agent spark
```

### install-arc
Clones `arc0btc/arc-starter` from GitHub (or `git pull --ff-only` if already present). Runs `bun install` and a build syntax check.
```
arc skills run --name arc-remote-setup -- install-arc --agent spark
```

### configure-identity
Sets `git config` (user.name, user.email), generates SOUL.md from template (written to both `arc-starter/SOUL.md` and `~/.aibtc/SOUL.md` for persistence), generates initial `memory/MEMORY.md` with agent role and fleet context.
```
arc skills run --name arc-remote-setup -- configure-identity --agent spark
```

### install-services
Runs `arc services install` on the VM, then enables and starts `arc-sensors.timer` and `arc-dispatch.timer` via systemd. Enables loginctl lingering so services survive SSH logout.
```
arc skills run --name arc-remote-setup -- install-services --agent spark
```

### health-check
Checks that `arc-sensors.timer` and `arc-dispatch.timer` are active. Prints recent journal entries and `arc status` output. Exits 1 if any timer is inactive.
```
arc skills run --name arc-remote-setup -- health-check --agent spark
```

### full-setup
Runs all 7 steps in sequence:
1. `ssh-check` — verify connectivity
2. `provision-base` — OS packages, bun, hostname
3. `add-authorized-keys` — whoabuddy's SSH keys
4. `install-arc` — clone repo, install deps
5. `configure-identity` — git config, SOUL.md, MEMORY.md
6. `install-services` — systemd timers
7. `health-check` — verify everything is running

Stops on first failure. Use this for fresh VM setup.
```
arc skills run --name arc-remote-setup -- full-setup --agent spark
```

### setup-api-key
Reads API key from Arc's credential store (`anthropic/<agent>-api-key` or fallback `anthropic/api-key`), writes it to `.env` on the remote VM, reloads systemd.
```
arc skills run --name arc-remote-setup -- setup-api-key --agent spark
```

### setup-x-credentials
Deploys all 9 X OAuth credentials from Arc's `x-<agent>/` credential store to the agent's own credential store on the VM. Requires whoabuddy to have already created the X developer app and stored creds in Arc's store first.
```
arc skills run --name arc-remote-setup -- setup-x-credentials --agent loom
```
Prerequisite: all 9 keys must exist under `x-<agent>` in Arc's creds. Missing keys are listed on failure.

### setup-mesh-ssh
No `--agent` flag. Operates on all agents + Arc. Generates ed25519 keypairs on every node, collects public keys, distributes to all `authorized_keys`, then tests every peer-to-peer SSH connection. Reports pass/fail count.
```
arc skills run --name arc-remote-setup -- setup-mesh-ssh
```

## Full Setup Sequence (New VM)

1. Ensure `vm-fleet/ssh-password` is set in creds
2. Run `full-setup --agent <name>`
3. Run `setup-api-key --agent <name>`
4. (Optional) Run `setup-x-credentials --agent <name>` if X account exists
5. (Optional) Run `setup-mesh-ssh` to enable peer-to-peer fleet SSH
6. Verify with `health-check --agent <name>`

## Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| SSH connection timeout | VM down or wrong IP | Check VM status; verify IP with `arc creds get --service vm-fleet --key <agent>-ip` |
| `sshpass: command not found` | sshpass not installed on Arc | `sudo apt install sshpass` |
| Permission denied | Wrong SSH password | Update: `arc creds set --service vm-fleet --key ssh-password --value <pw>` |
| Bun install fails | Network issue on VM | Retry; check VM internet connectivity |
| `git clone` fails | GitHub unreachable or private repo | Check VM DNS/internet; ensure repo is public or deploy key is set |
| Timer not active after install-services | systemd user session issue | Check `loginctl enable-linger dev`; verify `.service` and `.timer` files exist |
| API key missing | Not in creds store | `arc creds set --service anthropic --key api-key --value sk-ant-...` |
| X credentials missing | whoabuddy hasn't created the app yet | List what's missing, create a follow-up task for whoabuddy |
| `fleet-suspended.json` blocks routing | Fleet suspension active | Do NOT route work to suspended agents; wait for suspension lift |

## Idempotency

Every command is safe to re-run:
- `provision-base`: apt-get is idempotent, bun installer handles existing installs
- `add-authorized-keys`: grep-before-append prevents duplicate keys
- `install-arc`: pulls if already cloned, fresh install otherwise
- `configure-identity`: overwrites SOUL.md and MEMORY.md (by design — templates may update)
- `install-services`: daemon-reload + enable is safe to repeat
- `setup-api-key`: sed removes old key before appending new one
- `setup-x-credentials`: overwrites via `arc creds set` (last-write wins)
- `setup-mesh-ssh`: skips existing keypairs, deduplicates authorized_keys

## Important Notes

- Arc is the only agent with GitHub push access. Workers pull via `git clone`/`git pull --ff-only`.
- Fleet suspension (`db/fleet-suspended.json`): when workers are suspended, do NOT attempt provisioning unless explicitly asked. Use `isFleetSuspended()` to check.
- SOUL.md is also persisted at `~/.aibtc/SOUL.md` so `fleet-self-sync` can restore it after hard resets.
- The SSH password is shared across all VMs. Changing it requires updating all VMs and the creds store.
