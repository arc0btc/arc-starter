# Content Calendar — Tier A Backfill

*Built by task #18674 (2026-06-12). Source: `memory/shared/entries/*.md` (28 entries audited).*
*Status: **DORMANT**. 17 `ContentCalendarMachine` instances created (ids 2982–2998), all gated off.*

Tier A = existing teaching-grade memory entries imported as scheduled content-calendar work-pieces.
Each entry becomes a T+0 blog work-piece that then fans out per `arc-brand-voice/CHANNELS.md`:
blog → whop-chat (T+2h) → X thread (T+1d) → whop-forum (T+2d) → public-forum (T+4d) →
course-candidacy (T+30d). **No posts have fired** — only calendar slots are populated.

## Dormancy — how these stay quiet until sign-off

Two independent gates keep every instance dormant; **both** must open before anything publishes:

1. **Enable flag** — `WORKFLOWS_CONTENT_CALENDAR_ENABLED` is unset. The arc-workflows meta-sensor
   now skips *evaluation* of `content-calendar` workflows when the flag ≠ `"true"`
   (`skills/arc-workflows/sensor.ts`, committed this task). Previously the flag gated only
   instance *creation* (`syncContentCalendar`), so pre-filled instances would have fired the
   un-gated `source_drafted` blog-publish hop on the next 5-min tick. That gap is now closed.
2. **T+0 cadence anchor** — `ContentCalendarMachine.source_drafted` now gates the blog-publish hop
   on `cadence_anchor` (offset 0), so a future anchor noops until its day. Anchors are staggered
   **1/day** so blog publishes stagger 1/day instead of all firing at once on enable.

## ⚠ Before un-gating (set `WORKFLOWS_CONTENT_CALENDAR_ENABLED=true`)

- [ ] **Confirm the room-active hour.** Anchors currently default to **15:00 UTC (09:00 MDT)** —
      a placeholder I chose autonomously (couldn't reach whoabuddy this cycle). whop-chat seed
      then lands ~11:00 MDT, X thread next day. If a different hour reads as "fresh" for the
      hash-it-out / "AI Prefers Bitcoin" audience, re-stamp `cadence_anchor` on all 17 instances.
- [ ] **whop key re-scope** must have landed a clean first chat post (whop #18600 blocker) and the
      whop voice must be human-trusted — paid-room hops route through the sign-off gate regardless.
- [ ] Set `WORKFLOWS_BLOG_TO_X_ENABLED=false` so X isn't double-posted (content-calendar supersedes
      blog-to-x; see `state-machine.ts` ContentCalendarMachine note).
- [ ] Human sign-off on the recurring cadence (required by the machine's gating contract).
- [ ] Consider enabling in **small batches** (a few instances) the first time, to watch the first
      real fan-out before all 17 are live.

## Scoring

Rubric (1–5): teaching_density (TD), tactical_value (TV, audience-facing not Arc-internal),
freshness (F), self_containment (SC). `weighted = TD·0.25 + TV·0.35 + F·0.20 + SC·0.20`.
**Kept: weighted ≥ 3.45** (natural break — next entry is 3.25). 17 kept, 11 dropped.

## Tier A schedule (kept, ranked — best ships first)

| # | scheduled_for (anchor) | wf id | slug | score (TD/TV/F/SC) | distillation |
|---|------------------------|-------|------|--------------------|--------------|
| 1 | 2026-06-13T15:00Z | 2982 | agent-eval-volume-taxonomy | 5.0 (5/5/5/5) | Match your eval maturity to traffic — read raw logs at low volume, build Signals infra only at 1000+ runs/day, prefer floor-raising over benchmark-maxxing. |
| 2 | 2026-06-14T15:00Z | 2983 | harness-engineering-completion-verification | 4.8 (5/5/5/4) | Completion is execution not assertion — run a verification command and use a separate evaluator before marking any agent task done. |
| 3 | 2026-06-15T15:00Z | 2984 | harness-engineering-five-subsystems | 4.8 (5/5/5/4) | An agent harness has five subsystems (instruction/tool/environment/state/feedback); feedback is the highest-ROI gap, and hard constraints belong at the edges of instruction files. |
| 4 | 2026-06-16T15:00Z | 2985 | shai-hulud-npm-worm-class | 4.75 (5/5/4/5) | Modern npm worms hijack the build pipeline with valid provenance and target Claude session files — kill the dead-man's switch before rotating creds; use min-release-age + ignore-scripts in CI. |
| 5 | 2026-06-17T15:00Z | 2986 | recursive-improve-failure-detectors | 4.55 (4/5/5/4) | Mine run history with four detector classes — loops, give-ups, errors, recoveries — and require every pattern to carry an insight, a metric, a fix, and a verification. |
| 6 | 2026-06-18T15:00Z | 2987 | escalation-ladder-arc0011 | 4.45 (5/4/5/4) | Replace flat retry caps with an escalation ladder (refine/pivot/web-search/handoff); hoist the terminal guard first so the state machine provably terminates. |
| 7 | 2026-06-19T15:00Z | 2988 | prompt-caching-exclude-dynamic | 4.25 (5/4/4/4) | Keep static prompt content separate from dynamic so prompt caching survives across cycles — a measured 20-30% input-cost cut, but A/B validate first. |
| 8 | 2026-06-20T15:00Z | 2989 | file-dep-sha-pin-illusion | 4.25 (5/4/4/4) | A file:/link: dependency links whatever is on disk, so a SHA pin in prose is fake — verify signatures against the dep at the pinned SHA in its canonical repo, not a local checkout. |
| 9 | 2026-06-21T15:00Z | 2990 | edge-cache-auth-gate-leak | 4.05 (5/4/4/3) | A URL-keyed edge cache in front of an auth gate leaks private data to anonymous callers — skip the cache on authed branches or fold identity into the cache key. |
| 10 | 2026-06-22T15:00Z | 2991 | content-publish-verify-deploy | 4.0 (4/4/4/4) | Build success is not deploy success — confirm the deploy step ran and content is committed, because stale sites pass every build check. |
| 11 | 2026-06-23T15:00Z | 2992 | agent-collab-feedback-loop | 4.0 (4/4/4/4) | Answer vague UX feedback with a specific data-ask (not "tell me more"), and track promised deliverables with a scheduled re-check since closed issues become dead-letters. |
| 12 | 2026-06-24T15:00Z | 2993 | peer-collab-lifecycle | 4.0 (4/4/4/4) | Agent-to-agent partnerships follow a contact-to-dormancy arc — endure the commercial phase, treat infra tips as high-priority signals, reputation-weight rather than ban broadcast-only peers. |
| 13 | 2026-06-25T15:00Z | 2994 | claude-code-skill-patterns | 3.85 (5/4/3/3) | Practical harness levers: stack prompt-caching flags, keep orchestrator context lean by splitting instructions from execution detail, route command-only work to non-LLM dispatch. |
| 14 | 2026-06-26T15:00Z | 2995 | multi-repo-research-decomposition | 3.75 (4/4/4/3) | Decompose multi-repo research by repo (not by dimension) into one queued task each with fresh context, rather than one session that blows the token budget. |
| 15 | 2026-06-27T15:00Z | 2996 | dead-ends-convention | 3.75 (4/4/4/3) | Keep two memory registries — approach-level dead-ends vs situation-level active state — and migrate stale, human-blocked items out of working memory. |
| 16 | 2026-06-28T15:00Z | 2997 | blog-frontmatter-validation | 3.65 (4/3/4/4) | Duplicate YAML frontmatter keys fail silently at build time, not authoring time — lint frontmatter before queuing any deploy. |
| 17 | 2026-06-29T15:00Z | 2998 | whop-api-capabilities | 3.45 (4/3/4/3) | POST /messages is the automatable primitive to seed a paid community chat from your blog — gate first auto-posts behind human review since the endpoint is non-idempotent. |

## Dropped (weighted < 3.45 — Arc-internal, stale, or low transferability)

| slug | weighted | why dropped |
|------|----------|-------------|
| claude-effort-skill-assessment | 3.25 | behavioral guidance, thin transferable lesson |
| workflow-context-clobber | 3.25 | needs heavy Arc-workflow internals to follow (SC 2) |
| file-inbox-hcom-pattern | 3.05 | niche; Arc-specific Stop-hook plumbing (SC 2) |
| arc-permission-model | 3.0 | Arc-config-specific |
| quantum-gate-framework | 2.85 | internal signal-pipeline rubric, low audience value |
| claude-code-version-deploy | 2.7 | locked-env ops trivia |
| signal-quality-boost-checklist | 2.5 | internal signal-pipeline, stale (filing paused) |
| hook-exec-form-eval | 2.45 | version-specific hook trivia |
| skill-frontmatter-compliance | 2.45 | Arc-internal lint plumbing |
| arc-mcp-inotify-diagnosis | 1.85 | resolved one-off internal incident |
| no_proxy_verification | 1.65 | one-off finding, no transferable lesson |

*Some dropped entries (e.g. `quantum-gate-framework`, `workflow-context-clobber`) carry real
craft and may resurface in **Tier C** connective essays where Arc-internal context is the point.*

## Next

- **Tier B** — `memory/patterns.md` (27 validated patterns), separate task, queued only after
  Tier A clears a few cycles cleanly.
- **Tier C** — connective essays from daily evals + arxiv, separate task.
