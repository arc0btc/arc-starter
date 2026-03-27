# Arc v6 Deep Dive Audit Report

**Report ID:** `ARC-AUDIT-2026-03-20T01:30:00Z`
**Date:** 2026-03-20T01:30:00Z
**Auditor:** Claude Opus 4.6 (7 parallel Opus subagents)
**Scope:** Full Arc ecosystem — arc-starter, landing-page, arc-email-worker, arc0btc-worker, arc0me-site, agents-love-bitcoin, worker-logs
**Method:** 7-angle parallel audit: Organization, Code Quality, Security, SpaceX 5 Principles, Context Loading, Best Practices, Simplify

---

## Executive Summary

Arc v6 is a well-architected autonomous agent system with exceptional dependency discipline (2 runtime deps for 10K LOC), clean service architecture (sensor/dispatch/web split), and a sound skill system. However, rapid evolution has introduced significant technical debt concentrated in three areas: (1) `web.ts` — a 3,273-line god file with 8x copy-pasted rate limiters and 50+ route handlers, (2) fleet infrastructure for a suspended fleet consuming context budget and sensor cycles on every dispatch, and (3) security items that must be addressed before any public exposure (dashboard is currently LAN-only + Tailscale, which is an effective control).

**Overall Health: B+** — Strong foundations, needs a cleanup sprint before the next wave of features.

| Area | Rating | Top Issue |
|------|--------|-----------|
| App Organization | 4/5 | web.ts god file (3,273L), skills sprawl (121) |
| Code Quality | 3.5/5 | 8x rate-limit duplication, 60+ swallowed errors, 42x parseFlags copies |
| Security | 3.5/5 | LAN-isolated; add auth before any public tunnel (skill name validation needed now) |
| Context Efficiency | 4/5 | 13% of tasks run with ghost skills (zero context) |
| Best Practices | 3.5/5 | 113 node:fs calls violating Bun-native policy |
| Simplification | 3/5 | ~1,800 lines of removable duplication identified |

---

## 1. App Organization & Architecture

### 1.1 Multi-Repo Layout — Rating: 4/5

The ecosystem is sensibly partitioned:

| Repo | Purpose | Justified? |
|------|---------|------------|
| arc-starter/ | Core agent runtime | Yes — the nucleus |
| landing-page/ | Next.js 15 AIBTC platform | Yes — different runtime/deploy target |
| arc-email-worker/ | CF Worker for email | Yes — isolated deployment |
| arc0btc-worker/ | BTC CF Worker | Yes — separate CF Worker |
| agents-love-bitcoin/ | Community CF Worker | Yes — separate domain |
| worker-logs/ | Logging DO infra | Yes — upstream fork |
| arc0me-site/ | Astro personal site | Yes — separate deploy |
| old-arc0btc-v4-skills/ | Archived v4 skills | No — should be a git tag |

**Issues:**
- `old-arc0btc-v4-skills/` (1MB) has zero references from any active code. Pure dead weight.
- `arc-starter/github/` is 3.6GB of cloned repos inside the agent tree.
- `/home/dev/db/` at the home level has unclear relationship to `arc-starter/db/`.

### 1.2 Module Boundaries — Rating: 4/5

The `src/` directory (23 TypeScript files, 9,860 LOC) has clean separation with one major outlier:

| File | LOC | Role | Clean? |
|------|-----|------|--------|
| web.ts | 3,273 | Web dashboard + API + services + fleet + SSE + static files | **No** |
| db.ts | 1,292 | Schema + all DB queries | Yes (growing) |
| dispatch.ts | 1,132 | Task dispatch engine | Yes |
| cli.ts | 887 | CLI entry point | Yes |
| services.ts | 503 | systemd/launchd installer | Yes |
| sensors.ts | 316 | Sensor runner | Yes |

**Critical:** `web.ts` contains 50+ handler functions across 8+ domains (dashboard, paid services, fleet, arena, roundtable, consensus, email, SSE). The `route()` function alone is a 228-line if/else chain.

**Dependency inversion:** `src/` imports from `skills/` in 3 places — `credentials.ts` depends on `skills/arc-credentials/store.ts`, `cli.ts` imports from `skills/arc-credentials/cli.ts`, and `web.ts` imports from `skills/agent-hub/schema.ts`. Core infrastructure should not depend on skill directories.

### 1.3 Skills Organization — Rating: 3/5

- **121 skills**, 87 sensors, 83 CLIs, 48 AGENT.md files
- **Redundancies found:**
  - `arc-dispatch-eval` vs `arc-dispatch-evals` — one letter difference, overlapping purpose
  - 7 review skills with fuzzy boundaries (CEO, ops, strategy, workflow, blocked, architecture, compliance)
  - 3 reporting skills that form a pipeline (`arc-cost-reporting` + `arc-reporting` + `arc-report-email`)
  - 4 monitoring skills with unclear boundaries
- **12 fleet skills** for a suspended fleet (only `fleet-handoff` is actively used)
- **15 skills never referenced by any task** (arc-bounty-scanner, mempool-watch, etc.)
- **4 context-only skills** with no code (just SKILL.md)

### 1.4 Dependency Management — Rating: 5/5

Exemplary. `arc-starter` has only **2 runtime dependencies** (`@modelcontextprotocol/sdk`, `zod`) for a 10K LOC project. All satellite repos are similarly lean. This is remarkable discipline.

### 1.5 Database Schema — Rating: 4/5

11+ tables, well-normalized with proper WAL mode, busy_timeout, indexes, and parameterized queries throughout.

**Issues:**
- `tasks.result_detail` stores full LLM output as unbounded TEXT — at 455 tasks/day, needs pruning strategy
- `roundtable_*` and `consensus_*` tables are duplicate multi-agent decision mechanisms — likely only one is used
- No schema version tracking
- `PRAGMA foreign_keys = ON` is missing (FKs declared but unenforced)

---

## 2. Code Quality & Technical Debt

### 2.1 Critical Issues

**web.ts rate-limiting boilerplate duplicated 8 times:**
The same ~20-line pattern (dayKey, dayCount, checkRateLimit, incrementCount) is copy-pasted for Ask, Voice Ask, PR Review, Security Audit, Monitor, Feed Premium, Knowledge, and Task API. Plus `getDayKey()` appears 16 times. Total: ~120 lines of pure duplication.

**web.ts is a 3,273-line monolith:**
Contains the entire API surface, 8 independent rate-limiting systems, SSE, static file serving, fleet management, arena, roundtable, consensus, email threads, and a 228-line if/else router.

### 2.2 High Severity Issues

- **`as any` in dispatch.ts line 1088** — violates CLAUDE.md's "No any" rule
- **`any` usage in landing-page** — Stacks API integration layer uses `any` extensively in `lib/identity/stacks-api.ts`
- **60+ silently swallowed errors** — empty `catch {}` blocks across the codebase, 28 in web.ts alone
- **`log()` function duplicated in 30+ files** — identical implementations across skill CLIs and core files
- **`runCommand()` duplicated** in `safe-commit.ts` and `worktree.ts`
- **`parseFlags()` duplicated in 42 skill CLIs** despite canonical version in `src/utils.ts` (~600-800 lines of dead weight)
- **dispatch.ts `runDispatch()` is 400+ lines** — single function handling 4 phases

### 2.3 Medium Severity Issues

- `db` and `dbWrite` in web.ts are the same singleton (false read/write split impression)
- `VALID_DEP_TYPES` duplicated between db.ts and cli.ts
- `handleSensors()` and `handleSensorSchedule()` share ~80% logic (~160 lines of overlap)
- `HookState` index signature `[key: string]: unknown` undermines type safety

### 2.4 Technical Debt Markers

Only 2 actual TODOs found — one in skill template generator (intentional), one in landing-page activity route (performance optimization note). The codebase is clean of FIXME/HACK/WORKAROUND markers.

---

## 3. Security Audit

### 3.1 Network Context

**Note:** This VM is isolated on a private LAN, accessible only via the local network and Tailscale for remote access. The web dashboard is not exposed to the public internet. If public access is ever needed, the plan is to use a Cloudflare Tunnel with GitHub OAuth or similar authentication. This significantly reduces the practical risk of the unauthenticated endpoints — the findings below are rated assuming current LAN-only exposure, but flagged for attention before any public exposure.

### 3.2 Findings — Address Before Public Exposure

**FINDING S-1: Unauthenticated Write Endpoints + DANGEROUS=true**
- `src/web.ts` has no authentication on `POST /api/tasks`, `POST /api/messages`, `POST /api/tasks/:id/kill`, `POST /api/arena/run`, etc.
- `DANGEROUS=true` in `.env` grants Claude Code `--dangerously-skip-permissions` (full system access)
- **Current risk: LOW** — LAN-only + Tailscale means only trusted devices reach the dashboard
- **Risk if exposed: CRITICAL** — must add auth (Cloudflare Tunnel + GitHub OAuth, or Bearer token) before any public tunnel is opened
- **Pre-exposure checklist:** Add auth to write endpoints, restrict CORS, validate skill names

**FINDING S-2: Master Credential Password in .env**
- `ARC_CREDS_PASSWORD` in `.env` is readable by any process on the filesystem
- Decrypts all credentials at `~/.aibtc/credentials.enc` (Anthropic API keys, Cloudflare tokens, email keys)
- **Severity: MEDIUM** — mitigated by VM isolation, but `chmod 600 .env` is still good hygiene

**FINDING S-3: CORS Wildcard on All Dashboard Responses**
- `Access-Control-Allow-Origin: *` on every API response including write endpoints
- **Current risk: LOW** — no untrusted browsers on the LAN
- **Risk if exposed: CRITICAL** — any website could make cross-origin requests to create/kill tasks
- **Pre-exposure action:** Restrict CORS to specific trusted origins

### 3.3 Findings — Address Now (Defense in Depth)

**FINDING S-4: Path Traversal via Skill Names**
- `dispatch.ts` line 200: `readFile(join(SKILLS_DIR, name, "SKILL.md"))` — skill names from task's `skills` column are not sanitized
- Even on LAN, a malformed task (bug or unexpected input) could read arbitrary files
- **Severity: MEDIUM** — not exploitable remotely today, but a code correctness issue worth fixing
- **Remediation:** Validate skill names against `[a-z0-9-]+` regex

### 3.4 Medium/Low Severity Findings

- Fleet auth uses non-timing-safe string comparison (`web.ts` line 2696) — low risk on LAN, fix before exposure
- Email worker admin auth uses non-timing-safe comparison (`index.ts` line 150) — same
- In-memory rate limits reset on process restart (no persistence) — operational, not security-critical on LAN
- No CSP, X-Frame-Options, or X-Content-Type-Options headers — add before public exposure

### 3.5 What's Done Well

- Encrypted credential store (AES-256-GCM + scrypt KDF) — solid implementation
- Bitcoin signature verification is thorough and correct (BIP-137/BIP-322/BIP-340/342)
- SQL injection fully mitigated — parameterized queries throughout
- No secrets committed to git history
- Landing page admin auth uses proper HMAC-based constant-time comparison
- Subprocess spawning uses array args, not shell strings — no command injection
- Model-aware dispatch timeouts with SIGTERM/SIGKILL fallback
- **Network isolation (LAN + Tailscale)** — the most effective security control in the stack

### 3.6 Remediation Priority

| # | Finding | Severity (LAN) | Severity (Public) | Effort | When |
|---|---------|----------------|-------------------|--------|------|
| 1 | Validate skill names in dispatch | Medium | High | Low | Now |
| 2 | Harden .env permissions (`chmod 600`) | Low | Medium | Trivial | Now |
| 3 | Add auth to dashboard write endpoints | Low | Critical | Medium | Before public exposure |
| 4 | Restrict CORS to trusted origins | Low | Critical | Low | Before public exposure |
| 5 | Use timing-safe comparison for fleet/email auth | Low | Medium | Low | Before public exposure |
| 6 | Add security headers (CSP, X-Frame-Options) | Low | Medium | Low | Before public exposure |
| 7 | Persist rate limits to SQLite | Low | Medium | Medium | Before public exposure |

---

## 4. SpaceX 5 Engineering Principles

### Principle 1: Make the Requirements Less Dumb

**Fleet architecture for a solo agent:** The system was built for 5 VMs but only Arc runs. 12 fleet skills, SSH infrastructure (ssh.ts, fleet-web.ts, fleet-status.ts), fleet sections in CLAUDE.md (25 lines) and MEMORY.md (fleet roster, fleet learnings) — all burning context tokens on every dispatch for suspended agents.

**87 sensors — 12+ serve nothing:** 10 fleet sensors SSH into dead agents every 5-30 minutes, all early-returning after checking `isFleetSuspended()`. 12 dynamic imports per minute for nothing.

**3 unreferenced templates:** `fleet-scheduling.md`, `overnight-batch.md`, `repo-deep-dive.md` have zero references anywhere in the codebase.

### Principle 2: Delete the Part

| Candidate | Impact | Action |
|-----------|--------|--------|
| `old-arc0btc-v4-skills/` (1MB) | Zero references | Delete now |
| 11 fleet skills (all except fleet-handoff) | -11 sensor imports/cycle | Archive now |
| Fleet memory files (9 files) | Reduce dispatch context | Archive now |
| 3 unreferenced templates | Remove dead files | Delete now |
| `src/fleet-web.ts` + `src/fleet-web/` | Dead service | Archive soon |
| `src/ssh.ts` | Only used by suspended fleet | Archive soon |
| 5 dead DB tables (roundtable, consensus, fleet_messages) | Unused schemas | Leave (low cost) |
| 15 never-dispatched skills | Wasted sensor cycles | Review and archive |

### Principle 3: Simplify and Optimize

**web.ts (3,273L) must be split:** Into web-server.ts (router + static + SSE), api-dashboard.ts, api-services.ts, api-fleet.ts — or ~4 domain modules.

**Rate limiter deduplication:** Replace 8 copy-pasted rate limiters with a single `DailyRateLimiter` class (~15 lines). Saves ~120 lines.

**MEMORY.md exceeds its own 2K token target:** Currently at ~4,000 tokens. ~40% is historical records that should be archived.

**CLAUDE.md trimming:** The GitHub-is-Arc-Only section (372 tokens) is irrelevant on Arc. SQL schema section (287 tokens) is rarely needed.

### Principle 4: Accelerate Cycle Time

The sensor -> task -> dispatch pipeline is well-designed with reasonable timeouts. Single-task dispatch is a deliberate simplicity choice. The bottleneck is not architecture but the Opus timeout ceiling (30-90 min) blocking the queue.

### Principle 5: Automate

- MEMORY.md consolidation is manual despite a 2K token target — add sensor-based detection
- Dispatch gate auto-reset for transient errors (currently requires `arc dispatch reset`)
- Dead sensor detection (sensors that always return "skip" for 100+ consecutive runs)

---

## 5. Context Loading Analysis

### 5.1 Context Budget Inventory

**Always loaded (every dispatch):**

| File | Tokens | % of 45K Budget |
|------|--------|-----------------|
| SOUL.md | ~1,992 | 4.4% |
| CLAUDE.md | ~4,391 | 9.8% |
| MEMORY.md | ~3,982 | 8.8% |
| Prompt overhead | ~350-1,250 | 0.8-2.8% |
| **Total** | **~10,700-11,600** | **24-26%** |

**Remaining for skills: ~28,400-38,400 tokens** — generous.

### 5.2 SKILL.md Inventory

- 121 files, average 710 tokens, median 623 tokens, max 1,954 tokens
- All under the 2,000-token recommended limit — well-managed
- Even loading 5 largest skills simultaneously = ~7,340 tokens — no budget risk

### 5.3 Critical Finding: Ghost Skills

**13.3% of all tasks (1,024 tasks) referenced non-existent skills** and ran with zero intended context:

| Ghost Skill | Tasks | Likely Intended |
|-------------|-------|-----------------|
| fleet-task-sync | 577 | Renamed/removed |
| crypto-wallet | 143 | `bitcoin-wallet` |
| email-sync | 118 | `arc-email-sync` |
| blog-x-syndication | 77 | Removed |
| arc-cost-alerting | 68 | `arc-cost-reporting` |
| status-report | 41 | `arc-reporting` |

Additionally, **554 tasks had comma-separated skill strings** instead of JSON arrays — these fail `JSON.parse()` and dispatch with empty skill context.

### 5.4 Most-Used Skills (Top 10)

| Rank | Skill | Tasks | % |
|------|-------|-------|---|
| 1 | arc-skill-manager | 1,872 | 24.4% |
| 2 | aibtc-repo-maintenance | 983 | 12.8% |
| 3 | contacts | 615 | 8.0% |
| 4 | fleet-task-sync (ghost) | 577 | 7.5% |
| 5 | fleet-escalation | 576 | 7.5% |
| 6 | bitcoin-wallet | 406 | 5.3% |
| 7 | arc-remote-setup | 375 | 4.9% |
| 8 | arc-email-sync | 292 | 3.8% |
| 9 | arc-reputation | 267 | 3.5% |
| 10 | fleet-health | 267 | 3.5% |

### 5.5 Context Waste

| Target | Current Tokens | Saveable | Method |
|--------|---------------|----------|--------|
| CLAUDE.md GitHub section | 372 | 300 | Remove on Arc |
| CLAUDE.md SQL Schema | 287 | 200 | Move to reference skill |
| MEMORY.md stale learnings | ~1,200 | 800 | Consolidate |
| SOUL.md philosophy sections | ~400 | 200 | Trim |
| **Total saveable** | | **~1,500/dispatch** | |

### 5.6 MEMORY.md Signal-to-Noise

- **Signal-to-noise ratio: 60/40**
- 60% carries active operational value (directives, critical flags, active strategies)
- 40% (~1,600 tokens) are historical records (D4 breach/recovery, cost confirmations, readiness reports)
- File is at ~4,000 tokens, double its documented 2K target

---

## 6. Best Practices Per Technology

### 6.1 Bun — Grade: C+

**Good:** `bun:sqlite`, `Bun.spawn`, `Bun.which`, `Bun.CryptoHasher`, `Bun.Transpiler`, `Bun.file()` in sensors.ts, `import.meta.main`, auto `.env` loading.

**Violation:** 113 `node:fs` calls vs. 24 Bun API calls. CLAUDE.md says "Do not import from `node:*` unless unavoidable" yet nearly every file uses `readFileSync`, `writeFileSync`, `existsSync` from `node:fs`. The sensors.ts file demonstrates the correct pattern but it was not propagated.

**Fix:** Replace `readFileSync(path, "utf-8")` with `await Bun.file(path).text()`, `writeFileSync` with `await Bun.write()`, `existsSync` with `await Bun.file(path).exists()`.

### 6.2 TypeScript — Grade: A-

**Good:** `strict: true`, explicit interfaces, `as const`, `ReadonlySet`, separate Insert/Read types, `bun-types`, `"module"` resolution.

**Violations:** Single `as any` in dispatch.ts:1088. 40+ `as Type` casts on SQLite results (unavoidable for bun:sqlite). `any` in landing-page Stacks API integration.

### 6.3 SQLite — Grade: B+

**Good:** WAL mode, busy_timeout, singleton pattern, safe migrations, comprehensive indexes, parameterized queries, ON CONFLICT upserts, foreign key declarations.

**Missing:** `PRAGMA foreign_keys = ON` (FKs declared but unenforced), no prepared statement caching for hot paths, no `PRAGMA synchronous = NORMAL`, no CHECK constraints on status/priority columns, `updateRow()` uses string interpolation for column names.

### 6.4 Next.js 15 — Grade: A-

**Good:** App Router, proper server/client component separation, `"use client"` correctly applied (28 files), Metadata API, self-documenting API routes, proper middleware with config.matcher, structured data (JSON-LD), font preloading.

**Missing:** No `loading.tsx` or `error.tsx` boundaries, conservative `ES2017` target (should be `ES2022` for CF Workers).

### 6.5 Cloudflare Workers — Grade: B+

**Good:** `compatibility_date` set, `nodejs_compat_v2`, environment separation, service bindings, DO with SQLite, KV dual-indexing, secrets via `wrangler secret put`.

**Issues:** Placeholder KV namespace IDs committed in wrangler.jsonc files, hardcoded `account_id` in arc0me-site, wildcard CORS on all workers.

### 6.6 systemd — Grade: A-

**Good:** User-level units, correct Type (oneshot/simple), Restart=on-failure, WorkingDirectory, EnvironmentFile, journal logging, timer units with OnBootSec/OnUnitActiveSec, cross-platform support.

**Missing:** No `MemoryMax` resource limits (runaway Claude subprocess could consume all RAM), no `Persistent=true` on timers, no `WatchdogSec` on web service.

### 6.7 Git — Grade: B+

**Good:** Comprehensive .gitignore, conventional commits, worktree isolation, auto-revert on service death, pre-commit syntax validation.

**Missing:** No `.gitattributes` file (binary file markers), empty vestigial `arc.db`/`arc.sqlite` at repo root, no git hooks for manual commits.

---

## 7. Simplification Opportunities

### 7.1 Must-Do (Highest Impact)

| # | Change | Location | Lines Saved |
|---|--------|----------|-------------|
| 1 | Extract `DailyRateLimiter` class | web.ts | ~120 |
| 2 | Deduplicate `parseFlags` in 42 skill CLIs | skills/*/cli.ts | ~600-800 |
| 3 | Split web.ts into route modules | web.ts | structural |

### 7.2 Should-Do

| # | Change | Location | Lines Saved |
|---|--------|----------|-------------|
| 4 | Deduplicate handleSensors/handleSensorSchedule | web.ts | ~80 |
| 5 | Shared `createCliLogger` for skills | skills/*/cli.ts | ~90 |
| 6 | Consolidate 4 systemd unit generators into 1 | services.ts | ~80 |
| 7 | Merge handleAsk/handleVoiceAsk (near-identical) | web.ts | ~100 |
| 8 | Extract paid-service handler pattern | web.ts | ~570 |
| 9 | Merge task creation validation | web.ts | ~40 |

### 7.3 Nice-to-Have

| # | Change | Location |
|---|--------|----------|
| 10 | Remove fake db/dbWrite split | web.ts |
| 11 | Extract fleet roster to config file | web.ts |
| 12 | Shared sensor interval parser | web.ts + arc-catalog |

**Total estimated savings: ~1,800 lines** of duplicated/unnecessary code, predominantly in web.ts and skill CLIs.

**The landing-page codebase requires no significant simplification** — it already follows the patterns (centralized rate limiting, domain-specific modules, shared types) that arc-starter needs to adopt.

---

## 8. Prioritized Action Plan

### Tier 1: Do Now (This Week) — Cleanup + Context

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 1 | **Validate skill names** (regex `[a-z0-9-]+`) | Blocks path traversal, code correctness | Low |
| 2 | **Harden .env permissions** (`chmod 600`) | Good hygiene | Trivial |
| 3 | **Fix ghost skills** — add alias map or validation logging | 13% of tasks get correct context | Low |
| 4 | **Archive 11 fleet skills** | -11 sensor imports/cycle | Low |
| 5 | **Consolidate MEMORY.md** to <2K tokens | Save ~1,500 tokens/dispatch | Low |
| 6 | **Delete old-arc0btc-v4-skills/** | Remove 1MB dead code | Trivial |

### Pre-Public-Exposure Gate (Before enabling Cloudflare Tunnel)

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| P1 | **Add auth to dashboard write endpoints** (CF Tunnel + GitHub OAuth or Bearer token) | Required for public access | Medium |
| P2 | **Restrict CORS to trusted origins** | Blocks cross-origin attacks | Low |
| P3 | **Add security headers** (CSP, X-Frame-Options, X-Content-Type-Options) | Defense in depth | Low |
| P4 | **Use timing-safe comparison** for fleet/email auth | Prevents timing attacks | Low |
| P5 | **Persist rate limits to SQLite** | Survives restarts under load | Medium |

### Tier 2: Do Soon (This Month) — Simplification

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 9 | **Split web.ts** into 4 domain modules | Maintainability | Medium |
| 10 | **Extract DailyRateLimiter** class | -120 lines duplication | Low |
| 11 | **Deduplicate parseFlags** across 42 skill CLIs | -600 lines duplication | Medium |
| 12 | **Extract paid-service handler pattern** | -570 lines | Medium |
| 13 | **Move credentials store from skills/ to src/** | Fix dependency inversion | Low |
| 14 | **Add `PRAGMA foreign_keys = ON`** | Enforce FK constraints | Trivial |
| 15 | **Add `MemoryMax=4G`** to dispatch systemd unit | Prevent runaway memory | Trivial |

### Tier 3: Do Later (This Quarter) — Polish

| # | Action | Impact | Effort |
|---|--------|--------|--------|
| 16 | Migrate node:fs calls to Bun APIs | Honor stated Bun-native policy | Medium |
| 17 | Merge redundant skills (dispatch-eval, reviews, reporting) | Reduce skill count by ~8 | Medium |
| 18 | Add task table pruning (archive result_detail) | Prevent unbounded DB growth | Medium |
| 19 | Add schema version tracking | Future-proof migrations | Low |
| 20 | Add security headers (CSP, X-Frame-Options) | Defense in depth | Low |
| 21 | Add .gitattributes for binary files | Git best practice | Trivial |
| 22 | Evaluate experiment.ts value | Potential -334 lines if unused | Low |

---

## 9. Interesting Findings

### 9.1 The Ghost Skill Problem Is Systemic
191 distinct skill names were referenced across 6,686 tasks with skills, but only 121 SKILL.md files exist. **37% of distinct skill names are phantoms** — renamed, removed, or misspelled. The dispatch system silently loads zero context for these, and 554 tasks had comma-separated strings instead of JSON arrays (total parse failure).

### 9.2 arc-skill-manager Is the Universal Companion
Loaded in 24.4% of all tasks. Its ubiquity suggests its core content (4-file pattern, memory protocol) should be part of CLAUDE.md rather than requiring explicit skill attachment.

### 9.3 Context Budget Is Not the Bottleneck
The 40-50K token budget is generous. Even the heaviest skill combination reaches only ~32% of budget. The real constraints are time (5-90 min timeouts) and cost ($200/day cap), not context window. There's room to enrich context without risk.

### 9.4 The Landing Page Is Exemplary
The landing-page codebase already follows every pattern arc-starter needs: centralized rate limiting (54-line utility), domain-specific modules, shared types, proper HMAC auth, KV-persistent rate limits. It's the reference implementation.

### 9.5 Dependency Discipline Is World-Class
2 runtime dependencies for 10K LOC with encrypted credentials, MCP server, 121 skills, 87 sensors, a web dashboard, fleet management, and an email system. The team should be proud of this.

### 9.6 The Security Chain to Watch
The dashboard has no auth on write endpoints + CORS wildcard + unsanitized skill names + DANGEROUS=true. On the current LAN-only + Tailscale setup this is fine — only trusted devices have access. But this chain would become critical if the dashboard were ever exposed publicly (e.g., via Cloudflare Tunnel). The pre-exposure gate checklist in Section 8 captures everything needed. The one item worth fixing now regardless is skill name validation — it's a code correctness issue that prevents bugs even on LAN.

---

## Appendix A: File Metrics

### arc-starter/src/ Lines of Code

| File | LOC |
|------|-----|
| web.ts | 3,273 |
| db.ts | 1,292 |
| dispatch.ts | 1,132 |
| cli.ts | 887 |
| services.ts | 503 |
| experiment.ts | 334 |
| openrouter.ts | 327 |
| sensors.ts | 316 |
| fleet-web.ts | 238 |
| safe-commit.ts | 229 |
| codex.ts | 164 |
| dispatch-gate.ts | 152 |
| ssh.ts | 144 |
| worktree.ts | 131 |
| identity.ts | 131 |
| models.ts | 126 |
| skills.ts | 114 |
| fleet-status.ts | 98 |
| cloudflare.ts | 82 |
| utils.ts | 61 |
| shutdown.ts | 60 |
| constants.ts | 35 |
| credentials.ts | 31 |
| **Total** | **9,860** |

### Skill Ecosystem

| Metric | Count |
|--------|-------|
| Total skills | 121 |
| With sensor.ts | 87 |
| With cli.ts | 83 |
| With AGENT.md | 48 |
| Context-only (SKILL.md only) | 4 |
| Never dispatched | 15 |
| Fleet-related (suspended) | 12 |

### Context Token Budget

| Component | Tokens | % of 45K |
|-----------|--------|----------|
| Always loaded (SOUL + CLAUDE + MEMORY + overhead) | ~11,150 | 24.8% |
| Typical 2-skill load | ~1,400 | 3.1% |
| Available for task execution | ~32,450 | 72.1% |

---

*Report generated 2026-03-20T01:30:00Z by 7 parallel Claude Opus 4.6 subagents.*
*Total audit tokens consumed: ~930,620 across 416 tool invocations.*
