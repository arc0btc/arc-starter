# Agent Infrastructure Reference

Consolidated reference for agent-level infrastructure patterns and capabilities.

---

## arc-roundtable — Inter-Agent Structured Discussion Protocol

Structured multi-agent discussions using existing web APIs (port 3000). Arc orchestrates: creates a discussion, fans out the prompt to each fleet agent's HTTP API, collects responses, and compiles them into a threaded result.

### How It Works

1. **Start** — Creates a `roundtable_discussions` row and a `roundtable_responses` row per agent. Sends `POST /api/roundtable/respond` to each agent's web API with the discussion prompt.
2. **Respond** — Each agent receives a task via the web endpoint. The dispatched session reads the prompt, thinks, and posts its response back to the originator using the `respond` CLI command.
3. **Status** — Shows which agents have responded and which are still pending.
4. **Compile** — Assembles all responses into a threaded discussion document.

### DB Tables

- `roundtable_discussions` — id, topic, prompt, started_by, status (open/compiled), created_at, compiled_at
- `roundtable_responses` — id, discussion_id, agent_name, response, status (pending/responded), responded_at

### CLI Commands

```bash
arc skills run --name arc-roundtable -- start --topic "Topic" --prompt "Discussion prompt"
arc skills run --name arc-roundtable -- status --id N
arc skills run --name arc-roundtable -- compile --id N
arc skills run --name arc-roundtable -- respond --id N --text "Response text"
```

### Web Endpoint

`POST /api/roundtable/respond` — Accepts `{ discussion_id, prompt }`. Creates a task for the local agent to respond.

### When to Load

Load when: starting a roundtable discussion, responding to one, or compiling results. Also useful for fleet-wide brainstorming, decision-making, or collaborative analysis.

---

## arc-dual-sdk — Multi-SDK Task Execution Router

Routes tasks to different execution backends: Claude Code CLI (default), OpenAI Codex CLI, or OpenRouter API. Selection is per-task via the `model` field using an `sdk:` prefix.

### SDK Selection

The `model` field on tasks now supports an optional `sdk:` prefix:

| model value | SDK | Model |
|------------|-----|-------|
| `opus` | Claude Code | claude-opus-4-6 |
| `sonnet` | Claude Code | claude-sonnet-4-6 |
| `haiku` | Claude Code | claude-haiku-4-5-20251001 |
| `codex` | Codex CLI | codex (default model) |
| `codex:o3` | Codex CLI | o3 |
| `codex:o4-mini` | Codex CLI | o4-mini |
| `codex:gpt-4.1` | Codex CLI | gpt-4.1 |
| `openrouter:kimi` | OpenRouter API | moonshotai/kimi-k2.5 |
| `openrouter:minimax` | OpenRouter API | minimax/minimax-m2-5 |
| `openrouter:qwen` | OpenRouter API | qwen/qwen3-coder |
| `openrouter:<model-id>` | OpenRouter API | Any model ID (passed through) |
| (none) | Priority routing | P1-4→opus, P5-7→sonnet, P8+→haiku |

**OpenRouter modes:** The `openrouter:` prefix explicitly routes to a specific OpenRouter model. Separately, when `OPENROUTER_API_KEY` is set (and no prefix is used), Claude-tier tasks fall back to OpenRouter's Claude models automatically.

### Architecture

```
task.model ──▶ parseSDK() ──▶ { sdk: "claude" | "codex" | "openrouter", model: string }
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
              Claude Code      Codex CLI      OpenRouter API
              (or OR fallback) (Bun.spawn)   (explicit model)
```

### Implementation Files

- `src/codex.ts` — Codex CLI adapter. Spawns `codex` subprocess, captures output.
- `src/openrouter.ts` — OpenRouter API adapter. Tool-calling loop with bash execution.
- `src/dispatch.ts` — Extended with SDK routing in the dispatch loop.
- `src/models.ts` — `SdkType`, `parseTaskSdk()`, alias maps, and pricing registries.

### Codex CLI Differences

| Aspect | Claude Code | Codex CLI |
|--------|------------|-----------|
| Input | stdin (prompt blob) | `--prompt` flag |
| Output | stream-json | stdout text |
| Permissions | `--dangerously-skip-permissions` | `--full-auto` |
| Model flag | `--model <id>` | `--model <id>` |
| Working dir | cwd argument | `--cwd` flag |
| Approval | permission modes | `--full-auto` / `--suggest` |

### Creating Tasks

```bash
# Codex
arc tasks add --subject "Simple refactor" --model codex --priority 7
arc tasks add --subject "Use o3 for analysis" --model codex:o3 --priority 5

# OpenRouter (explicit model)
arc tasks add --subject "Kimi analysis" --model openrouter:kimi --priority 5
arc tasks add --subject "Qwen code task" --model openrouter:qwen --priority 6
arc tasks add --subject "Custom model" --model "openrouter:meta-llama/llama-4-maverick" --priority 7
```
