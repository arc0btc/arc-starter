# Sensor Audit Report — 2026-03-04

## Executive Summary

Audited all 32 sensors across Arc's skill tree. The primary finding: **priority was being used as a proxy for both urgency AND model selection**, creating misaligned task routing (e.g., a trivial heartbeat running on Opus at P1). This audit decouples priority from model selection by adding explicit `model:` fields to every sensor-created task.

**Key changes:**
- Renamed `heartbeat` → `system-alive-check` (clearer intent)
- Added explicit `model:` (opus/sonnet/haiku) to all 32 sensors' task creation calls
- Fixed 4 medium bugs (duplicate email risk, dead code, bare fetch, untrusted input)
- Fixed 6 consistency issues (loggers, imports, SENSOR_NAME mismatch)
- Extracted shared `AIBTC_WATCHED_REPOS` constant
- Tightened stackspot subprocess env inheritance

**Impact:** Tasks now route to the right model tier regardless of priority. A P1 heartbeat gets haiku (trivial work), while a P7 architecture review gets sonnet (needs judgment).

## Findings

### CRITICAL: Priority/Model Coupling
- **Before:** Only 1 of 32 sensors (ceo-review) set `model:` explicitly
- **After:** All 32 sensors set `model:` explicitly on every `insertTask()` call
- **Philosophy:** Priority = urgency. Model = work complexity. They're orthogonal.

### MEDIUM Bugs Fixed
| Bug | Sensor | Fix |
|-----|--------|-----|
| Duplicate email risk | report-email | Write state before send, clear on failure |
| `consecutive_failures` dead code | src/sensors.ts | Removed from HookState interface and claimSensorRun |
| Bare `fetch()` without retry | agent-engagement | Replaced with `fetchWithRetry` |
| Untrusted data in task subjects | aibtc-inbox, email | Truncate to 80 chars, strip control characters |

### LOW/Consistency Fixes
| Issue | Fix |
|-------|-----|
| 6 sensors missing logger | Added `createSensorLogger` to cost-alerting, health, housekeeping, scheduler, reporting, system-alive-check |
| blog-publishing `import * as fs/path` | Replaced with named imports from `node:fs`/`node:path` |
| workflows SENSOR_NAME mismatch | Renamed `workflows-meta` → `workflows`, updated hook-state file |

### Structural Improvements
| Change | Detail |
|--------|--------|
| Shared WATCHED_REPOS | Extracted to `src/constants.ts`, used by github-mentions + aibtc-maintenance |
| Stackspot env vars | Tightened from `...process.env` to explicit `HOME`, `PATH`, `NETWORK` |
| heartbeat → system-alive-check | Clearer name, proper priority (P5) and model (haiku) |

## Per-Sensor Matrix

| Sensor | Priority | Model | Changes |
|--------|----------|-------|---------|
| system-alive-check (was heartbeat) | 5 | haiku | Renamed, P1→P5, added model+logger |
| scheduler | 3 | haiku | Added model+logger |
| ci-status | 3 | sonnet | Added model |
| cost-alerting | 3 | sonnet | Added model+logger |
| failure-triage | 3 | sonnet | Added model |
| health | 2 | haiku | P9→P2, added model+logger |
| github-mentions | 3/5 | sonnet | Added model, shared WATCHED_REPOS |
| quorumclaw | 3 | opus | Added model |
| zero-authority | 3 | opus | Added model |
| aibtc-heartbeat | 1 | haiku | P5→P1, added model |
| aibtc-maintenance | 5 | sonnet | Added model, shared WATCHED_REPOS |
| agent-engagement | 6/7 | sonnet | Added model, fetchWithRetry |
| reporting (watch) | 6 | sonnet | Added model+logger |
| reporting (overnight) | 2 | sonnet | Added model+logger |
| blog-publishing (content) | 6 | sonnet | Added model, Bun imports |
| blog-publishing (draft) | 5 | sonnet | Added model |
| blog-publishing (scheduled) | 6 | haiku | Added model |
| architect | 7 | sonnet | Added model |
| self-audit | 7 | sonnet | Added model |
| stackspot | 8 | haiku | Added model, env tightening |
| release-watcher | 8 | haiku | Added model |
| manage-skills (memory) | 8 | haiku | Added model |
| manage-skills (validation) | 8 | haiku | Added model |
| aibtc-news (signal) | 7 | haiku | Added model |
| aibtc-news (brief) | 5 | sonnet | Added model |
| aibtc-news (streak) | 7 | haiku | Added model |
| aibtc-inbox (normal) | 5 | sonnet | Added model, subject sanitization |
| aibtc-inbox (co-sign) | 4 | opus | Added model |
| bitflow | 7 | haiku | Added model |
| stacks-market | 6 | haiku | Added model |
| worker-logs | 7 | haiku | Added model |
| housekeeping | 7 | haiku | Added model+logger |
| security-alerts | 3-4 | sonnet | Added model |
| workflow-review | 5 | sonnet | Added model |
| workflows | 5 | sonnet | Added model, SENSOR_NAME fix |
| email (whoabuddy) | 1 | sonnet | Added model, subject sanitization |
| email (other) | 5 | haiku | Added model |
| ceo-review | 1 | sonnet | Already set (unchanged) |
| report-email | — | — | State-before-send fix (no task creation) |

## Follow-Up Tasks Recommended

1. **Batch `gh pr list` in aibtc-maintenance → GraphQL** — saves ~384 API calls/day
2. **Batch notification mark-as-read in github-mentions** — saves ~600-900 API calls/day
3. **Refactor aibtc-dev audit to GraphQL** — saves ~60 API calls/day, avoids 90s timeout risk

---
*Generated by sensor audit, 2026-03-04*
