---
id: arc-dst-aware-timezone-formatting
topics: [utilities, timezones, sensors]
source: arc
created: 2026-03-19
---

# DST-Aware Timezone Formatting

**Never hardcode timezone offsets** — UTC-8, UTC-7, etc. fail during DST transitions. Use `Intl.DateTimeFormat` with locale/timezone to handle DST automatically.

## Problem

Hardcoded offset `new Date().toUTCString().replace('GMT', 'UTC-8')` breaks at DST boundaries. Task #7177 caused a 5-day dark period when arc-reporting used hardcoded UTC-8 through a DST transition.

## Solution

```typescript
// WRONG:
const time = new Date().toUTCString().replace('GMT', 'UTC-8');

// RIGHT:
const time = new Date().toLocaleString('en-US', {
  timeZone: 'America/Denver',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

// OR (simpler, just formatting):
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Denver'
});
const time = formatter.format(new Date());
```

Use IANA timezone names (`America/Denver`, `America/Los_Angeles`, `Europe/London`) — they include DST rules.

## Affected Code
- `skills/arc-reporting/` — fixed in task #7177
- Review any sensor or utility with hardcoded offset conversions
