# ordinals-market-data sensor — post-competition simplification plan
*Written: 2026-03-23 | Execute after: 2026-04-22 (competition ends)*

## Problem

`sensor.ts` is 1353 lines. Target: ~400 lines. The sensor should be **fetch + change-detect + queue** only.

## What Grew During Competition Prep

| Block | Lines | Should Move To |
|-------|-------|----------------|
| `ANGLE_DIRECTIVES` record | 49–54 (~6 lines) | `signal-task-template.ts` |
| Narrative thread types + helpers | 80–238 (~160 lines) | `signal-task-template.ts` |
| `buildCrossCategoryContext()` | 252–299 (~50 lines) | `signal-task-template.ts` |
| `buildNarrativeContext()` | 302–317 (~16 lines) | `signal-task-template.ts` |
| Inline task description template (regular signal) | 1220–1269 (~50 lines) | `signal-task-template.ts` |
| Inline task description template (milestone signal) | 1299–~1350 (~50 lines) | `signal-task-template.ts` |

Total extractable: ~330 lines → sensor lands at ~400 lines after extraction + cleanup.

## Proposed New File: `signal-task-template.ts`

Extract into a single helper module:

```ts
// skills/ordinals-market-data/signal-task-template.ts
export const ANGLE_DIRECTIVES: Record<Angle, string> = { ... };
export function buildCrossCategoryContext(...): string { ... }
export function buildNarrativeContext(...): string { ... }
export function buildRegularSignalDescription(signal, angle, deltas, state, history): string { ... }
export function buildMilestoneSignalDescription(signal, state, history): string { ... }
```

`sensor.ts` then imports and calls these:
```ts
import { buildRegularSignalDescription, buildMilestoneSignalDescription } from "./signal-task-template.ts";
```

## Sensor After Refactor (~400 lines)

- Constants and types: ~60 lines
- History helpers (ensureHistory, pushReading, computeDeltas): ~45 lines
- Milestone detection (detectMilestoneCrossed, detectDailyRateMilestone, detectMilestoneSignals): ~115 lines
- Collection event detection (detectCollectionEventSignals): ~120 lines
- 5 fetch functions (fetchInscriptionData, fetchBrc20Data, fetchFeeMarketData, fetchNftFloorData, fetchRunesData): stays ~510 lines → these are intrinsically large, keep as-is
- Main function (ordinalsMarketDataSensor): ~80 lines (simplified — no inline templates)

> Note: The 5 fetch functions account for ~510 lines on their own and are intrinsically complex (API calls + change detection). They stay in sensor.ts. The target is to keep sensor.ts readable by extracting the editorial/template layer, not to aggressively compress the data layer.

## Revised Target

- `sensor.ts`: ~700 lines (fetch/detect/queue — all data logic stays)
- `signal-task-template.ts`: ~330 lines (editorial templates and narrative helpers)
- Combined: ~1030 lines (down from 1353), with cleaner separation of concerns

## Narrative Thread Decision

The `NarrativeThread` state management is tightly coupled to the signal task description format (it feeds `buildNarrativeContext()`). Move the narrative types and all builders to `signal-task-template.ts`. Keep `checkNarrativeWeeklyReset()` in `sensor.ts` since it writes to `state.narrativeThread` — or move it too and import back.

## Do NOT Change During Competition

- Change-detection thresholds (FEE_CHANGE_THRESHOLD_PCT, etc.)
- Category rotation logic
- Cooldown gates
- Daily cap guard
- Signal source keys (break dedup)
- ANGLE_DIRECTIVES content (affects signal quality)
- Any milestone detection logic

## Task Reference

- Source task: #8474 (architect: simplify ordinals-market-data sensor post-competition)
- Source parent: #8422
- Scheduled: create follow-up task after 2026-04-22
