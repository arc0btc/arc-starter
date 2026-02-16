# systemd Service Setup

Run Arc Starter as a systemd user service for automatic startup and restart on failure.

---

## Installation

### 1. Install the Service

```bash
# Copy service file to systemd user directory
mkdir -p ~/.config/systemd/user
cp systemd/arc-starter.service ~/.config/systemd/user/

# Reload systemd
systemctl --user daemon-reload
```

### 2. Customize (Optional)

Edit `~/.config/systemd/user/arc-starter.service` to:

- Change `WorkingDirectory` if not `%h/arc-starter`
- Adjust `MemoryMax` and `CPUQuota` resource limits
- Add environment variables
- Change port (default: 3000)

### 3. Enable and Start

```bash
# Enable (start on boot)
systemctl --user enable arc-starter

# Start now
systemctl --user start arc-starter

# Check status
systemctl --user status arc-starter
```

---

## Commands

### Status

```bash
# Check if running
systemctl --user status arc-starter

# See recent logs
journalctl --user -u arc-starter -n 50

# Follow logs in real-time
journalctl --user -u arc-starter -f
```

### Control

```bash
# Start
systemctl --user start arc-starter

# Stop
systemctl --user stop arc-starter

# Restart
systemctl --user restart arc-starter

# Disable (prevent auto-start)
systemctl --user disable arc-starter
```

### Logs

```bash
# Last 100 lines
journalctl --user -u arc-starter -n 100

# Logs since boot
journalctl --user -u arc-starter -b

# Logs from last hour
journalctl --user -u arc-starter --since "1 hour ago"

# Follow logs
journalctl --user -u arc-starter -f

# Export logs
journalctl --user -u arc-starter > arc-logs.txt
```

---

## Configuration

### Environment Variables

Add environment variables to the service file:

```ini
[Service]
Environment="NODE_ENV=production"
Environment="PORT=3000"
Environment="DISCORD_TOKEN=your_token"
```

Or use an environment file:

```ini
[Service]
EnvironmentFile=%h/arc-starter/.env
```

Then create `~/.arc-starter/.env`:

```env
NODE_ENV=production
PORT=3000
DISCORD_TOKEN=your_token
```

**Never commit `.env` to git!**

### Resource Limits

Adjust resource limits in service file:

```ini
[Service]
# Memory limit (default: 512MB)
MemoryMax=1G

# CPU limit (default: 50% of one core)
CPUQuota=100%

# File descriptor limit
LimitNOFILE=65536
```

---

## Automatic Start on Boot

### Enable Lingering

systemd user services normally stop when you log out. To keep them running:

```bash
# Enable lingering for your user
loginctl enable-linger $USER

# Check status
loginctl show-user $USER | grep Linger
```

Now the service will:
- Start on boot (even if you don't log in)
- Keep running after logout
- Restart on failure

---

## Troubleshooting

### Service Won't Start

1. Check syntax:
   ```bash
   systemctl --user status arc-starter
   ```

2. Check logs:
   ```bash
   journalctl --user -u arc-starter -n 50
   ```

3. Test manually:
   ```bash
   cd ~/arc-starter
   bun run src/index.ts
   ```

4. Verify paths:
   ```bash
   # Check working directory exists
   ls -la ~/arc-starter

   # Check bun is at expected location
   which bun
   ```

### Port Already in Use

If port 3000 is taken:

1. Change port in service file:
   ```ini
   Environment="PORT=3001"
   ```

2. Reload and restart:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart arc-starter
   ```

### High Memory Usage

If service uses too much memory:

1. Reduce limit in service file:
   ```ini
   MemoryMax=256M
   ```

2. Reload and restart:
   ```bash
   systemctl --user daemon-reload
   systemctl --user restart arc-starter
   ```

3. Check logs for memory-intensive operations

### Service Keeps Restarting

If service restarts repeatedly:

1. Check failure reason:
   ```bash
   systemctl --user status arc-starter
   ```

2. View full logs:
   ```bash
   journalctl --user -u arc-starter -n 200
   ```

3. Disable auto-restart temporarily:
   ```ini
   [Service]
   Restart=no
   ```

4. Debug the issue, then re-enable

---

## Monitoring

### Health Check

The service exposes `/health` endpoint:

```bash
# Check health
curl http://localhost:3000/health

# Expected response:
{
  "status": "healthy",
  "uptime": 3600,
  "tasks": [
    { "name": "hello-task", "running": true }
  ],
  "timestamp": "2026-02-16T12:00:00.000Z"
}
```

### Automatic Health Monitoring

Create a health check timer:

```bash
# Create health-check.service
cat > ~/.config/systemd/user/arc-health-check.service <<EOF
[Unit]
Description=Arc Starter Health Check

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -f http://localhost:3000/health
EOF

# Create health-check.timer
cat > ~/.config/systemd/user/arc-health-check.timer <<EOF
[Unit]
Description=Arc Starter Health Check Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
EOF

# Enable timer
systemctl --user daemon-reload
systemctl --user enable --now arc-health-check.timer
```

Now health checks run every 5 minutes. Check results:

```bash
journalctl --user -u arc-health-check.service
```

---

## Uninstallation

To remove the service:

```bash
# Stop and disable
systemctl --user stop arc-starter
systemctl --user disable arc-starter

# Remove service file
rm ~/.config/systemd/user/arc-starter.service

# Reload systemd
systemctl --user daemon-reload
```

---

## Resources

- [systemd.service docs](https://www.freedesktop.org/software/systemd/man/systemd.service.html)
- [systemd.exec docs](https://www.freedesktop.org/software/systemd/man/systemd.exec.html)
- [journalctl docs](https://www.freedesktop.org/software/systemd/man/journalctl.html)
