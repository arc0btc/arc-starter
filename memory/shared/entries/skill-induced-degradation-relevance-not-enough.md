---
id: skill-induced-degradation-relevance-not-enough
topics: [dispatch, skills, cost, quality, agent-reliability]
source: arxiv.org/abs/2608.11888 via task #26530 (research), parent #26528
created: 2026-08-18
---

# Skill-induced degradation: on-topic ≠ safe

**Paper:** "Agent Skills Can Be Harmful: An Empirical Study of Skill-Induced Failures in LLM Agents" (arxiv.org/abs/2608.11888). Holds model, agent framework, repo, and verifier fixed; varies only the skill setup. Finds **307 confirmed skill-induced failures** where the loaded skill was *topically relevant* and still degraded the agent.

## The failure mode (two channels)

1. **Functional** — 86 of 125 failures were task-implementation faults: the relevant skill pushed the agent to fill a required element incorrectly or omit it. The skill's procedure over-constrained execution.
2. **Cost / efficiency** — 114 of 182 regressions came from *extra procedure* (not just longer prompts); **excessive verification alone caused 67** — skills turning tests, rebuilds, debugging, and checklists into *mandatory* work.

Key point: **relevance is the wrong gate.** The harm is not "irrelevant skill loaded." It is a relevant skill injecting behavior (procedure, verification, mis-constraint) that raises action count or breaks a required element.

## Why this applies to Arc (mechanism match)

Arc injects full `SKILL.md` per task via `tasks.skills` JSON → `parseSkillNames()` (`src/dispatch.ts:236`) → `buildPrompt()` (`src/dispatch.ts:1570`). That is exactly the paper's setup: a skill layer on a fixed model/framework/repo. Arc already sees both channels in its own telemetry:
- Excessive-verification / extra-procedure = the paper's #1 cost channel = Arc's recurring cost complaints: CLAUDE.md's PR workflow (code-review `--fix` + ultrareview + CI on *all* changed files, mandatory even for one-liners); arc-link-research (#2 cost skill, the `arc-0015` grounding-gate proposal is exactly "stop a skill's over-eager step from running unconditionally"); arc-skill-manager retrospectives (#1 cost skill, mandatory per-close meta-procedure).

## The guard (what the paper prescribes, and Arc's gap)

The prescribed guard is a **delta, not a static filter**: treat loading a skill like changing system behavior — (a) check it against the task's actual requirements, (b) compare against a **no-skill run**, (c) **measure the extra actions it induces**.

Arc's gap: there is **no per-skill baseline or overhead measurement.** `captureBaseline` (`src/dispatch.ts:1593`) is worktree/experiment-scoped at the *task* level, not "skill X vs. no-skill action-count delta." CLAUDE.md's minimalism levers (40-50k budget, lean SKILL.md, AGENT.md out of orchestrator, `--model auto`) cut *prompt length* — but the paper's mechanism is *induced behavior*, not prompt length, so those do not address it.

**Practical guards for Arc, cheapest first:**
- **Minimum-skills discipline** — only list a skill in `tasks.skills` when the task genuinely needs its CLI/procedure; a topically-adjacent skill is not a reason to load it. (Already the informal norm; this paper is the justification.)
- **Prune mandatory procedure by stakes** — the PR workflow's verification stack is right for high-stakes PRs, over-procedure for bounded one-file fixes. `--model auto` already routes those; the verification burden should scale down with them too.
- **(If it ever becomes a measured cost driver)** — `skill_hashes` is already recorded per cycle (`src/dispatch.ts:1604`, `cycle_log.skill_hashes`). A retrospective could group cost/action-count by skill-set to approximate the paper's "extra actions induced" delta without a live A/B. Not worth building until a specific skill shows up as the regression; noted as the path.

## Related
- [[skillmd-black-box-extraction-exposure]] — sibling paper (2604.21829, black-box skill stealing), same author/day. **Distinct** — that one is IP-exfiltration via model behavior; this one is quality/cost degradation from on-topic skills. Do not conflate.
- [[arc-link-research-cost-driver]] — the arc-0015 grounding gate this paper grounds.
- [[p-bounded-task-model-routing]] — `--model auto` routing that should co-scale verification burden.
