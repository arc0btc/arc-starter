---
name: openrouter-open-weight-routing
description: Routing policy for open-weight models (GLM-5.2, Devstral-2512) via OpenRouter — which task types qualify, quality gates, and how to assign in arc tasks add.
metadata:
  type: project
---

**Source:** Task #20198 — derived from [[openrouter-open-weight-benchmark]] (2026-06-28).

---

## Routing Tiers

| Tier | Model | When to use |
|------|-------|-------------|
| `openrouter:devstral` | Devstral-2512 (~$0.001–0.006/task) | Fastest, cheapest — single-file, purely mechanical changes with a clear before/after spec |
| `openrouter:glm` | GLM-5.2 (~$0.010/task) | Bounded code tasks that benefit from extra tool iterations; still single-file or tightly scoped multi-file |
| `sonnet` | Claude Sonnet 4.6 (~$0.30–$0.55/task) | Composition, multi-step reasoning, judgment calls, content generation, signal filing, PR reviews |
| `opus` | Claude Opus 4.8 (~$1.50+/task) | Deep research, complex architectural decisions, anything requiring synthesis across >5 files |

---

## Open-Weight ELIGIBLE Task Types

Use `openrouter:devstral` or `openrouter:glm` when ALL of these are true:

1. **Single-file or ≤3 tightly coupled files** — change scope fits in one read + one edit.
2. **Spec is complete** — the task subject/description fully defines what to add/change/remove. No judgment about *what* to do, only *how*.
3. **No test execution required** — task does not need `bun test` or CI validation inline. Pre-commit hooks (tsc, syntax) are fine.
4. **No cross-repo operations** — no `gh`, no pushing, no multi-repo coordination.
5. **No side effects** — no STX transactions, no API calls that post data, no credential operations.
6. **Output is verifiable mechanically** — TypeScript compiles, or the output is a string/JSON that can be diff-checked.

**Canonical examples:**
- Add a new function/method to an existing file (`getModelDisplayName()` pattern)
- Update a config constant or pricing table
- Rename a field or type alias across ≤3 files
- Add a CLI flag to an existing command (bounded scope)
- Generate a template file from a clear spec

---

## Open-Weight INELIGIBLE Task Types

Stay on `sonnet` or `opus` for:

- PR reviews (require multi-file reading + judgment)
- Signal filing (requires source evaluation, EIC scoring, multi-step pipeline)
- Nostr / X / Whop content tasks (voice filter, judgment)
- Tasks with `blocked` escalation paths or unknown scope
- Sensor changes (require multi-file awareness: sensor.ts + db schema + cycle_log)
- Any task where `description` says "research", "evaluate", "synthesize", or "decide"
- Tasks with `max_retries` > 3 (suggests uncertainty — open-weight models have no escalation path)
- Tasks that touch `src/dispatch.ts`, `src/sensors.ts`, or `src/db.ts` (core infrastructure, high blast radius)

---

## Quality Gates

Open-weight output MUST pass before committing:

1. **TypeScript type-check** — `bun build --no-bundle src/index.ts` (or equivalent entry) must exit 0. The dispatch pre-commit syntax guard (`bun build --no-bundle` over staged `.ts` files) applies automatically.
2. **Diff review** — inspect the actual diff before committing. Open-weight models pass through the harness with no Claude Code session wrapper; the diff is the only artifact.
3. **Spot-check functional correctness** — for new functions, verify the output matches the spec by reading the changed file. No test suite required, but do not commit blindly.

If any gate fails: close task as `failed`, create a follow-up with `sonnet` and include the diff + error in the description.

---

## How to Assign in `arc tasks add`

**Prefer `--model auto` over manual assignment (deployed 2026-06-29, commit 85c0c022, `src/classifier.ts`).**
It runs this same eligibility logic as pure-text heuristics (no LLM, no network) and prints its
reasoning (`type`/`confidence`/`reason`) — verify the line looks right, don't blind-trust it.

**Adoption gap found 2026-07-03 (task #21005), recall broadened same day (task #21007, commit
f4100aee):** 0 of 86 sonnet follow-ups created 2026-07-03 used `openrouter:devstral`/`glm`, and
`memory/recent.log` showed only 1 historical mention of `--model auto` since the classifier shipped.
Root cause: the classifier's subject-text heuristics needed a literal filename (`.ts`/`.js`/`.json`)
to fire `bounded-code` — follow-ups phrased around the skill/CLI name instead of the file path
(`"add grep-verify step to lint-skills"` vs `"update skills/x/cli.ts"`) fell through to
`unknown` → `sonnet`. Fixed with two additions to `src/classifier.ts`:
1. **`--file PATH` flag** on `tasks add`/`classify` — names the target file explicitly,
   independent of subject-text parsing. High-confidence `bounded-code` when paired with an
   action verb; also checked against `CORE_INFRA_PATTERNS`.
2. **Skill-prefix / CLI-name heuristics** — `"<skill-name>: <verb> ..."` or `"<verb> ... <skill>
   cli"` phrasing with no literal file path routes to `bounded-code-glm` (GLM's extra tool
   iterations locate the right file without a literal path).

INELIGIBLE patterns (audit/research/investigate/whop/etc) are unchanged and still gate ahead of
both new heuristics. When creating a bounded follow-up: try `--model auto` first, and pass
`--file skills/x/cli.ts` explicitly if the subject is phrased around the skill/CLI name rather
than the file path.

```bash
# Devstral — cheapest, fastest, purely mechanical
arc tasks add \
  --subject "Add getModelDisplayName() to src/models.ts" \
  --model openrouter:devstral \
  --priority 6 \
  --skills arc-skill-manager

# GLM — bounded but benefits from tool iterations
arc tasks add \
  --subject "Update pricing table in src/models.ts for new OpenRouter models" \
  --model openrouter:glm \
  --priority 6 \
  --skills arc-skill-manager

# --model auto with skill-phrased subject — pass --file so it doesn't need a literal path in the subject
arc tasks add \
  --subject "arc-skill-manager: add grep-verify step to lint-skills" \
  --model auto \
  --file skills/arc-skill-manager/cli.ts \
  --priority 6 \
  --skills arc-skill-manager
```

Do NOT set `model openrouter:*` from sensors — sensors cannot assess eligibility reliably. Human-created tasks or dispatch-created follow-ups only.

---

## Cost Decision Frame

At $0.527/task average (2026-06-28 baseline):
- 10 Devstral tasks ≈ cost of 1 average task. Use freely for eligible work.
- 10 GLM tasks ≈ cost of 1 standard operational task. Also cheap.
- The $1.78 code-change outlier is the primary target — Devstral or GLM should handle its profile.

Routing does NOT affect dispatch defaults. Model is always set explicitly per task.

---

**Why:** whoabuddy email request to evaluate open-weight models for cost reduction on code-change tasks.
**How to apply:** When creating a code-change task that fits the eligible criteria above, use `openrouter:devstral` first. Escalate to `openrouter:glm` if the task is slightly more complex but still bounded. Fall back to `sonnet` on any quality gate failure.
