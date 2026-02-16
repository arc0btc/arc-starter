# Arc Starter - AI Agent Instructions

Instructions for Claude Code and other AI agents working on this repository.

---

## Project Overview

**arc-starter** is a standalone template for building autonomous agents with the Arc architecture. It's built with Bun, Hono, and TypeScript.

Key characteristics:
- Always-running server (not cron jobs)
- Event-driven architecture (loose coupling)
- Internal task scheduler (no external dependencies)
- Composable components (sensors, query tools, channels)

This is a **template repo** - designed to be copied, customized, and deployed. Not a library or framework.

---

## Architecture Quick Reference

### Core Components

```
src/
├── index.ts              # Entry point - registers tasks, starts server
├── server/
│   ├── index.ts          # Hono HTTP server
│   ├── events.ts         # Event bus (TypedEventBus)
│   └── scheduler.ts      # Task scheduler (setInterval-based)
├── sensors/
│   └── example-sensor.ts # Observation layer (watch external world)
├── query-tools/
│   └── example-query.ts  # Query layer (on-demand lookups)
└── channels/
    └── discord/          # Communication layer (bidirectional)
```

### Data Flow

```
Scheduler triggers task → Sensor observes → Emits event →
Query tool processes → Channel communicates → Event emitted
```

---

## How to Add a Sensor

Sensors observe the external world and emit events. They're stateless and fast.

### Pattern

```typescript
import { eventBus } from "../server/events";

export async function observeSomething(): Promise<Observation> {
  // 1. Fetch external data
  const data = await fetchFromAPI();

  // 2. Structure observation
  const observation: Observation = {
    source: "my-sensor",
    timestamp: Date.now(),
    data,
  };

  // 3. Emit event
  eventBus.emit("sensor:observation", observation);

  return observation;
}
```

### Register with Scheduler

In `src/index.ts`:

```typescript
import { observeSomething } from "./sensors/my-sensor";
import { scheduler, minutes } from "./server/scheduler";

scheduler.register({
  name: "my-sensor",
  intervalMs: minutes(5),
  fn: observeSomething,
});
```

### Key Principles

- **Stateless**: No memory between executions
- **Fast**: Should complete in <1 second
- **Event-driven**: Always emit an event with results
- **Error handling**: Wrap API calls in try/catch
- **Typed**: Use TypeScript interfaces for observations

### Common Sensor Types

- **API Polling**: GitHub activity, blockchain events, social media
- **Webhook Receivers**: Incoming HTTP events (add Hono route in server/index.ts)
- **File Watchers**: Monitor local file system
- **Database Streams**: React to database changes

---

## How to Add a Query Tool

Query tools provide on-demand lookups and transformations. They're composable and focused.

### Pattern

```typescript
export async function queryMyData(id: string): Promise<MyResult> {
  // 1. Validate input
  if (!id) throw new Error("ID required");

  // 2. Perform lookup
  const data = await database.find(id);

  // 3. Transform and return
  return {
    id,
    found: !!data,
    data,
  };
}
```

### Use from API Endpoint

In `src/server/index.ts`:

```typescript
import { queryMyData } from "./query-tools/my-query";

app.get("/api/data/:id", async (c) => {
  const id = c.req.param("id");
  const data = await queryMyData(id);
  return c.json(data);
});
```

### Key Principles

- **Request-response**: Takes input, returns output
- **Composable**: Query tools can call other query tools
- **Focused**: One concern per function
- **Pure**: Same input → same output (when possible)
- **Typed**: Strong TypeScript types for inputs/outputs

### Common Query Tool Types

- **Database Queries**: Lookup records, aggregate data
- **API Lookups**: Fetch external data on demand
- **Transformations**: Convert data formats
- **Command Handlers**: Execute actions (send message, update state)

---

## How to Add a Channel

Channels connect your agent to external communication platforms. They're bidirectional and handle protocol translation.

### Pattern

```typescript
import { eventBus } from "../../server/events";

export class MyChannel {
  constructor(private config: MyConfig) {}

  async connect(): Promise<void> {
    // 1. Connect to external platform
    await this.client.connect();

    // 2. Listen to external messages
    this.client.on("message", (msg) => {
      eventBus.emit("channel:message", {
        channel: "my-channel",
        message: msg.content,
      });
    });

    // 3. Listen to internal events
    eventBus.on("task:completed", (payload) => {
      this.sendMessage(`✅ Task completed: ${payload.taskName}`);
    });
  }

  sendMessage(content: string): void {
    // Send to external platform
    this.client.send(content);
  }
}
```

### Initialize in src/index.ts

```typescript
import { MyChannel } from "./channels/my-channel";

const channel = new MyChannel({
  token: process.env.MY_CHANNEL_TOKEN || "",
});

await channel.connect();
```

### Key Principles

- **Bidirectional**: Receive messages, send responses
- **Protocol Translation**: External format ↔ internal events
- **Event-driven**: Both directions use event bus
- **Graceful Degradation**: Handle missing credentials
- **Separate Concerns**: Connection logic separate from message handling

### Common Channel Types

- **Discord**: Rich UI, real-time communication
- **Telegram**: Simple, mobile-friendly
- **Slack**: Workspace integration
- **CLI**: Direct terminal interface
- **Web UI**: Browser-based control panel

---

## Event Bus Patterns

### Event Types

Defined in `src/server/events.ts`:

```typescript
export interface EventPayloads {
  "server:started": { port: number; uptime: number };
  "server:stopped": { uptime: number };
  "task:started": { taskName: string; timestamp: number };
  "task:completed": { taskName: string; duration: number };
  "task:failed": { taskName: string; error: string };
  "sensor:observation": { source: string; data: unknown };
  "channel:message": { channel: string; message: string };
}
```

### Adding New Event Types

1. Add to `EventPayloads` interface
2. Emit where appropriate
3. Listen where needed

### Wildcard Listeners

Listen to all events:

```typescript
eventBus.onAny((event, payload) => {
  console.log(`[Event] ${event}:`, payload);
});
```

**Note:** The `onAny` implementation manually emits to `"*"` listeners because Node.js EventEmitter doesn't support wildcard routing natively.

---

## Testing

### Framework

Uses **bun:test** (built-in testing framework).

```typescript
import { describe, test, expect } from "bun:test";
```

### Run Tests

```bash
bun test
```

### Testing Patterns

#### Test Sensors

```typescript
import { describe, test, expect } from "bun:test";
import { observeTime, type Observation } from "../sensors/example-sensor";

describe("observeTime", () => {
  test("returns observation with correct structure", async () => {
    const obs: Observation = await observeTime();

    expect(obs.source).toBe("time-sensor");
    expect(obs.timestamp).toBeGreaterThan(0);
    expect(obs.data).toBeDefined();
  });
});
```

#### Test Query Tools

```typescript
import { describe, test, expect } from "bun:test";
import { queryStatus } from "../query-tools/example-query";

describe("queryStatus", () => {
  test("returns status object", () => {
    const status = queryStatus();

    expect(status.status).toBe("running");
    expect(status.uptime).toBeGreaterThanOrEqual(0);
    expect(status.timestamp).toBeDefined();
  });
});
```

#### Test Event Emissions

```typescript
import { describe, test, expect } from "bun:test";
import { eventBus } from "../server/events";

describe("event bus", () => {
  test("emits sensor:observation event", async () => {
    let received = false;

    const listener = () => {
      received = true;
    };

    eventBus.on("sensor:observation", listener);
    eventBus.emit("sensor:observation", {
      source: "test",
      data: {},
    });

    expect(received).toBe(true);
  });
});
```

### Testing Conventions

- **Unit tests**: Test individual functions
- **Integration tests**: Test component interactions (sensor → event → handler)
- **No mocking by default**: Use real implementations where possible
- **Fast tests**: Should complete in <100ms each
- **Focused assertions**: One concept per test

---

## Configuration

### Config Pattern

Use `config/config.json` (copy from `example-config.json`):

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

### Secrets Handling

- **Never commit secrets** to git
- Use `env:VAR_NAME` pattern in config
- Load from environment variables
- Add to `.gitignore`

---

## Development Workflow

### Start Development Server

```bash
bun run dev
```

- Hot reload enabled
- Logs to console
- Runs on port 3000 (override with `PORT` env var)

### Check Health

```bash
curl http://localhost:3000/health
```

Returns:
- Server status
- Uptime
- Registered tasks
- Timestamp

### Build for Production

```bash
bun run build
```

Creates `dist/index.js` (single-file executable).

---

## Commit Conventions

Use **conventional commits** format:

```
type(scope): subject

body (optional)
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code restructuring (no behavior change)
- `chore`: Build, CI, or maintenance tasks

### Examples

```
feat(sensor): add GitHub activity sensor
fix(scheduler): prevent task overlap
docs(readme): add deployment instructions
test(sensor): add tests for time sensor
refactor(events): extract event types to separate file
chore(deps): update hono to 4.11.0
```

---

## Common Tasks

### Add Environment Variable

1. Add to `.env` (local development)
2. Reference in code: `process.env.VAR_NAME`
3. Document in README or config/example-config.json

### Add HTTP Endpoint

In `src/server/index.ts`:

```typescript
app.get("/api/endpoint", async (c) => {
  const result = await queryTool();
  return c.json(result);
});
```

### Schedule a Task

In `src/index.ts`:

```typescript
scheduler.register({
  name: "my-task",
  intervalMs: minutes(10),
  fn: myTaskFunction,
});
```

### Listen to Events

```typescript
eventBus.on("event:name", (payload) => {
  // Handle event
});
```

---

## File Structure Conventions

### Naming

- **Modules**: kebab-case (`example-sensor.ts`)
- **Classes**: PascalCase (`DiscordClient`)
- **Functions**: camelCase (`observeTime`)
- **Interfaces**: PascalCase (`Observation`)

### Organization

- **One concern per file**: Sensor file contains sensor logic only
- **Colocate related files**: Discord channel has own directory
- **Export public API**: Only export what's needed by other modules
- **Import from index**: Prefer `import { X } from "./server"` over `"./server/events"`

---

## Troubleshooting

### Server Won't Start

- Check port availability: `lsof -i :3000`
- Check for syntax errors: `bun run build`
- Check logs for error messages

### Task Not Running

- Verify registration in `src/index.ts`
- Check task is enabled (default: true)
- Check scheduler status: `curl localhost:3000/health`

### Events Not Firing

- Verify event name matches `EventPayloads` interface
- Check listener is registered before event emitted
- Use wildcard listener to debug: `eventBus.onAny(...)`

### Tests Failing

- Run tests: `bun test`
- Check imports are correct
- Verify test structure (describe, test, expect)

---

## Key Files

### src/index.ts
- Entry point
- Register tasks
- Set up event listeners
- Start server

### src/server/index.ts
- Hono HTTP server
- API endpoints
- Health check

### src/server/events.ts
- Event bus definition
- Event type definitions
- Wildcard listener support

### src/server/scheduler.ts
- Task scheduler
- Task lifecycle (start, stop, execute)
- Task registration

### config/example-config.json
- Configuration template
- Shows all available options
- Documents secret handling pattern

---

## Resources

- **Bun Docs**: https://bun.sh/docs
- **Hono Docs**: https://hono.dev/
- **Arc Production Repo**: https://github.com/arc0btc/arc-starter
- **ARCHITECTURE.md**: Deep dive into patterns
- **SOUL.md**: Identity and values template

---

## Philosophy

When working on arc-starter, remember:

- **Simple over clever**: Prefer clear code to clever abstractions
- **Composition over complexity**: Combine simple patterns
- **Events for observability**: Emit events liberally
- **Fast feedback loops**: Keep tests and dev server fast
- **Honest documentation**: If something doesn't work, say so

This is a **template**, not a framework. Users will customize everything. Make patterns clear and extensible.

---

## Questions?

- Check ARCHITECTURE.md for pattern deep dives
- Check README.md for user-facing documentation
- Check example files for reference implementations
- Open an issue if something is unclear
