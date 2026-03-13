# Dispatch Backend Abstraction Layer — Design Document

**Task:** #5596 | **Priority:** P2 | **Date:** 2026-03-13
**Context:** Fleet restart with alternate AI backends. Email thread with whoabuddy.

---

## Current State

Arc dispatch already supports three backends, but they're wired via if/else in `dispatch.ts` (lines 723-733):

| Backend | File | Invocation | Tool Support | Cost Reporting |
|---------|------|------------|--------------|----------------|
| Claude Code | `dispatch.ts:313-454` | `Bun.spawn(["claude", ...])` stdin prompt | Full (Claude Code tools) | Native (stream-json `total_cost_usd`) |
| OpenRouter | `openrouter.ts` | HTTP POST to chat/completions | Bash-only (function calling) | Estimated from tokens × pricing |
| Codex CLI | `codex.ts` | `Bun.spawn(["codex", ...])` --prompt flag | Full (Codex built-in) | Estimated (chars÷4) |

**Problem:** Adding a 4th or 5th backend means more if/else branches, duplicated timeout/retry logic, and no standard interface for health checks.

---

## 1. Dispatch Backend Interface

```typescript
// src/dispatch-backend.ts

export interface DispatchResult {
  result: string;
  cost_usd: number;
  api_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface DispatchBackend {
  /** Unique backend identifier (e.g. "claude", "openrouter", "codex", "ollama") */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /** Check if this backend is available (credentials exist, service reachable) */
  isAvailable(): Promise<boolean>;

  /** Health ping — lightweight check that the backend can accept requests */
  healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }>;

  /** Dispatch a prompt and return structured result */
  dispatch(opts: DispatchOpts): Promise<DispatchResult>;

  /** List supported model IDs for this backend */
  listModels(): string[];
}

export interface DispatchOpts {
  prompt: string;
  model: string;          // Backend-specific model ID
  cwd?: string;           // Working directory for tool execution
  timeoutMs?: number;     // Override default timeout
}
```

**Key design choices:**
- `isAvailable()` checks credentials/connectivity before dispatch — avoids wasting a task attempt on a misconfigured backend
- `healthCheck()` is the alive-check protocol (see section 3)
- Each backend owns its own timeout, retry, and output parsing — dispatch.ts just calls the interface
- `DispatchResult` is already the shape used by all three backends (they already return this)

### Registry

```typescript
// src/dispatch-registry.ts

const backends = new Map<string, DispatchBackend>();

export function registerBackend(backend: DispatchBackend): void {
  backends.set(backend.name, backend);
}

export function getBackend(name: string): DispatchBackend | undefined {
  return backends.get(name);
}

export function listBackends(): DispatchBackend[] {
  return [...backends.values()];
}

export async function getAvailableBackends(): Promise<DispatchBackend[]> {
  const results = await Promise.allSettled(
    [...backends.values()].map(async (b) => ({ backend: b, ok: await b.isAvailable() }))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<{ backend: DispatchBackend; ok: boolean }> =>
      r.status === "fulfilled" && r.value.ok)
    .map((r) => r.value.backend);
}
```

### Migration path

Wrap existing code into backend classes without rewriting:

1. `ClaudeCodeBackend` — wraps the existing `dispatch()` function in dispatch.ts
2. `OpenRouterBackend` — wraps `dispatchOpenRouter()` from openrouter.ts
3. `CodexBackend` — wraps `dispatchCodex()` from codex.ts
4. New: `OllamaBackend` — HTTP to local Ollama API

The existing `selectSdk()` + if/else chain in dispatch.ts becomes:

```typescript
const sdkRoute = selectSdk(task);
const backend = getBackend(sdkRoute.sdk);
if (!backend || !(await backend.isAvailable())) {
  throw new Error(`Backend "${sdkRoute.sdk}" not available`);
}
const result = await backend.dispatch({
  prompt,
  model: sdkRoute.model ?? resolveDefaultModel(backend, task),
  cwd: worktreePath,
  timeoutMs: getDispatchTimeoutMs(model),
});
```

---

## 2. Backend Evaluations

### Option 1: Claude Code + OpenRouter (Kimi K2.5, MiniMax M2, Qwen3-Coder)

**Status:** Already implemented. `openrouter.ts` has full tool-calling loop. Aliases configured in `models.ts`.

| Dimension | Assessment |
|-----------|------------|
| **Cost/token** | Kimi: $2/$8 per M. MiniMax: $1/$5. Qwen: $0.80/$3.20. All cheaper than Sonnet ($3/$15). |
| **Latency** | OpenRouter adds ~200-500ms routing overhead. Tool-call loop adds N×RTT per iteration. |
| **Tool calling** | Bash-only via function calling. Works but limited vs Claude Code's full tool suite (Read, Edit, Glob, Grep). |
| **Dispatch compat** | Drop-in. Already routing via `openrouter:kimi` model prefix. |
| **Quality** | Kimi K2.5 strong on code reasoning. MiniMax M2 good for composition. Qwen3-Coder strong on code gen. None match Opus on complex multi-step tasks. |
| **Risk** | Low — production-tested path. |

**Verdict:** Best first move. Workers can restart immediately with `openrouter:kimi` or `openrouter:qwen` for P5-8 tasks. No new code needed — just task model field assignment.

### Option 2: OpenRouter SDK + Exacto Router

**Concept:** Instead of full Claude Code subprocess, use OpenRouter API directly with a purpose-built tool executor that only exposes `arc` CLI + file operations.

| Dimension | Assessment |
|-----------|------------|
| **Cost/token** | Same as Option 1 (same underlying models). |
| **Latency** | Faster than Claude Code subprocess (no CLI boot time). Comparable to current openrouter.ts. |
| **Tool calling** | Already implemented — `openrouter.ts` has the bash tool. Could add Read/Edit/Glob tools to improve quality. |
| **Dispatch compat** | Already integrated. Enhancement is additive (more tools). |
| **Quality** | Better with more tools. Current bash-only approach forces models to shell out for file reads, which wastes tokens. |
| **Risk** | Low — incremental improvement on Option 1. |

**Verdict:** Option 1 improved. Add 3-4 tools (read_file, write_file, glob, grep) to `openrouter.ts` TOOLS array. This is a ~50-line enhancement, not a new backend. Ship as an iteration on the existing OpenRouter adapter.

### Option 3: Codex CLI + OpenAI GPT

**Status:** Already implemented. `codex.ts` working. Forge was configured for this.

| Dimension | Assessment |
|-----------|------------|
| **Cost/token** | o4-mini: $1.10/$4.40. gpt-4.1: $2/$8. gpt-5.4: $2.50/$15. Competitive with Sonnet. |
| **Latency** | CLI boot time (~2-3s). Similar to Claude Code. |
| **Tool calling** | Full — Codex CLI handles its own tool execution in `--full-auto` mode. |
| **Dispatch compat** | Drop-in. Already routing via `codex:o4-mini` model prefix. |
| **Quality** | gpt-5.4 comparable to Opus on many tasks. o4-mini good for simple execution. |
| **Token reporting** | Weak — no native usage reporting. Character-based estimation (÷4) is unreliable. |
| **Risk** | Medium — Forge configured but workers need OPENAI_API_KEY credential. |

**Verdict:** Good secondary option. Forge already configured. Workers need `arc creds set --service openai --key api_key --value <key>`. Token reporting gap means cost tracking is approximate.

### Option 4: Ollama + Local Models

**Concept:** Ollama server on LAN (e.g., Forge at 192.168.1.15), zero marginal cost.

| Dimension | Assessment |
|-----------|------------|
| **Cost/token** | $0. Electricity only. |
| **Latency** | Depends on hardware. GPU inference: fast. CPU: very slow for large models. |
| **Tool calling** | Ollama supports function calling (experimental, model-dependent). Qwen3-Coder-Next and GLM-4.7-Flash support it. |
| **Dispatch compat** | New backend needed. ~100 lines — HTTP POST to `http://<host>:11434/api/chat`, OpenAI-compatible format. |
| **Quality** | Qwen3-Coder-Next (~30B): competitive with Sonnet on code tasks. GLM-4.7-Flash: lightweight, good for P8+ work. Gemma 3: general purpose. None match Opus. |
| **Risk** | Medium-high — hardware-dependent, model quality varies, tool calling not as reliable. |
| **Infra needed** | Ollama installed on Forge (or dedicated inference box). GPU recommended for acceptable latency. |

**Verdict:** High strategic value (zero marginal cost for P8+ tasks) but requires hardware investment and quality validation. Ship last.

### Alternative Approaches

**Hermes Agent:** A Nous Research framework for structured tool-calling agents. Uses system prompts to inject tool schemas. Could replace the openrouter.ts tool-calling loop with a more robust agentic framework. Worth evaluating when OpenRouter tool-calling quality degrades — not a priority now since the current bash loop works.

**Karpathy Autoresearch:** Pattern of using LLMs to recursively search, synthesize, and cite. Applicable to research-type tasks (like this one). Could be implemented as a specialized dispatch mode that chains web search → synthesis → report. Not a dispatch backend per se — more of a task template/skill. Create a skill for this pattern rather than a new backend.

---

## 3. Alive Check Protocol

Workers need to prove they can dispatch, not just that their process is running.

```typescript
interface AliveCheckResult {
  agent: string;              // e.g. "spark"
  timestamp: string;          // ISO 8601
  backend: string;            // "claude" | "openrouter" | "codex" | "ollama"
  model: string;              // Model ID used for check
  status: "ok" | "degraded" | "down";
  latencyMs: number;
  error?: string;
}
```

**Protocol:**

1. **Sensor-based** (every 5 min): Each worker runs a lightweight `alive-check` sensor that:
   - Calls `backend.healthCheck()` on its configured backend
   - Writes result to `memory/fleet-status.json` (already exists)
   - If `status === "down"` for 3 consecutive checks, creates a P3 alert task

2. **Health check implementations by backend:**

   | Backend | Health Check Method | Expected Latency |
   |---------|-------------------|-------------------|
   | Claude Code | `claude --version` (process spawn, no API call) | <1s |
   | OpenRouter | `GET https://openrouter.ai/api/v1/models` (lightweight endpoint) | <500ms |
   | Codex | `codex --version` (process spawn) | <1s |
   | Ollama | `GET http://<host>:11434/api/tags` (list models) | <200ms |

3. **Arc aggregation**: Arc's fleet-status sensor reads each worker's `memory/fleet-status.json` via fleet-sync. If a worker is `down`, Arc can reroute tasks to another available backend.

**Key principle:** Health checks never consume tokens. They verify connectivity and auth, not model quality.

---

## 4. Task Routing by Capability Tier

Current 3-tier routing maps to backends:

| Tier | Priority | Current | With Fleet Restart |
|------|----------|---------|-------------------|
| **Senior** | P1-4 | Claude Opus | Claude Opus (Arc only until suspension lifts) |
| **Mid** | P5-7 | Claude Sonnet | OpenRouter (Kimi K2.5, Qwen3-Coder) or Codex (gpt-5.4) |
| **Junior** | P8+ | Claude Haiku | OpenRouter (MiniMax M2, Qwen3-Coder) or Codex (o4-mini) or Ollama |

**Routing decision tree:**

```
task.model set explicitly?
  ├─ yes → use specified backend + model
  └─ no → priority routing:
       ├─ P1-4 → Claude Opus (Arc dispatch only)
       ├─ P5-7 → first available of:
       │    1. OpenRouter (Kimi K2.5)
       │    2. Codex (gpt-4.1)
       │    3. Claude Sonnet (fallback)
       └─ P8+ → first available of:
            1. Ollama (local, if running)
            2. OpenRouter (MiniMax M2)
            3. Codex (o4-mini)
            4. Claude Haiku (fallback)
```

**Per-worker configuration** via `memory/config.json` or env:

```json
{
  "default_backend": "openrouter",
  "default_model": "moonshotai/kimi-k2.5",
  "fallback_backend": "codex",
  "fallback_model": "o4-mini"
}
```

This decouples backend selection from the task — each worker can be configured independently. Arc assigns tasks to workers; workers decide which backend to use.

---

## 5. Evaluation Matrix

| | Claude Code | OpenRouter (Kimi/Qwen) | Codex (o4-mini) | Codex (gpt-5.4) | Ollama (Qwen3-Coder) |
|---|---|---|---|---|---|
| **Cost/M tokens (in/out)** | $15/$75 (Opus), $3/$15 (Sonnet) | $0.80-2/$3.20-8 | $1.10/$4.40 | $2.50/$15 | $0/$0 |
| **Latency (boot)** | ~3s (CLI spawn) | ~200ms (HTTP) | ~3s (CLI spawn) | ~3s (CLI spawn) | ~100ms (HTTP, LAN) |
| **Tool calling** | Full suite | Bash only (extensible) | Full (built-in) | Full (built-in) | Experimental |
| **Token reporting** | Native (exact) | Native (exact) | Estimated (÷4) | Estimated (÷4) | Native (exact) |
| **Code quality (P5-7)** | Excellent | Good (Kimi≈Sonnet, Qwen strong on code) | Good | Very good | Good (if GPU) |
| **Code quality (P8+)** | Overkill | Adequate | Good | Overkill | Adequate |
| **Arc integration** | Production | Production | Production | Production | New (~100 LOC) |
| **Auth requirement** | Anthropic OAuth/API key | OpenRouter API key | OpenAI API key | OpenAI API key | None |
| **Offline capable** | No | No | No | No | Yes |
| **Fleet suspension risk** | Yes (current issue) | No | No | No | No |

---

## 6. Recommended Implementation Order

### Phase 1: Restart workers with existing backends (0 new code)
**Timeline:** Immediate (when suspension lifts or before)

1. Configure workers with OpenRouter API key: `arc creds set --service openrouter --key api-key --value <key>`
2. Set worker default model via env: `DISPATCH_MODE=openrouter`
3. Queue test tasks with `--model openrouter:kimi` and `--model openrouter:qwen`
4. Validate output quality on P5-8 tasks

**Why first:** Zero code changes. Workers can restart today with the existing `openrouter.ts` adapter.

### Phase 2: Backend interface + registry refactor (~200 LOC)
**Timeline:** Next sprint

1. Create `src/dispatch-backend.ts` (interface + registry)
2. Wrap existing `dispatch()`, `dispatchOpenRouter()`, `dispatchCodex()` as backend classes
3. Replace if/else chain in `dispatch.ts` with registry lookup
4. Add `isAvailable()` and `healthCheck()` to each backend
5. Add backend health to `arc status` output

**Why second:** Clean abstraction makes Phase 3-4 trivial to add. Also enables the alive-check protocol.

### Phase 3: Enhance OpenRouter tools (~50 LOC)
**Timeline:** After Phase 2

1. Add `read_file`, `write_file`, `glob`, `grep` tools to openrouter.ts TOOLS array
2. Implement tool handlers (reuse Bun.file, Bun.Glob, etc.)
3. Quality test: compare task success rate with bash-only vs expanded tools

**Why third:** Biggest quality lift for the cheapest backends. Models waste tokens shelling out for file reads.

### Phase 4: Ollama backend (~100 LOC)
**Timeline:** When Forge has GPU or dedicated inference hardware

1. Create `src/ollama.ts` implementing `DispatchBackend`
2. HTTP POST to `http://<host>:11434/api/chat` (OpenAI-compatible)
3. Add function calling support (model-dependent)
4. Configure as P8+ fallback on Forge
5. Validate on simple tasks (mark-as-read, config edits, status checks)

**Why last:** Requires hardware. High long-term value but not urgent for fleet restart.

### Phase 5: Autoresearch skill (separate from dispatch)
**Timeline:** When needed

1. Create `skills/autoresearch/` with SKILL.md + cli.ts
2. Implements recursive search → synthesize → cite pattern
3. Uses whatever backend is available for the synthesis step
4. Useful for research tasks like this one

---

## Appendix: Files to Modify

| File | Change | Phase |
|------|--------|-------|
| `src/dispatch-backend.ts` | New: interface + registry | 2 |
| `src/dispatch.ts` | Replace if/else with registry lookup | 2 |
| `src/openrouter.ts` | Wrap as `OpenRouterBackend` class + add tools | 2, 3 |
| `src/codex.ts` | Wrap as `CodexBackend` class | 2 |
| `src/ollama.ts` | New: Ollama backend | 4 |
| `src/models.ts` | Move pricing into backend classes (or keep shared) | 2 |
| `src/cli.ts` | Add `arc backends` command (list, health) | 2 |
| `skills/autoresearch/` | New skill | 5 |
