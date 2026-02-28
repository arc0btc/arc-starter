---
name: dashboard
role: subagent-briefing
---

# Dashboard — Subagent Briefing

You are building Arc's live web dashboard. Read SKILL.md for the full design spec. This document covers implementation details for each phase.

## Design Tokens

```css
/* Colors — match arc0btc.com */
--bg:          #000000;
--bg-card:     #0c0c0e;
--text:        #ffffff;
--text-muted:  #E9D4CF;
--accent:      #FEC233;
--accent-deep: #EA9922;
--border:      #1a1a1c;
--success:     #22c55e;
--error:       #ef4444;
--blocked:     #f59e0b;

/* Typography — system fonts */
--font:      -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
--font-mono: "Courier New", "Menlo", "Monaco", monospace;

/* Spacing */
--space-xs: 0.25rem;
--space-sm: 0.5rem;
--space-md: 1rem;
--space-lg: 1.5rem;
--space-xl: 2rem;

/* Breakpoints */
--bp-sm: 640px;   /* mobile landscape */
--bp-md: 768px;   /* tablet / 2-column */
--bp-lg: 1024px;  /* desktop / full grid */
```

## Phase 1: API Server

**File:** `src/web.ts`

Use `Bun.serve()` with a router function. Open SQLite in **read-only mode** (separate connection from dispatch/sensors to avoid WAL conflicts).

```typescript
import { Database } from "bun:sqlite";

const db = new Database("db/arc.sqlite", { readonly: true });
db.exec("PRAGMA busy_timeout = 5000");
```

**Endpoints to implement:**

### GET /api/status
```json
{
  "pending": 12,
  "active": 1,
  "completed_today": 38,
  "failed_today": 2,
  "cost_today_usd": 15.97,
  "api_cost_today_usd": 46.94,
  "last_cycle": { "started_at": "...", "task_id": 92, "duration_ms": 248702 },
  "uptime_hours": 12.5
}
```

### GET /api/tasks?status=pending&limit=20
```json
{
  "tasks": [
    {
      "id": 93, "subject": "...", "priority": 1, "status": "pending",
      "source": "task:73", "skills": ["ceo-review"],
      "created_at": "...", "cost_usd": 0
    }
  ]
}
```

### GET /api/tasks/:id
Full task object including result_summary and result_detail.

### GET /api/cycles?limit=10
```json
{
  "cycles": [
    {
      "id": 79, "task_id": 92, "started_at": "...", "completed_at": "...",
      "duration_ms": 248702, "cost_usd": 1.17, "tokens_in": 3800000, "tokens_out": 79000
    }
  ]
}
```

### GET /api/sensors
Read all JSON files from `db/hook-state/`. Merge with skill metadata (interval, description) from `skills/*/SKILL.md` frontmatter.

### GET /api/skills
Parse all `skills/*/SKILL.md` frontmatter. Return name, description, tags, has_sensor, has_cli.

### GET /api/costs?range=day
Aggregate from cycle_log: sum cost_usd, api_cost_usd, tokens_in, tokens_out grouped by hour.

### GET /api/identity
Static response from SOUL.md data:
```json
{
  "name": "Arc",
  "bns": "arc0.btc",
  "btc": "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
  "stx": "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
  "github": "arc0btc",
  "twitter": "arc0btc",
  "website": "arc0.me"
}
```

### GET /api/events (SSE)
Server-Sent Events stream. Poll DB every 5 seconds, emit:
- `task:created` — new task appeared
- `task:completed` — task finished
- `task:failed` — task failed
- `cycle:started` — dispatch cycle began
- `cycle:completed` — dispatch cycle ended
- `sensor:ran` — sensor executed (check hook-state mtime)

**Server setup:**
```typescript
const PORT = parseInt(process.env.ARC_WEB_PORT || "3000");

Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    // Route to handlers...
  },
});
```

Serve static files from `src/web/` for the frontend. Use `Bun.file()` for efficient static serving.

---

## Phase 2: Frontend Shell

**File:** `src/web/index.html`

Single HTML file. All CSS inline in `<style>`. All JS inline in `<script>`. No external dependencies. No build step.

**Layout structure:**
```html
<body>
  <header class="header">
    <!-- Avatar, name, status dot, cost ticker, nav links -->
  </header>
  <main class="container">
    <section id="feed" class="section"><!-- Activity Feed --></section>
    <section id="sensors" class="section"><!-- Sensor Grid --></section>
    <section id="metrics" class="section"><!-- Dispatch Metrics --></section>
    <section id="skills" class="section"><!-- Skill Catalog --></section>
    <section id="identity" class="section"><!-- Identity Card --></section>
  </main>
  <footer class="footer">
    <!-- arc0.me link, version, uptime -->
  </footer>
</body>
```

**Mobile-first CSS grid:**
```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--space-md);
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-lg);
}

@media (min-width: 768px) {
  .container {
    grid-template-columns: 1fr 1fr;
  }
  #feed { grid-column: 1 / -1; }  /* Full width */
}

@media (min-width: 1024px) {
  .container {
    grid-template-columns: 2fr 1fr;
  }
}
```

**Card component:**
```css
.card {
  background: var(--bg-card);
  border-left: 4px solid var(--accent);
  padding: var(--space-lg);
  border-radius: 2px;
}
```

---

## Phase 3: Dashboard Views

### Activity Feed
- Fetch `/api/tasks?limit=30` on load
- Render newest first as card list
- Status badges: pending=gray, active=gold+pulse, completed=green, failed=red, blocked=orange
- Each card shows: status dot, subject, source pill, age (relative time)
- Click expands to show description, result_summary, cost, duration
- Active task has animated gold left-border (CSS pulse)

### Sensor Grid
- Fetch `/api/sensors` on load
- Render as responsive grid (2-col mobile, 3-col tablet, 4-col desktop)
- Each card: sensor name, interval badge, last run relative time, status dot
- Status dot: green=ok (last 2x interval), red=error, gray=stale
- Pulse animation on recently-run sensors (CSS animation)

### Dispatch Metrics
- Fetch `/api/status` + `/api/costs?range=day`
- Key numbers as large stat cards: cycles today, success %, avg duration, queue depth
- Simple cost bar chart (hourly breakdown) using CSS bars (no chart library)
- Token throughput as formatted numbers

### Skill Catalog
- Fetch `/api/skills`
- Card grid with name, one-line description, tag pills in gold
- Show sensor badge if has_sensor, CLI badge if has_cli

### Identity Card
- Fetch `/api/identity`
- Arc avatar, BNS name, addresses (truncated with copy button)
- Links to block explorers, GitHub, X/Twitter

---

## Phase 4: Live Updates

### SSE Connection
```javascript
const events = new EventSource('/api/events');
events.addEventListener('task:created', (e) => {
  const task = JSON.parse(e.data);
  prependToFeed(task);
});
events.addEventListener('cycle:completed', (e) => {
  refreshMetrics();
});
```

### Animations
- New tasks slide in from top with fade
- Completed tasks get a green flash then fade to muted
- Sensor dots pulse on activity
- Cost ticker increments smoothly
- Active task border pulses gold

### Auto-refresh fallback
If SSE disconnects, fall back to polling every 10 seconds.

---

## Phase 5: Service Integration

### Add web service to `src/services.ts`

**systemd unit:**
```ini
[Unit]
Description=Arc Web Dashboard

[Service]
Type=simple
ExecStart={bunPath} {projectRoot}/src/web.ts
Restart=on-failure
Environment=ARC_WEB_PORT=3000

[Install]
WantedBy=default.target
```

**launchd plist:** Similar, with `KeepAlive=true`.

### Update `arc services install/uninstall/status` to include web service.

### CLI commands
```
arc skills run --name dashboard -- start [--port 3000]
arc skills run --name dashboard -- stop
```

---

## Guidelines

- **No dependencies.** No npm packages, no framework, no build step. Vanilla HTML/CSS/JS + Bun.serve().
- **Read-only DB.** The dashboard never writes to SQLite. It only reads.
- **Mobile-first.** Every element must work on a 375px screen before scaling up.
- **Performance.** Page should load in <100ms. No large assets. Inline everything.
- **Accessibility.** Semantic HTML, sufficient contrast (gold on black passes WCAG AA for large text), keyboard navigable.
- **Match arc0btc.com.** Black + gold palette, left-border cards, system fonts, no decorative elements.
- **Fun.** Pulse animations, live updates, smooth transitions. This should feel alive.
