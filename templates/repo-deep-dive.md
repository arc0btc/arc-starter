# Repo Deep-Dive Template

A rotating series of honest introspection posts about each active repository.
One repo at a time, in rotation. Goal: understand the current state, find gaps, publish the findings.

## Rotation Schedule

| Order | Repo | Last Covered | Next Due |
|-------|------|-------------|---------|
| 1 | arc-starter | 2026-03-11 | ~2026-06-11 |
| 2 | arc0me-site | — | next |
| 3 | arc0btc-worker | — | after arc0me-site |
| 4 | (add repos as fleet grows) | — | — |

## Task Template

When creating a repo deep-dive task, use:

```
arc tasks add \
  --subject "Repo deep-dive: <repo-name> report and blog post" \
  --priority 5 \
  --skills blog-publishing \
  --description "Comprehensive <repo-name> report: architecture, active vs dormant components, sensor/skill coverage, what works and what's missing. Publish as arc0.me blog post, fan out to X. Part of rotating repo deep-dive series."
```

## Research Checklist

Before writing, gather:

- [ ] Directory structure and file counts
- [ ] All skills/sensors/components — list with file composition
- [ ] Sensor activity: hook-state last_ran timestamps, identify never-run
- [ ] Recent task history: what's generating work?
- [ ] Cost data: cycles/week, avg cost/cycle
- [ ] Gaps: missing integrations, broken sensors, deprecated code
- [ ] Recent changes: last 10 commits, what changed?

## Blog Post Structure

```markdown
# <Repo>: A Deep Dive Into the Stack

[1 paragraph: what this repo is and why it exists]

---

## What <Repo> Is

[Architecture overview: key files, service model, design philosophy]

## [Core System 1]

[Technical deep-dive on the most important subsystem]

## [Core System 2]

[Next most important subsystem]

## Coverage: What's Actually Running

[Active vs dormant. Concrete numbers. No hand-waving.]

## What's Missing

[Honest gaps. Don't soften these.]

## [Closing observation about design/architecture]

---

*Arc — YYYY-MM-DD · arc0.btc · SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B*
```

## X Thread Structure

After publishing, queue a thread (3-5 posts):

1. **Hook post**: Single punchy observation from the deep-dive. Link to full post.
2. **Architecture insight**: The most interesting design decision, explained concisely.
3. **Honest gap**: One thing that's broken or missing. Builds trust.
4. **What's next**: The next repo in rotation.

## Sensor / Trigger

This template is used by the `arc-starter-publish` sensor when it detects that the
current repo hasn't had a deep-dive in >90 days. The sensor checks `templates/repo-deep-dive.md`
for the rotation schedule and queues the next task automatically.

## Notes

- Keep the report honest. Gaps and failures are more useful than polish.
- Use real data: task counts, cost figures, last-run timestamps. Never estimate.
- Each post should be ~1,200-1,800 words. Long enough to be useful, short enough to finish.
- Pair with `arc-brand-voice` skill for tone consistency.
- Run `arc skills run --name blog-publishing -- publish --id <post-id>` to publish.
- Queue X thread as a follow-up task with `--skills social-x-posting`.
