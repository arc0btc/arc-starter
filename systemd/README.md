# systemd Deployment

Run Arc Starter as a systemd timer + oneshot service. The timer fires every 5 minutes and runs one dispatch cycle.

---

## Installation

### 1. Link the service and timer files

```bash
mkdir -p ~/.config/systemd/user/
ln -s ~/arc-starter/systemd/arc-starter.service ~/.config/systemd/user/
ln -s ~/arc-starter/systemd/arc-starter.timer ~/.config/systemd/user/
```

### 2. Enable and start

```bash
systemctl --user daemon-reload
systemctl --user enable --now arc-starter.timer
```

### 3. Verify

```bash
# Check timer status
systemctl --user status arc-starter.timer

# Watch logs
journalctl --user -u arc-starter.service -f
```

---

## How It Works

The timer + oneshot pattern is simpler and more reliable than a persistent process:

```
arc-starter.timer fires every 5 minutes
        │
        ▼
arc-starter.service starts (Type=oneshot)
        │
        ▼
bun src/loop.ts runs one dispatch cycle
        │
        ▼
process exits cleanly
        │
        ▼
timer fires again in 5 minutes
```

Each cycle starts with a clean process. No accumulated state, no memory leaks, no crash recovery needed. If something fails, the next cycle starts fresh.

---

## Commands

```bash
# Check timer (shows next trigger time)
systemctl --user status arc-starter.timer

# Check last service run
systemctl --user status arc-starter.service

# Follow logs
journalctl --user -u arc-starter.service -f

# View last 50 lines
journalctl --user -u arc-starter.service -n 50

# Run one cycle manually (useful for debugging)
bun ~/arc-starter/src/loop.ts

# Stop the timer (pauses automatic execution)
systemctl --user stop arc-starter.timer

# Restart the timer
systemctl --user start arc-starter.timer
```

---

## Configuration

### Secrets

Create `~/arc-starter/.arc-secrets` (never commit this file):

```env
MY_API_KEY=sk-...
STACKS_PRIVATE_KEY=0x...
```

The service loads this file automatically via `EnvironmentFile=`.

### Customizing Paths

If you install arc-starter somewhere other than `~/arc-starter`, edit the service file paths before linking. The `%h` prefix expands to your home directory.

### Keeping Running After Logout

systemd user services stop when you log out by default. To keep the timer running:

```bash
loginctl enable-linger $USER
```

This allows the timer to start on boot and continue after logout.

---

## Troubleshooting

### Timer not firing

```bash
# Check timer is active
systemctl --user list-timers

# Check for errors
journalctl --user -u arc-starter.timer
```

### Service fails immediately

```bash
# View exit reason
systemctl --user status arc-starter.service

# Run manually to see full error output
cd ~/arc-starter && bun src/loop.ts
```

### Bun not found

The service uses the full path `%h/.bun/bin/bun`. If bun is installed elsewhere:

```bash
which bun  # Find the actual path
# Edit service ExecStart to use that path
```

---

## Uninstallation

```bash
systemctl --user stop arc-starter.timer
systemctl --user disable arc-starter.timer
rm ~/.config/systemd/user/arc-starter.service
rm ~/.config/systemd/user/arc-starter.timer
systemctl --user daemon-reload
```
