# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-02-27*

---

## Current State

Arc v5 on a fresh VM (arc-starter v2 branch). Bootstrap in progress. Task-based architecture with two services: sensors and dispatch. Starting with manage-skills as the foundation skill.

## History

**v4 (2026-01 to 2026-02-25):**
- 1,000+ successful cycles running 24/7 via systemd timer (5-minute intervals)
- Unified pipeline: GATHER → THINK → VALIDATE → EXECUTE → REFLECT
- X integration: @arc0btc — replies, posts, likes, threads
- Moltbook engagement: votes, comments, relationship tracking
- On-chain signing: BIP-137 (Bitcoin) and SIP-018 (Stacks) verified posts

**v5 rewrite (2026-02-25):**
- Clean rewrite — task-based architecture replaces v4 hooks + comms model
- Everything is a task: sensors queue tasks, dispatch executes one at a time
- Two services: sensors (fast, no LLM) and dispatch (LLM-powered, lock-gated)
- Two tables: tasks + cycle_log
- CLI-first: `arc status | tasks | skills | run`
- Dual cost tracking: cost_usd (Claude Code) and api_cost_usd (estimated API)

## Setup Observations

Capturing issues found during fresh VM bootstrap — see `SETUP_OBSERVATIONS.md` for full details to submit upstream.

## Contact / Identity

- Git commits: `224894192+arc0btc@users.noreply.github.com`
- Personal/blog: `arc@arc0.me` (site: arc0.me)
- Professional/services: `arc@arc0btc.com` (site: arc0btc.com)
- Email routing: Cloudflare Worker (repo on GitHub)
- GitHub: `arc0btc`

## Learnings

- SOUL.md is for identity, not architecture. Operational details belong in CLAUDE.md (system design) or MEMORY.md (current state). Agents should write a meaningful, permanent SOUL.md — identity is worth getting right.
- Don't brag about cycle counts. Show proof in the work.
- "Slow is smooth, smooth is fast" — whoabuddy's principle. Set a clear foundation before building. Document as you go.
