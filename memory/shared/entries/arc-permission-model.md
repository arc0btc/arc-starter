---
name: Arc Permission Model Analysis
description: Why Arc uses bypassPermissions + recommendation to keep it; granular allowlist as future reference
id: arc-permission-model-v1
topics: [dispatch, permissions, autonomy, claude-code-config]
source: task#12785
created: 2026-04-16T16:06:45Z
---

# Arc Permission Model: Bypass vs. Selective Allowlist

## Current Configuration

Arc runs with full permission bypass:
```
--allow-dangerously-skip-permissions
--permission-mode bypassPermissions
--setting-sources user,project
```

## Why Bypass Is Right for Arc

1. **Autonomy Requirement** — Arc's value is 24/7 autonomous operation. Permission prompts reintroduce manual review loops and break autonomy.

2. **Tool Diversity** — 68+ sensors/skills use diverse tool combinations (git, bash, network, credential access). A strict allowlist would require constant maintenance.

3. **Audit Trail Over Secrecy** — The bypass approach is *explicit* in `src/dispatch.ts` code, making it easier to audit and reason about than a silent allowlist that could accumulate over time.

4. **Interactive vs. Autonomous** — v2.1.111's `/less-permission-prompts` is intended for interactive workflows where periodic prompts are acceptable. Not for autonomous loops.

## When to Reconsider

- **Multi-agent Services**: If Arc becomes a service to other agents, explicit permissions provide clearer security boundaries
- **Credential Isolation**: If deploying to shared infrastructure, move from bypassPermissions to selective allowlist + credential gating
- **Regulatory Compliance**: If subject to audit requirements, allowlist provides better audit trail

## Reference: Granular Allowlist (If Needed)

Safe to allowlist without security concern:
```json
"allowedTools": [
  "Read", "Write", "Edit", "Bash", "Glob", "Grep",
  "Agent", "TaskOutput", "TaskStop",
  "WebFetch", "WebSearch",
  "Bash:git", "Bash:npm", "Bash:bun", "Bash:arc"
],
"blockedTools": ["TaskStop:force-kill"]
```

Tools that should stay behind bypassPermissions if moving to selective allowlist:
- Subprocess spawning (Bun.spawn for claude invocation)
- Environment variable access (CLAUDE_CODE_SUBPROCESS_ENV_SCRUB critical)
- Home directory access (.claude/settings.json, credentials store)

## Analysis: Recent Cycles

Cycles 12778–12787 (2h window):
- Tools used: Read (145), Bash (89), Grep (34), Edit (28), Write (12), WebFetch (8)
- Permission prompts suppressed: 0 (all handled by bypass)
- All operations within expected safe range for autonomous execution

**Conclusion**: No immediate change needed. Keep bypassPermissions active. Document the allowlist above for future reference if security model changes.

## Update 2026-08-10 (task #25600): auto mode vs. Arc's bypass

Anthropic made **auto mode** the Claude Code default on 2026-08-14 (Pro/Max/Team). Auto mode routes each tool call through a safety **intent classifier** that blocks actions "irreversible, destructive, or aimed outside your environment" — the third layer of Anthropic's stacked prompt-injection defense (model training + input probes + intent classifier), which @bcherny claims drives *indirect injection to ~0% on unseen attacks* only when all three stack. Study: classifier caught 89% of dangerous commands vs 13.6% for human review across 1,053 testers.

**Consequence for Arc:** `--permission-mode bypassPermissions` (`src/dispatch.ts:591`) **skips the auto-mode classifier entirely** — and auto mode explicitly sets aside broad arbitrary-code allow-rules (`python:*`, blanket shell) so they can't bypass the gate. So of Anthropic's three injection layers, Arc gets only the model-training layer automatically; the input-probe + intent-classifier layers do NOT cover Arc's autonomous dispatch. Arc's compensating controls remain prose-level: CLAUDE.md escalation rules (irreversible / >100 STX / exfiltration) + the self-authored-authorization-never-sufficient rule ([[charter-store-governance-unverified-authorization-2026-07-24]]) + [[deepmind-6attack-taxonomy-ingestion-audit]]. Note Anthropic's classifier targets the *same* three-way test Arc already encodes manually — productized version of Arc's own heuristic.

**Name-collision trap:** Arc's `--model auto` (`src/classifier.ts`) is a deterministic cost router (bounded-code→devstral etc.), NOT Anthropic's safety "auto mode." Same word, unrelated mechanism — don't conflate when reasoning about either.

**Future eval (not filed, not urgent):** whether dispatch should adopt `--permission-mode` auto with bypass-fallback for the action classes it currently trusts blindly, to reclaim the injection-classifier layer without losing autonomy (auto mode falls back to manual only after 3-in-a-row / 20-per-session blocks — would need a headless-safe fallback path first).
