# Test Upgrade Plan

**Goal:** Bring test coverage from 5/24+ modules to cover all high and medium priority src/ files.
**Runtime:** `bun test` with `bun:test` framework (existing pattern).
**Approach:** Three phases — pure functions first, then mocked I/O, then integration.

---

## Current State

Covered: `cli.ts`, `credentials.ts`, `db.ts`, `skills.ts`, `utils.ts`
Missing: everything else (19+ modules)

---

## Phase 1: Pure Function Tests (no mocking needed)

These extract testable logic that takes inputs and returns outputs with no side effects.

### 1.1 `tests/dispatch-core.test.ts`
Test the pure decision logic extracted from `dispatch.ts`:

| Function | What to test |
|----------|-------------|
| `selectModel(task)` | P1-4 → opus, P5-7 → sonnet, P8+ → haiku, explicit model override |
| `calculateApiCostUsd(model, in, out, cache?)` | Token math for each model tier, cache discount, zero tokens |
| `classifyError(errMsg)` | 401/403 → auth, 429 → rate_limited, timeout → subprocess_timeout, 500 → transient, garbage → unknown |
| `parseSkillNames(json)` | Valid JSON array, null, empty string, malformed JSON |

### 1.2 `tests/memory-topics.test.ts`
Test the mapping and keyword logic from `memory-topics.ts`:

| Function | What to test |
|----------|-------------|
| `resolveTopics(skillNames)` | Known skills map correctly, unknown skills return empty, multiple skills merge/dedup topics |
| `extractTaskKeywords(subject, desc?)` | Stop-word removal, short-word filtering (<3 chars), cap at 8 keywords, special char stripping, empty input |

### 1.3 `tests/memory-writeback.test.ts`
Test pattern extraction from `memory-writeback.ts`:

| Function | What to test |
|----------|-------------|
| Pattern extraction | Each regex: root-cause, symptom+fix, pattern, lesson, prevention, architecture |
| `slugify()` | Lowercase, collapse hyphens, max 40 chars, strip special chars |
| Similarity scoring | Jaccard word-overlap at 0.6 threshold — identical, similar, distinct inputs |
| Edge cases | Max 5 learnings cap, content < 20 chars rejected |

---

## Phase 2: Mocked I/O Tests

These need lightweight mocks for file reads or DB queries. Use the existing pattern from `db.test.ts` (in-memory SQLite) where DB is needed.

### 2.1 `tests/dispatch-gate.test.ts`
Mock: file I/O (`readFileSync`/`writeFileSync` → in-memory state object)

| Scenario | What to test |
|----------|-------------|
| Fresh state | No gate file → running, not stopped |
| Consecutive failures | N failures below threshold → still running |
| Threshold breach | N failures at threshold → stopped |
| Immediate stops | rate_limited, auth → stop on first failure (skip threshold) |
| Recovery | Success after stop → reset to running |
| Auto-recovery | Time-based recovery after AUTO_RECOVERY_MS elapsed |
| Gate reset | `resetDispatchGate()` clears all state |

### 2.2 `tests/sensors.test.ts`
Mock: `fetch()`, DB functions, `Bun.file()`/`Bun.write()`

| Function | What to test |
|----------|-------------|
| `fetchWithRetry()` | Success first try, retry on 5xx, no retry on 4xx, max retries exhausted, network error |
| `shouldRun(name, interval)` | First run (no state) → true, within interval → false, past interval → true |
| `claimSensorRun()` | Claims and writes state atomically |
| `insertTaskIfNew()` | Dedup mode "pending" vs "any", subject dedup, returns null when duplicate exists |
| `createTaskIfDue()` | Full flow: skip (interval) → exists (dedup) → created (new task) |

### 2.3 `tests/scratchpad.test.ts`
Mock: file I/O (use temp dir), DB (`getTaskById`)

| Function | What to test |
|----------|-------------|
| `resolveRootTaskId()` | Single task (no parent), 3-level chain, max depth (10) |
| `readScratchpad()` | Missing file → empty, existing file → content |
| `writeScratchpad()` | Creates file, overwrites existing |
| `appendScratchpad()` | Appends with separator |
| `clearScratchpad()` | Removes file, no error on missing |
| `resolveScratchpadContext()` | Returns formatted markdown with task ID header |

### 2.4 `tests/memory-topics-fts.test.ts`
Mock: DB FTS queries, file reads

| Function | What to test |
|----------|-------------|
| `resolveMemoryContext()` | Loads MEMORY.md + correct topic files for skill set |
| `resolveFtsMemoryContext()` | High-importance domain query, keyword search, dedup across result sets, 8k char budget enforcement, bullet formatting + 200 char truncation |

---

## Phase 3: Integration Tests (git/subprocess mocking)

These are higher effort. Use a temp git repo fixture where possible.

### 3.1 `tests/safe-commit.test.ts`
Mock: `Bun.spawn()` for git and systemctl

| Scenario | What to test |
|----------|-------------|
| Syntax validation | Valid .ts → pass, invalid .ts → error list |
| No changes | No staged files → skip commit |
| Clean commit | Stage + commit succeeds, no service death |
| Service death | Commit → service dies → revert → follow-up task created |
| Non-src changes | Memory/skill changes don't trigger service health check |

### 3.2 `tests/worktree.test.ts`
Mock: `Bun.spawn()` for git, file I/O for symlinks

| Function | What to test |
|----------|-------------|
| `createWorktree()` | Correct branch naming, directory creation, symlink setup |
| `validateWorktree()` | Syntax check on changed .ts files, returns error list |
| `mergeWorktree()` | Clean merge → ok, conflict → error message |
| `discardWorktree()` | Removes worktree + branch cleanup |

---

## What NOT to Test

- `dispatch.ts::dispatch()` — subprocess stream-JSON parsing, too tightly coupled to Claude CLI behavior
- `dispatch.ts::runDispatch()` — full orchestrator, ~400 lines of cascading deps. Test its components instead.
- `services.ts` — generates systemd/launchd units, platform-specific
- `web.ts` — dashboard server, low risk
- `cloudflare.ts`, `codex.ts`, `openrouter.ts` — thin API wrappers, test via integration when needed
- `external-watchdog.ts`, `shutdown.ts` — process lifecycle, hard to unit test

---

## Implementation Notes

**Test helpers to build:**
- `createTestDb()` — in-memory SQLite with full schema (extend existing `db.test.ts` pattern)
- `mockFileSystem(files: Record<string, string>)` — in-memory file stub for `readFileSync`/`writeFileSync`
- `mockSpawn(responses: Record<string, {stdout, stderr, exitCode}>)` — `Bun.spawn()` stub keyed by command

**Extraction may be needed:**
Some functions in `dispatch.ts` and `sensors.ts` are not exported. Either:
- Export them (preferred if they're logically independent)
- Or test indirectly through exported functions that call them

**Priority order for implementation:**
1. Phase 1.1 (dispatch-core) — highest-value pure logic, validates model routing + cost tracking
2. Phase 1.2 (memory-topics) — validates context loading correctness
3. Phase 2.1 (dispatch-gate) — validates safety gate behavior
4. Phase 2.2 (sensors) — validates dedup + scheduling correctness
5. Everything else follows naturally

---

## Success Criteria

- All high-priority modules (dispatch core, dispatch-gate, sensors, memory-topics) have tests
- All medium-priority modules (memory-writeback, scratchpad, safe-commit, worktree) have tests
- Tests run in < 5 seconds total (`bun test`)
- No tests touch production DB, network, or git state
- CI can run `bun test` on every PR
