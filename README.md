# Arc Starter

A starter template for building autonomous agents with the Arc architecture.

**Built by Arc (arc0.btc) & whoabuddy** • Evolved through 8 phases of agent development on Stacks

---

## What is Arc?

Arc is an architecture for autonomous agents that:
- **Run continuously** (not cron jobs)
- **Schedule their own tasks** (internal scheduler)
- **Communicate via events** (loosely coupled)
- **Integrate with the world** (sensors, channels, query tools)

This starter shows you the patterns without the complexity of a production agent.

---

## Quick Start

```bash
# Install dependencies
bun install

# Start the server
bun run dev

# Check health
curl http://localhost:3000/health

# In another terminal, watch it run
curl http://localhost:3000/
```

The server will start and run a "hello task" every minute. Check the logs to see it in action.

---

## Architecture

Arc agents have three core components:

### 1. Server (always running)

```
src/server/
├── index.ts       # HTTP server (Hono)
├── events.ts      # Event bus
└── scheduler.ts   # Task scheduler
```

**Why a server?** Unlike cron jobs that run and exit, Arc agents are long-running processes. This gives you:
- Internal task scheduling (no external dependencies)
- Real-time event handling
- HTTP endpoints for monitoring and control
- Graceful shutdown

### 2. Sensors (observe the world)

```
src/sensors/
└── example-sensor.ts
```

Sensors watch external systems and return observations:
- API polling (GitHub, Twitter, blockchain)
- Webhook receivers
- File system watchers
- Database change streams

**Pattern:** Stateless, fast, event-driven

### 3. Query Tools (on-demand lookups)

```
src/query-tools/
└── example-query.ts
```

Query tools provide data when asked:
- Database queries
- API lookups
- Data transformations
- Command handlers

**Pattern:** Request-response, composable

### 4. Channels (communicate)

```
src/channels/
└── discord/
    ├── index.ts
    └── README.md
```

Channels connect your agent to the outside world:
- Discord (included as example)
- Telegram, Slack, Matrix
- Web interfaces
- CLI tools

**Pattern:** Bidirectional, protocol translation

---

## Project Structure

```
arc-starter/
├── README.md                    # This file
├── ARCHITECTURE.md              # Deep dive
├── SOUL.md                      # Identity template
├── LICENSE                      # MIT license
│
├── src/
│   ├── index.ts                 # Entry point
│   ├── server/                  # Server core
│   ├── sensors/                 # Observation layer
│   ├── query-tools/             # Query layer
│   └── channels/                # Communication layer
│
├── config/
│   └── example-config.json      # Config template
│
└── systemd/
    ├── arc-starter.service      # systemd service
    └── README.md                # Service setup
```

---

## Development

### Add a Sensor

1. Create `src/sensors/my-sensor.ts`:

```typescript
import { eventBus } from "../server/events";

export async function observeMyThing(): Promise<void> {
  // Your observation logic
  const data = await fetchFromAPI();

  // Emit event
  eventBus.emit("sensor:observation", {
    source: "my-sensor",
    data,
  });
}
```

2. Register as scheduled task in `src/index.ts`:

```typescript
import { observeMyThing } from "./sensors/my-sensor";
import { scheduler, minutes } from "./server/scheduler";

scheduler.register({
  name: "my-sensor",
  intervalMs: minutes(5),
  fn: observeMyThing,
});
```

### Add a Query Tool

1. Create `src/query-tools/my-query.ts`:

```typescript
export async function queryMyData(id: string) {
  // Your query logic
  return await database.find(id);
}
```

2. Use from API endpoint in `src/server/index.ts`:

```typescript
import { queryMyData } from "./query-tools/my-query";

app.get("/api/data/:id", async (c) => {
  const id = c.req.param("id");
  const data = await queryMyData(id);
  return c.json(data);
});
```

### Add a Channel

See `src/channels/discord/README.md` for complete Discord setup.

For other channels:
1. Create `src/channels/mychannel/index.ts`
2. Listen to `eventBus` events
3. Emit `channel:message` events
4. Connect/disconnect in `src/index.ts`

---

## Configuration

Copy `config/example-config.json` to `config/config.json` and customize:

```json
{
  "server": {
    "port": 3000
  },
  "channels": {
    "discord": {
      "enabled": true,
      "token": "env:DISCORD_TOKEN"
    }
  }
}
```

**Secrets:** Use `env:VAR_NAME` pattern, never commit actual secrets.

---

## Deployment

### Local Development

```bash
bun run dev
```

### Production (systemd)

See `systemd/README.md` for complete setup.

Quick version:

```bash
# Install service
sudo cp systemd/arc-starter.service /etc/systemd/user/
systemctl --user daemon-reload
systemctl --user enable arc-starter
systemctl --user start arc-starter

# Check status
systemctl --user status arc-starter

# View logs
journalctl --user -u arc-starter -f
```

---

## Philosophy

Arc agents are **deliberate**, not reactive:
- Most observations don't require action
- Actions should be intentional and traced
- Events enable observability without tight coupling
- Simple patterns scale better than clever abstractions

Read [SOUL.md](./SOUL.md) for identity template and [ARCHITECTURE.md](./ARCHITECTURE.md) for deep dive.

---

## Next Steps

1. **Customize the identity** - Edit `SOUL.md` to define your agent's purpose
2. **Add real sensors** - Connect to APIs, blockchains, social media
3. **Build query tools** - Add database access, data analysis
4. **Set up channels** - Enable Discord, Telegram, or your preferred platform
5. **Deploy to production** - Use systemd service or containerize

---

## Resources

- **Arc (production agent):** [github.com/arc0btc/arc-starter](https://github.com/arc0btc/arc-starter)
- **Arc's website:** [arc0btc.com](https://arc0btc.com)
- **AIBTC Platform:** [aibtc.com](https://aibtc.com)
- **Hono Framework:** [hono.dev](https://hono.dev)
- **Bun Runtime:** [bun.sh](https://bun.sh)

---

## License

MIT License - See [LICENSE](./LICENSE)

Built by Arc (arc0.btc) & whoabuddy

---

## Support

Questions? Ideas? Issues?

- Open an issue on GitHub
- Read the [ARCHITECTURE.md](./ARCHITECTURE.md) for patterns
- Check [SOUL.md](./SOUL.md) for identity guidance
- Join the discussion on [AIBTC platform](https://aibtc.com)

**Remember:** This is a template. Make it yours.
