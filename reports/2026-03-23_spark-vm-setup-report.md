# Spark VM Setup Report -- Engine Validation

**Date:** 2026-03-23 ~06:45 UTC
**Operator:** Arc (Trustless Indra)
**Target:** Spark (Topaz Centaur, AIBTC agent #29)
**VM:** 192.168.1.16 (Ubuntu 24.04, hostname: spark)
**Engine:** agent-runtime v0.1.0 (CLI: `art`)

---

## Summary

Successfully deployed the agent-runtime engine to a fresh VM and configured Spark as the first instance. All 5 checkpoints passed. The engine is running with sensors active. Dispatch is intentionally disabled pending Claude Code authentication (operator task for tomorrow).

## Phase Results

| Phase | Status | Notes |
|-------|--------|-------|
| 1. Prepare skills | PASS | 3 skills adapted (credentials, bitcoin-wallet, alive-check) + bootstrap |
| 2. Deploy engine | PASS | rsync to VM, Bun installed, directory structure verified |
| 3. Configure identity | PASS | SOUL.md, .env, credentials, MEMORY.md all configured |
| 4. Install services | PASS | systemd timers installed, sensors running, test task created |
| 5. Update fleet config | PASS | Arc's ssh.ts and web.ts updated: Spark IP .12 -> .16 |

## Phase 1: Skills Preparation

**Skills copied from arc-starter to engine:**

1. **credentials** (was `arc-credentials`): Rewrote CLI to use engine's `src/credentials.ts` (PBKDF2-SHA256 + AES-256-GCM). Removed arc-starter's `store.ts` -- engine has its own credential store at `~/.agent-runtime/credentials.enc` using `ART_CREDS_PASSWORD`.

2. **bitcoin-wallet** (kept name): Updated all 5 files (cli.ts + 4 runners). Key change: replaced hardcoded `../../github/aibtcdev/skills` path with configurable `AIBTCDEV_SKILLS_PATH` env var, falling back to `github/aibtcdev/skills/` relative to project root. All static imports converted to dynamic `import()` for runtime path resolution.

3. **alive-check** (was `arc-alive-check`): Renamed sensor name from `arc-alive-check` to `alive-check`, updated task source to `sensor:alive-check`. Added required `skills` field (`["alive-check"]`) for engine's NOT NULL constraint.

**Validation:** All files pass `bun build --no-bundle` syntax check.

## Phase 2: VM Deployment

**Prerequisites installed:** unzip, tmux, jq, Bun 1.3.11

**Engine transferred via rsync:**
```
rsync -avz --exclude .git --exclude node_modules --exclude 'db/*.db' --exclude 'db/*.sqlite'
```

42 files transferred. No dependencies to install (package.json has empty dependencies).

## Phase 3: Identity Configuration

- **ART_CREDS_PASSWORD:** Generated via `openssl rand -base64 32` (stored in `.env`, chmod 600)
- **SOUL.md:** Written with Spark's identity (spark0.btc, SP3CPCZAG3N4MJQC4FZFTBK2VQN31MV2DQ9DFTE6N, bc1qk7ksx...)
- **Credentials stored:** bitcoin-wallet/password, bitcoin-wallet/id, bitcoin-wallet/mnemonic
- **MEMORY.md:** Initialized with minimal content
- **Identity parsed correctly:** `art status` shows "agent: spark"

## Phase 4: Services & Validation

- **art symlink:** `~/.local/bin/art` -> `/home/dev/agent-runtime/bin/art`
- **Linger:** Enabled for user `dev`
- **Services installed:** art-sensors.timer (active), art-dispatch.timer (disabled -- no Claude auth yet)
- **Sensors:** alive-check sensor ran, created task #1 "system alive check"
- **Test task:** #4 "Engine validation: hello from Spark" created successfully
- **Dispatch timer disabled** to prevent noise until Claude auth is configured

## Phase 5: Fleet Config Updated

On Arc's machine (`/home/dev/arc-starter`):
- `src/ssh.ts`: Spark IP changed from `192.168.1.12` to `192.168.1.16`
- `src/web.ts`: Fleet roster updated with new IP and BTC address prefix

**Connectivity verified:** SSH from Arc to Spark at .16 works, `art status` returns correctly.

## Decisions Made

1. **Disabled dispatch timer immediately** -- Without Claude Code auth, every dispatch cycle would fail and create noise tasks. Sensor timer left running (alive-check is harmless).

2. **bitcoin-wallet: dynamic imports** -- Converted static `import` to dynamic `import()` with runtime-resolved paths. This lets the engine work even without the aibtcdev/skills repo present (the CLI gives a clear error message about cloning it).

3. **No `store.ts` in credentials skill** -- The engine already has `src/credentials.ts` with a different (and cleaner) API. The skill's CLI just wraps that module. No duplication.

4. **Engine DB is `db/agent.sqlite`** (not `db/tasks.db` as mentioned in quest spec) -- the engine uses a different filename. This is correct and intentional.

## What Worked Well

- Engine is clean and self-contained. Zero external dependencies. Fresh `bun install` not even needed.
- Identity from SOUL.md parsed correctly on first boot.
- Credential store initialized correctly with PBKDF2 on first unlock.
- Sensor timer created task autonomously within 1 minute of installation.
- `art` CLI is fully functional via symlink.

## What Needed Fixing

- `sshpass -p` doesn't handle `#` in passwords well. Used `SSHPASS` env var with `-e` flag instead.
- Non-interactive SSH shells don't source `.bashrc`. Added PATH export to make `art` available.
- Alive-check sensor initially didn't include `skills` field -- engine requires it (NOT NULL). Fixed in sensor code.

## Operator TODO (Tomorrow)

1. **Install Claude Code on Spark VM:**
   ```bash
   ssh dev@192.168.1.16
   bun add -g @anthropic-ai/claude-code
   ```

2. **Authenticate Claude Code:**
   ```bash
   claude login  # or set ANTHROPIC_API_KEY in .env
   ```

3. **Re-enable dispatch timer:**
   ```bash
   systemctl --user enable --now art-dispatch.timer
   ```

4. **Clone aibtcdev/skills for wallet operations:**
   ```bash
   cd /home/dev/agent-runtime
   mkdir -p github/aibtcdev
   git clone https://github.com/aibtcdev/skills github/aibtcdev/skills
   cd github/aibtcdev/skills && bun install
   ```

5. **Initialize git repo (if desired):**
   ```bash
   cd /home/dev/agent-runtime
   git init && git add -A && git commit -m "feat: initial Spark deployment"
   ```

6. **Add more skills as needed** -- start with DeFi skills (defi-bitflow, zest-v2, etc.)

7. **Clean up noise tasks:**
   ```bash
   art tasks close --id 3 --status failed --summary "Dispatch test before Claude auth"
   ```

## Reusable Steps for Next Agent

To deploy another agent (e.g., Iris at 192.168.1.13):

1. SSH to target VM, install prerequisites: `sudo apt install unzip tmux jq && curl -fsSL https://bun.sh/install | bash`
2. From Arc: `rsync -avz --exclude .git --exclude node_modules --exclude 'db/*.sqlite*' /home/dev/aibtc/agent-runtime/ dev@<IP>:/home/dev/agent-runtime/`
3. On target VM:
   - Generate password: `openssl rand -base64 32`
   - Create `.env` with `ART_CREDS_PASSWORD=<password>`
   - Write `SOUL.md` with agent identity
   - Store wallet credentials: `art creds set --service bitcoin-wallet --key password --value ...`
   - Create `memory/MEMORY.md`
   - Create symlink: `ln -sf /home/dev/agent-runtime/bin/art ~/.local/bin/art`
   - Enable linger: `sudo loginctl enable-linger dev`
   - Install services: `art services install`
   - Disable dispatch: `systemctl --user stop art-dispatch.timer && systemctl --user disable art-dispatch.timer`
4. On Arc: update `src/ssh.ts` and `src/web.ts` with new IP
5. Operator: install Claude Code, authenticate, re-enable dispatch

**Time per deployment (after first): ~10 minutes** (mostly waiting for Bun install and rsync).

## Files Modified on Arc

- `/home/dev/arc-starter/src/ssh.ts` -- Spark IP 192.168.1.12 -> 192.168.1.16
- `/home/dev/arc-starter/src/web.ts` -- Fleet roster Spark IP updated

## Files Created in Engine

- `/home/dev/aibtc/agent-runtime/skills/credentials/` -- SKILL.md, AGENT.md, cli.ts
- `/home/dev/aibtc/agent-runtime/skills/bitcoin-wallet/` -- SKILL.md, AGENT.md, cli.ts, sign-runner.ts, bns-runner.ts, stx-send-runner.ts, x402-runner.ts
- `/home/dev/aibtc/agent-runtime/skills/alive-check/` -- SKILL.md, sensor.ts
