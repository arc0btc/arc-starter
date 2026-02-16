# Arc Architecture

Deep dive into the Arc agent architecture patterns.

---

## Philosophy

Arc is built on three core principles:

1. **Autonomy through continuity** - Agents run continuously, not in isolated cron executions
2. **Loose coupling via events** - Components communicate through events, not direct calls
3. **Composition over complexity** - Simple patterns combine to create sophisticated behavior

---

## The Server Pattern

### Why Always-Running?

Traditional cron-based agents have a problem: **no memory between runs**.

```
❌ Cron Pattern (bad):
Execute → Observe → Decide → Act → Exit
Execute → Observe → Decide → Act → Exit
Execute → Observe → Decide → Act → Exit
       ↑ Complete memory loss between runs
```

Arc agents run continuously:

```
✅ Arc Pattern (good):
Start Server
  ↓
Schedule Tasks
  ↓
Run Continuously ←──┐
  ├─ Observe        │
  ├─ Decide         │
  ├─ Act            │
  └─ Loop back ─────┘
```

### Server Components

#### 1. HTTP Server (Hono)

```typescript
const app = new Hono();

app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    uptime: process.uptime(),
    tasks: scheduler.list(),
  });
});
```

**Why Hono?**
- Fast (built for Bun/Deno/Cloudflare Workers)
- Minimal API surface
- TypeScript-first
- Web standards compliant

**What it provides:**
- Health monitoring (`/health` endpoint)
- Control interface (trigger tasks, query state)
- Webhook receivers (external events)
- Metrics exposure

#### 2. Event Bus

```typescript
export class TypedEventBus extends EventEmitter {
  emit<K extends keyof EventPayloads>(
    event: K,
    payload: EventPayloads[K]
  ): boolean {
    return super.emit(event, payload);
  }
}
```

**Why events?**
- Decouple producers from consumers
- Enable observability (log all events)
- Support multiple listeners (fan-out)
- Easy to add new behaviors without changing existing code

**Pattern:**

```typescript
// Producer (sensor)
eventBus.emit("sensor:observation", {
  source: "github",
  data: { repo: "arc", stars: 1000 },
});

// Consumer (logger)
eventBus.on("sensor:observation", (obs) => {
  console.log(`Observed: ${obs.source}`, obs.data);
});

// Consumer (decision engine)
eventBus.on("sensor:observation", (obs) => {
  if (obs.source === "github") {
    decideAction(obs.data);
  }
});
```

No direct dependencies. Easy to add new consumers without changing producers.

#### 3. Task Scheduler

```typescript
scheduler.register({
  name: "observe-github",
  intervalMs: minutes(5),
  fn: observeGitHub,
});
```

**Why internal scheduler?**
- No external dependencies (no cron, no systemd timer)
- Dynamic task registration (add/remove tasks at runtime)
- Event-driven lifecycle (task:started, task:completed, task:failed)
- Graceful shutdown (stop all tasks before exit)

**Pattern:**

```typescript
// Simple interval
scheduler.register({
  name: "heartbeat",
  intervalMs: minutes(1),
  fn: () => console.log("❤️ alive"),
});

// Complex task with error handling
scheduler.register({
  name: "fetch-data",
  intervalMs: minutes(5),
  fn: async () => {
    try {
      const data = await api.fetch();
      eventBus.emit("sensor:observation", { source: "api", data });
    } catch (error) {
      eventBus.emit("task:failed", { taskName: "fetch-data", error });
    }
  },
});
```

Tasks run automatically, emit events for monitoring, handle errors gracefully.

---

## The Sensor Pattern

Sensors observe the external world and return **observations**.

### Design Principles

1. **Stateless** - Sensors don't remember previous observations
2. **Fast** - Don't block the main loop
3. **Event-driven** - Emit events, don't return values directly
4. **Single responsibility** - One sensor, one data source

### Implementation Pattern

```typescript
export async function observeGitHub(): Promise<void> {
  // 1. Fetch external data
  const repos = await github.listRepos({ watched: true });

  // 2. Transform to observation format
  const observation = {
    source: "github",
    timestamp: Date.now(),
    data: repos.map((r) => ({
      name: r.name,
      stars: r.stargazers_count,
      updated: r.updated_at,
    })),
  };

  // 3. Emit event (don't return)
  eventBus.emit("sensor:observation", observation);
}
```

### Sensor Types

#### Polling Sensors (most common)

```typescript
// Check API every N minutes
scheduler.register({
  name: "twitter-sensor",
  intervalMs: minutes(15),
  fn: observeTwitter,
});
```

#### Webhook Sensors

```typescript
// Receive events from external services
app.post("/webhooks/github", async (c) => {
  const event = await c.req.json();

  eventBus.emit("sensor:observation", {
    source: "github-webhook",
    timestamp: Date.now(),
    data: event,
  });

  return c.json({ received: true });
});
```

#### File Watchers

```typescript
// Watch for file changes
import { watch } from "fs";

watch("./data", (event, filename) => {
  eventBus.emit("sensor:observation", {
    source: "file-watcher",
    data: { event, filename },
  });
});
```

---

## The Query Tool Pattern

Query tools provide **on-demand data** in response to requests.

### Design Principles

1. **Request-response** - Synchronous or async, but always returns
2. **Composable** - Query tools can call other query tools
3. **Focused** - Single concern, clear purpose
4. **Type-safe** - Explicit inputs and outputs

### Implementation Pattern

```typescript
// Simple query
export function queryStatus(): ServerStatus {
  return {
    uptime: process.uptime(),
    tasks: scheduler.list(),
    timestamp: Date.now(),
  };
}

// Async query
export async function queryRepository(name: string): Promise<RepoData> {
  const data = await github.getRepo(name);
  return {
    name: data.name,
    stars: data.stargazers_count,
    lastCommit: data.pushed_at,
  };
}

// Composed query
export async function queryDashboard(): Promise<Dashboard> {
  const status = queryStatus();
  const repos = await queryTopRepos();
  const trends = await queryTrends();

  return { status, repos, trends };
}
```

### Query Tool Usage

#### From API Endpoints

```typescript
app.get("/api/dashboard", async (c) => {
  const data = await queryDashboard();
  return c.json(data);
});
```

#### From Commands (Discord bot, CLI)

```typescript
eventBus.on("channel:message", async (msg) => {
  if (msg.message === "!status") {
    const status = queryStatus();
    discord.reply(formatStatus(status));
  }
});
```

#### From Decision Logic

```typescript
async function decideAction() {
  const repos = await queryTopRepos();
  const shouldAct = repos.some((r) => r.stars > 1000);

  if (shouldAct) {
    // Take action
  }
}
```

---

## The Channel Pattern

Channels connect your agent to external communication platforms.

### Design Principles

1. **Bidirectional** - Receive messages, send responses
2. **Protocol translation** - External format ↔ internal events
3. **Command routing** - Parse commands, dispatch to handlers
4. **Graceful degradation** - Agent works without channels

### Implementation Pattern

```typescript
export class DiscordChannel {
  async connect() {
    // 1. Connect to external service
    await this.client.login(this.token);

    // 2. Translate incoming messages to events
    this.client.on("messageCreate", (msg) => {
      eventBus.emit("channel:message", {
        channel: "discord",
        message: msg.content,
      });
    });

    // 3. Listen to internal events and send externally
    eventBus.on("task:completed", (data) => {
      this.sendMessage(`✅ ${data.taskName} completed`);
    });
  }

  async sendMessage(content: string) {
    // Send to external service
    await this.channel.send(content);
  }
}
```

### Channel Types

#### Real-time (Discord, Telegram, Slack)

- Persistent connection
- Immediate notifications
- Rich formatting (embeds, buttons, threads)
- Command interfaces

#### HTTP-based (Web UI, REST API)

- Request-response
- Stateless
- Cacheable
- Standard protocols

#### File-based (Logs, Reports)

- Asynchronous
- Historical record
- Easy to process
- No external dependencies

---

## Event Flow

Here's how all the pieces work together:

```
1. Server starts
   ↓
2. Scheduler registers tasks
   ↓
3. Task runs (sensor)
   ├─ Observe external system
   ├─ Emit sensor:observation event
   └─ Task completes
   ↓
4. Event handlers react
   ├─ Logger: Write to file
   ├─ Decision engine: Evaluate observation
   └─ Channel: Send notification
   ↓
5. Decision triggers action
   ├─ Query tool: Get additional data
   ├─ Emit action:executed event
   └─ Update state
   ↓
6. Repeat from step 3
```

No component directly calls another. Everything flows through events.

---

## State Management

Arc agents have multiple state layers:

### 1. In-Memory State

```typescript
// Process state
const uptime = process.uptime();
const tasks = scheduler.list();

// Event history (recent)
const recentEvents: Event[] = [];
eventBus.onAny((event, payload) => {
  recentEvents.push({ event, payload, timestamp: Date.now() });
  if (recentEvents.length > 100) recentEvents.shift();
});
```

**Lifetime:** Process restart clears this state

### 2. File-Based State

```typescript
// Identity (doesn't change)
const soul = await Bun.file("SOUL.md").text();

// Configuration (rarely changes)
const config = await Bun.file("config/config.json").json();

// Memory (frequently written)
await Bun.write("memory/recent.json", JSON.stringify(observations));
```

**Lifetime:** Persistent, version controlled (except secrets)

### 3. Database State

```typescript
// Operational history
await db.insert({
  table: "observations",
  data: { source: "github", timestamp, data },
});

// Relationships
await db.insert({
  table: "relationships",
  data: { from: "user1", to: "user2", strength: 0.8 },
});
```

**Lifetime:** Persistent, queryable, analyzable

---

## Error Handling

Errors are events, not exceptions.

```typescript
// Don't throw in tasks
scheduler.register({
  name: "risky-task",
  fn: async () => {
    try {
      await riskyOperation();
    } catch (error) {
      // Emit error event instead of throwing
      eventBus.emit("task:failed", {
        taskName: "risky-task",
        error: error.message,
      });
    }
  },
});

// Handle errors globally
eventBus.on("task:failed", (data) => {
  console.error(`Task failed: ${data.taskName}`, data.error);

  // Optional: notify via channel
  discord.sendMessage(`⚠️ Task failed: ${data.taskName}`);

  // Optional: disable failing task
  if (data.taskName === "critical-task") {
    scheduler.stop(data.taskName);
  }
});
```

---

## Graceful Shutdown

Always clean up on exit:

```typescript
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}, shutting down...`);

  // 1. Stop accepting new work
  scheduler.stopAll();

  // 2. Disconnect channels
  await discord.disconnect();

  // 3. Flush pending writes
  await db.flush();

  // 4. Emit final event
  eventBus.emit("server:stopped", {
    uptime: process.uptime(),
  });

  // 5. Exit cleanly
  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

---

## Performance Patterns

### 1. Async by Default

```typescript
// Bad: Blocks event loop
const data = fs.readFileSync("data.json");

// Good: Async
const data = await Bun.file("data.json").json();
```

### 2. Parallel Where Possible

```typescript
// Bad: Sequential
const repos = await queryRepos();
const trends = await queryTrends();
const papers = await queryPapers();

// Good: Parallel
const [repos, trends, papers] = await Promise.all([
  queryRepos(),
  queryTrends(),
  queryPapers(),
]);
```

### 3. Rate Limiting

```typescript
let lastCall = 0;
const RATE_LIMIT_MS = 1000;

export async function rateLimitedFetch() {
  const now = Date.now();
  const timeSinceLastCall = now - lastCall;

  if (timeSinceLastCall < RATE_LIMIT_MS) {
    await new Promise((resolve) =>
      setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastCall)
    );
  }

  lastCall = Date.now();
  return await fetch(url);
}
```

---

## Security Patterns

### 1. Never Commit Secrets

```jsonc
// config/config.json
{
  "discord": {
    "token": "env:DISCORD_TOKEN" // Reference env var
  }
}
```

```typescript
// Load from environment
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.warn("Discord disabled - no token");
}
```

### 2. Validate All External Input

```typescript
app.post("/webhook", async (c) => {
  const signature = c.req.header("X-Signature");

  // Validate signature
  if (!verifySignature(signature, await c.req.text())) {
    return c.json({ error: "Invalid signature" }, 401);
  }

  // Process webhook
  const event = await c.req.json();
  handleWebhook(event);
});
```

### 3. Principle of Least Privilege

```typescript
// Read-only by default
export const queryTool = {
  canRead: true,
  canWrite: false,
  canExecute: false,
};

// Explicit write permission
export const actionTool = {
  canRead: true,
  canWrite: true,
  canExecute: false,
  requiresApproval: true,
};
```

---

## Testing Patterns

### 1. Unit Test Query Tools

```typescript
import { describe, test, expect } from "bun:test";
import { queryStatus } from "./query-tools/status";

describe("queryStatus", () => {
  test("returns status object", () => {
    const status = queryStatus();
    expect(status).toHaveProperty("uptime");
    expect(status).toHaveProperty("timestamp");
  });
});
```

### 2. Integration Test Events

```typescript
test("sensor emits observation event", async () => {
  const observations: any[] = [];

  // Listen for event
  eventBus.on("sensor:observation", (obs) => {
    observations.push(obs);
  });

  // Run sensor
  await observeTime();

  // Assert event emitted
  expect(observations).toHaveLength(1);
  expect(observations[0].source).toBe("time-sensor");
});
```

### 3. End-to-End Test Server

```typescript
test("health endpoint returns 200", async () => {
  const response = await fetch("http://localhost:3000/health");
  expect(response.status).toBe(200);

  const data = await response.json();
  expect(data.status).toBe("healthy");
});
```

---

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Secrets never committed to git
- [ ] systemd service installed
- [ ] Health endpoint accessible
- [ ] Logs being written
- [ ] Graceful shutdown tested
- [ ] Resource limits set (memory, CPU)
- [ ] Monitoring/alerting configured
- [ ] Backup strategy for state/memory
- [ ] Rollback plan documented

---

## Next: Read SOUL.md

This doc explained **how** Arc works. [SOUL.md](./SOUL.md) explains **why** - the identity, values, and purpose that guide your agent's behavior.
