---
id: goose-headless-eval
topics: [goose, headless, codex-alternative, open-weight, cost-tracking, openrouter, dispatch]
source: task 20437 (2026-06-30), goose 1.39.0
created: 2026-06-30
---

# Goose headless eval — viable Codex alternative for open-weight tasks (GO, conditional)

Bounded eval (whoabuddy-approved, NOT a migration). Goose moved `block/goose` →
**Agentic AI Foundation (Linux Foundation)**, repo `aaif-goose/goose`, docs `goose-docs.ai`.
Tested version **1.39.0**. Verdict: **GO (conditional)** — no disqualifier; not yet wired into dispatch.

## Install (headless)
`curl -fsSL https://github.com/aaif-goose/goose/releases/download/stable/download_cli.sh | CONFIGURE=false bash`
→ binary `~/.local/bin/goose` (~292 MB). Reversible: `rm ~/.local/bin/goose`.

## Run headless on OpenRouter open-weight
```
OPENROUTER_API_KEY=$(arc creds get --service openrouter --key api_key) \
GOOSE_PROVIDER=openrouter GOOSE_MODEL=z-ai/glm-5.2 GOOSE_DISABLE_KEYRING=1 \
goose run --no-session --no-profile --max-turns N --output-format json \
  -t "<prompt>"     # or -i FILE / -i -  for stdin
```
`--no-session` (no session file), `--no-profile` (skip default extensions), `--max-turns` (bound),
`--provider`/`--model` (override env), `--quiet`. Exit 0 on success. `GOOSE_DISABLE_KEYRING=1` needed on
headless hosts (no keyring). Equivalent to Codex / Claude Code unattended mode.

## Three eval gates
1. **Headless cleanliness — PASS.** Single-shot, no interactive prompts, no hang, meaningful exit code.
   GOTCHA: an ASCII banner ("goose is ready") prints to stdout BEFORE the JSON. A parser must extract the
   **trailing/last well-formed JSON object** from stdout — stdout is not pure JSON even with `--output-format json`.
2. **Machine-readable output — PASS.** `--output-format {text,json,stream-json}`. `json` emits one object:
   `{messages:[{role,content:[{type:text|thinking,...}]}], metadata:{...}}`. `stream-json` for events.
3. **Cost/token parity — PARTIAL PASS.** `metadata` in JSON gives `input_tokens`, `output_tokens`,
   `total_tokens`, `status` → maps directly to Arc `tokens_in`/`tokens_out`. (Public docs/issue #4419 lag —
   they showed only `total_tokens`; 1.39.0 actually splits in/out.) **No native dollar cost anywhere**
   (`--stats` text mode shows only time-to-first-token, tokens/sec, output tokens). For open-weight this is
   fine: compute `api_cost_usd` = tokens × OpenRouter rate, same as today ([[openrouter-open-weight-routing]]).
   `cost_usd` (actual provider charge) has no native source — set = token-derived estimate, or query
   OpenRouter gen-cost endpoint by gen id if exact actuals wanted (extra plumbing).

## If we proceed (next bounded step, separate task — needs sign-off)
- Run the REAL 1–2 Codex tasks through `goose run` and compare output QUALITY (this eval validated mechanism
  + parity with representative bounded tasks, not the real Codex corpus).
- Thin parse adapter: last-JSON-from-stdout → tokens → `api_cost_usd`.
- GLM-5.2 vs Devstral-2512 quality head-to-head ([[openrouter-open-weight-benchmark]]).
Do NOT add `goose` as a dispatch model until that lands. Full report: `reports/2026-06-30_goose-headless-eval.md`.
