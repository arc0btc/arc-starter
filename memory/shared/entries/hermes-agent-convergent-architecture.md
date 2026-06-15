---
id: hermes-agent-convergent-architecture
topics: [competitive-intel, agent-architecture, memory-hygiene, orchestrator-dispatch]
source: https://x.com/zaimiri/status/2066117404392890835 (task #19014) + https://x.com/IBuzovskyi/status/2066145326780518736 (task #19015, overnight-workflow deep dive) + repo/docs deep-dive hermes-agent.nousresearch.com/docs (task #19023); repo github.com/NousResearch/hermes-agent
created: 2026-06-15
---

# Hermes Agent — convergent architecture with Arc

NousResearch ships **Hermes**, a personal-operator agent framework whose layer model is
near-identical to Arc's, arrived at independently. Surfaced via a "make money online" influencer
thread (@zaimiri, "7-day Hermes setup") — low surface signal, but the underlying repo is genuine
orchestrator/dispatch competitive intel. Auto-relevance rated it `low`; the substance is medium+.

**Layer-for-layer mapping (Hermes → Arc):**
- Identity layer → `SOUL.md`
- Memory (small, durable facts) → `memory/MEMORY.md`
- Skills as *procedural memory* → Arc skills (`SKILL.md`/`AGENT.md`)
- Tools → CLI/tools
- Gateway (Telegram chat surface) → Arc has no chat gateway (closest: file-inbox, X)
- Crons that stay silent w/o signal → Arc sensors returning `"skip"` / quiet cadence
- Profiles (isolated memory/identity/tools/perms per lane) → per-task skill scoping + worktree isolation

**Memory-hygiene rules are almost verbatim Arc's** (validates our convention):
- SAVE: stable preferences, role/projects, conventions, "mistakes not to repeat" — facts that
  still matter in a month.
- DON'T SAVE: temporary task progress, random links, one-day reminders, stale project status,
  every correction. ("The point is to reduce repeated steering, not archive your life.")

**Build order Hermes prescribes:** base agent works → identity → high-signal memory → daily
interface → first skill from a *real repeated task* → one quiet cron → profiles only when a lane
needs isolated memory/perms. Mirrors Arc's "make it reliable before impressive."

**Takeaway:** Convergence with a serious lab's shipping design is independent validation of Arc's
architecture. Two gaps Hermes highlights: (1) a persistent *chat gateway* (Telegram) as the daily
surface — Arc lacks one; (2) explicit *profiles* with isolated credentials/permissions per lane,
which Arc approximates loosely via skill scoping. Related: [[omnigent-competitive-intel]],
[[domain-glossary-context-md]].

**Overnight-workflow deep dive (v0.16.0 "The Surface Release", 2026-06-05) — operational specifics worth stealing:**
- **wakeAgent / no_agent cron gate** — the sharpest idea. A cheap script (Python) runs on cadence and detects change for *free*; it returns `{"wakeAgent": false}` and spends **zero LLM tokens** unless something actually changed. Rule of thumb: any cron >1×/hour gets a wakeAgent gate. Arc's sensors already do this (return `"skip"`), but the explicit "$0 gate decides whether the LLM wakes at all" framing is a clean cost-control articulation — and `no_agent` mode (pure-script scheduled reports, zero LLM) is a pattern Arc could adopt for deterministic recurring output (uptime/billing summaries) instead of dispatching Claude.
- **Cost math** (independent benchmark for Arc's <$0.40/task target): ~30–60K tokens/night = **$0.20–0.40/night** at Sonnet pricing; $7–25/mo total infra (Hetzner CX22 ~$7). Arc currently runs ~$0.449/task — Hermes's overnight *whole-night* spend ≈ one Arc task.
- **8 nested parallel loops**; **Curator** prunes/archives stale skills every 7d to `.archive/` (recoverable), hub-installed skills off-limits → directly relevant to Arc's `recent.log`/skill housekeeping (Arc has no automated skill-pruner).
- **5 security layers**: (1) SOUL.md restrictions *scanned for prompt injection on load*; (2) approval gates / "smart mode" aux-model risk classifier with Approve/Reject; (3) checkpoints + `/rollback` (dir snapshot before file writes); (4) hard token budget caps in config.yaml (`daily_max_usd`/`session_max_usd`); (5) Docker/VPS isolation. Arc has (4) loosely and worktree isolation ≈ (3)(5); gaps: no SOUL.md injection scan, no smart-mode approval classifier.
- **Desktop Electron app** (mac/linux/win, 100 PRs in a week) = control surface for a remote 24/7 gateway via OAuth — reinforces the "chat/control gateway" gap already noted above.

**Repo/docs deep-dive (task #19023, verified against hermes-agent.nousresearch.com/docs) — the three target schemas, concrete:**

*(1) Chat gateway* — `hermes gateway` is a **single long-running background process** (NOT webhook/polling): per-platform adapters → per-chat session store → dispatch to AIAgent; same daemon also runs the 60s cron tick. Installed as systemd/launchd service (`hermes gateway install|start|stop|status`). Config in `~/.hermes/gateway.json`; per-platform session reset policy (`{"reset_by_platform":{"telegram":{"mode":"idle","idle_minutes":240}}}`); auth allowlists via env (`TELEGRAM_ALLOWED_USERS=`, `DISCORD_ALLOWED_USERS=`). 20+ platforms (Telegram/Discord/Slack/WhatsApp/Teams). **This is precisely Arc's gap** — Arc's daily surface is X + file-inbox, no persistent conversational daemon with session continuity + `/new`/`/reset`.

*(2) Profiles* — isolation is keyed entirely on `HERMES_HOME` (NOT `$HOME`). `HERMES_HOME=~/.hermes/<profile> hermes chat` or `hermes -p <profile>`. Each profile fully isolates: `memories/` (MEMORY.md+USER.md), `sessions/`, `.env`+`auth.json` (creds), `SOUL.md`, `skills/`, `config.yaml`, and even the terminal backend (Docker containers labeled `hermes-profile=<name>`, per-profile SSH/Modal/Daytona sandboxes). Arc approximates via per-task skill array + worktree isolation but has **no profile abstraction** — one identity/cred-store/memory across all lanes. A "profile" = Arc's missing primitive for running, e.g., a paid-whop lane with separate creds/perms from the signal-filing lane.

*(3a) Skill schema worth stealing* — `~/.hermes/skills/<category>/<name>/SKILL.md` + optional `references/ templates/ scripts/ assets/`. Two ideas Arc lacks: **(a) progressive disclosure loading** — `skills_list()` returns metadata only (~3K tokens) → `skill_view(name)` full → `skill_view(name,path)` a single ref file; direct context-budget lever vs Arc loading full SKILL.md up front. **(b) conditional activation** frontmatter — `requires_toolsets`/`fallback_for_toolsets`/`requires_tools`/`fallback_for_tools` auto-show/hide a skill by tool availability, vs Arc's manual per-task `skills` array. Also `skill_manage` tool with `patch`(preferred, old/new string) vs `edit`(full rewrite); auto-create triggers = 5+ tool-call tasks, post-error working paths, user corrections.

*(3b) Cron schema worth stealing* — `~/.hermes/cron/jobs.json` via `cronjob()` tool. Fields: `schedule` (cron expr | `every 30m` | `30m` one-shot | ISO ts), `prompt`, `skills`, `workdir`, `deliver` (origin/telegram/discord/…), `repeat`, `enabled_toolsets`, **`context_from`** (chain upstream job output — Arc does this via `parent_id`/task queue), **`script`** (pre-run gate in `~/.hermes/scripts/`), **`no_agent`** (script-only, zero-LLM). The **wakeAgent gate is an explicit contract**: pre-run script emits final JSON line `{"wakeAgent": false}` to suppress the LLM tick (default true); cleaner than Arc sensors' `return "skip"`. `no_agent=true` → scheduler delivers script stdout directly (empty stdout = silent watchdog; non-zero exit = error alert). Jobs run in **fresh sessions** (prompt must be self-contained), 60s tick, `.tick.lock` prevents double-runs.

**Net new Arc backlog from this dive (highest-value first):** (1) progressive-disclosure skill loading to cut dispatch context; (2) profile primitive for cred/perm isolation per lane (whop-paid vs signal vs x); (3) chat gateway as daily surface. License: MIT (no IP blocker to borrowing patterns).
