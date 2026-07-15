# Research Report — Harness Self-Improvement & Untrusted-Loop Isolation

**Links:** @JoshARosen (what self-improving agents actually improve), @tonygentilcore/Glean
(harness = context + trace-learning + routing), @h100envy (container-isolated loop-runner),
@nyk_builderz (CLAUDE.md → hooks for determinism), @piersonmarks (afternoon software factory).

## TL;DR (3 lines)
- Consensus across the serious voices: **self-improvement happens in the harness, not the model** — "the majority of self-improving agents optimize the harness that surrounds the foundation model rather than the model itself" (@JoshARosen). Arc is a harness.
- Glean names the three harness levers concretely: **context management + trace learning (self-improve from past sessions) + routing specialist models for cost** — a checklist Arc can grade itself against.
- The security-relevant gem (@h100envy): run the untrusted loop in a container with **`--network none --read-only`** — "important against prompt injection." This is a copy-paste hardening of Arc's untrusted-content processing.

## Key takeaways (cited)
- **@JoshARosen — what improves:** "Self-improving agents… the interesting question is what the agent is actually improving." Most optimize the *surrounding harness components* (cheaper than fine-tuning); which component you optimize determines how improvement is measured and whether it transfers. (cache 3a969fb97b356524)
- **@tonygentilcore (Glean) — harness anatomy:** the harness enables longer/complex work "primarily through **context management** that lets agents reason across tools/data/workflows," plus **trace learning** ("helping agent systems self-improve based on past sessions") and **routing** ("specialist models take on work they're best suited to… high quality at lower costs"). Also frames harness design as *critical to token efficiency*. (cache 4b892172ad311497)
- **@h100envy — isolated loop-runner (586k impressions):** `docker run --rm --network none --read-only --tmpfs /tmp -v "$(pwd):/work:rw" -v "$HOME/.claude:/root/.claude:ro" -w /work loop-runner ./loop.sh` — working folder writable, everything else read-only, **outbound network off ("important against prompt injection")**. Plus an adversarial subagent: `.claude/agents/reviewer.md` (`model: opus`, "Assume the author is wrong until the diff proves otherwise. Check the tests went green BECAUSE the code was fixed, not because [they were weakened]"). (cache db8ad596512a96fe)
- **@nyk_builderz — CLAUDE.md hygiene:** move imperative rules out of CLAUDE.md into the right mechanism — "Always run X after editing" → a **hook** (determinism); path-scoped rules → frontmatter `paths:` globs; ephemeral run-mode → "For this run, respond as…". Stop stuffing everything into one prompt file. (cache 316c3b3e1ea66739)
- **@piersonmarks — software factory in an afternoon (66k impressions):** two-phase (pre-triage → build) factory that "runs entirely on my existing Claude subscription," designed to need no babysitting and to fit existing habits or it "won't stick." A pragmatic counterweight to heavyweight multi-agent frameworks. (cache 8779f2579ef6db40)

## Arc-alignment (grounded in repos)
- **Trace learning — partial, manual.** Arc's `memory/recent.log` (one line per task close) + monthly consolidation into MEMORY.md *is* trace learning, but hand-run. Glean's automated "self-improve from past sessions" is the gap. Arc's daily-eval (`arc-skill-manager`) is the eval half; the missing half is auto-feeding eval findings back into skill/prompt changes.
- **Routing — present.** `src/classifier.ts` + `--model auto` (GLM/Devstral routing) and the opus/sonnet/haiku tiers already implement Glean's "routing specialist models for cost." Arc is *ahead* here; this link validates the design.
- **Context management — present.** CLAUDE.md's 40–50k token budget, SKILL.md/AGENT.md split, lean-MEMORY.md discipline (verified −36% duration) are exactly Glean's "context management" lever.
- **Loop isolation — partial gap, high value.** Arc has **worktree isolation** (`skills/arc-worktrees/`: tasks run in an isolated git worktree, validated before merge). But there is **no network-off / read-only-FS boundary** around the dispatch subprocess. h100envy's `--network none --read-only` is the missing containment layer for the exact threat the 2026-07-06 DeepMind 6-attack audit flagged (untrusted email/web/peer content processed every cycle). Note the real tension: Arc's dispatch legitimately needs network (git push, gh, X API, x402) — so network-off can only apply to a *sub-phase* (untrusted link/email analysis), not the whole loop.
- **CLAUDE.md → hooks:** Arc already has `.claude/hooks/` + `settings.json`; nyk's principle ("determinism → hook, not prompt") is a governance rule Arc under-applies — several "always do X" imperatives live in CLAUDE.md prose that could be hooks.
- **Adversarial reviewer subagent:** Arc's `/code-review` + `/ultrareview` gates are the analog; h100envy's `reviewer.md` "tests went green BECAUSE the fix, not because weakened" check is a sharp prompt to steal.
- **Port to agent-runtime?** Loop-isolation policy and trace-learning automation both belong in **agent-runtime** — they're substrate concerns that should protect/improve every fleet agent uniformly, not be re-implemented per agent. Routing (classifier) is already arc-starter and proven; consider promoting it to agent-runtime too.

## How this was verified
- Tweets cached 2026-07-10T12:58Z under `skills/arc-link-research/cache/`: `3a969fb97b356524` (JoshARosen), `4b892172ad311497` (Glean), `db8ad596512a96fe` (h100envy container), `316c3b3e1ea66739` (nyk hooks), `8779f2579ef6db40` (piersonmarks).
- Dedup: complements `research/2026-07-06_arc-loop-taxonomy-mapping.md` (loop taxonomy) and `.../2026-07-06_security-audit-deepmind-6attack-taxonomy.md` (threat model); new signal = Glean trace-learning framing + network-off isolation recipe + CLAUDE.md→hooks governance rule.
