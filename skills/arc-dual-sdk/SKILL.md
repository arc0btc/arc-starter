---
name: arc-dual-sdk
description: Routes dispatch to Claude Code or OpenAI Codex CLI based on task sdk field
updated: 2026-03-08
tags:
  - infrastructure
  - dispatch
  - multi-sdk
---

# arc-dual-sdk

Routes tasks to different execution backends: Claude Code CLI (default), OpenAI Codex CLI, or OpenRouter API. Selection is per-task via the `model` field using an `sdk:` prefix.

## SDK Selection

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
| (none) | Priority routing | P1-4→opus, P5-7→sonnet, P8+→haiku |

OpenRouter mode is orthogonal — it replaces the Claude Code backend when `OPENROUTER_API_KEY` is set, but only for Claude-tier tasks (not codex tasks).

## Architecture

```
task.model ──▶ parseSDK() ──▶ { sdk: "claude" | "codex", model: string }
                                    │
                    ┌───────────────┤
                    ▼               ▼
              Claude Code      Codex CLI
              (or OpenRouter)  (Bun.spawn)
```

### Files

- `src/codex.ts` — Codex CLI adapter. Spawns `codex` subprocess, captures output.
- `src/dispatch.ts` — Extended with SDK routing in the dispatch loop.
- `src/models.ts` — Extended `SdkType` and `parseTaskSdk()` helper.

## Codex CLI Differences

| Aspect | Claude Code | Codex CLI |
|--------|------------|-----------|
| Input | stdin (prompt blob) | `--prompt` flag |
| Output | stream-json | stdout text |
| Permissions | `--dangerously-skip-permissions` | `--full-auto` |
| Model flag | `--model <id>` | `--model <id>` |
| Working dir | cwd argument | `--cwd` flag |
| Approval | permission modes | `--full-auto` / `--suggest` |

## Creating Codex Tasks

```bash
arc tasks add --subject "Simple refactor" --model codex --priority 7
arc tasks add --subject "Use o3 for analysis" --model codex:o3 --priority 5
```

## Checklist

- [x] SKILL.md exists with valid frontmatter
- [x] Frontmatter name matches directory name
- [x] SKILL.md is under 2000 tokens
- [x] src/codex.ts adapter created
- [x] src/models.ts extended with SDK parsing
- [x] src/dispatch.ts routes based on SDK
