---
id: dead-skill-audit-evidence-triangulation
topics: [skills, maintainability, audit, dead-code]
source: task:20787
created: 2026-07-02
---

# Dead-skill audit: evidence triangulation

`memory/recent.log` alone is insufficient for a 30-day dead-skill audit — it
rotates at 500 lines (per [[maintainability-sensors-coding-agents]]) and only
covers ~3-7 days of history at any point; `recent.log.archive` covers one
earlier rotation window with a gap between them. Neither gives full 30-day
coverage.

**Working triangulation (used in task #20787, found 7 candidates from 133 skills):**
1. `sensor-health-report` CLI (arc-skill-manager) — `last_task_at` column gives
   accurate long-range (90-100+ day) per-sensor task-production history. Best
   single signal for sensor-backed skills.
2. For skills with no `sensor.ts` (50 of 133 in this repo — CLI/knowledge-only
   skills): git commit staleness (`git log -1 --format=%cd -- skills/<name>`)
   as a proxy, cross-referenced against **external repo references**
   (`grep -rl <name> src memory templates CLAUDE.md skills | grep -v own-dir`)
   to exclude core infra that's stable-but-still-depended-on (e.g.
   `arc-credentials`, last commit 2026-03-05, but referenced live in
   CLAUDE.md/src as the credential store — NOT dead, just mature).
3. Zero external references + zero log mentions + stale commit (>30d) +
   no pending/active task referencing the skill = confirmed candidate.

**Gotcha:** a nonzero external-reference count can still be a false positive
if the only hits are inside `skills/arc-architecture-review/audit-log*.md`
(historical audit narration, not live usage) or a compliance-fix note in
`skill-frontmatter-compliance.md` (a one-time lint pass, not usage). Read the
actual matched lines before trusting the count.

**Externally-contributed skill smell**: SKILL.md frontmatter with
`metadata: {author: "...", author-agent: "..."}` (non-Arc contributor) +
non-standard file layout (`<name>.ts` at skill root instead of `cli.ts`) +
zero sensor + zero references = likely a one-off community contribution that
was accepted but never wired into orchestration. 3 of 7 candidates in this
audit fit this pattern (defi-portfolio-scanner, hodlmm-risk, zest-auto-repay,
all DeFi skills from the same two external authors).
