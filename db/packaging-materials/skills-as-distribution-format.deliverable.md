# Research Report — Skills as a Distribution Format

**Links:** github.com/mattpocock/skills (164,016★), github.com/emilkowalski/skills (7,957★),
@nyk_builderz Hermes-plugins thread, @undefinedKi Anthropic knowledge-work-plugins thread.

## TL;DR (3 lines)
- The agent-skills market has changed magnitude, not just membership: mattpocock/skills is at **164k stars** (vs the low-thousands leaders in Arc's 2026-06-18 audit) and ships a *state-machine engineering workflow*, not a prompt dump.
- The structural claim across all four links (sharpest from @nyk_builderz): agents became an ecosystem the moment **capability became installable** — "the App Store moment," a distribution format, not a smarter model.
- Arc already lives this internally (131 skills, `arc-skill-manager`, SKILL.md/AGENT.md split) but treats skills as private plumbing, not a distributable or sellable artifact.

## Key takeaways (cited)
- **mattpocock/skills — "Skills for Real Engineers, straight from my .claude directory"** (164k★). The value is an *engineering process as skills*: `triage` (issues through a role state-machine), `to-spec` → `to-tickets` (conversation → spec → tracer-bullet tickets with declared blocking edges), `wayfinder` (plan work spanning >1 agent session), `grilling`/`grill-with-docs` (adversarial Q&A that updates `CONTEXT.md` + ADRs inline), `writing-great-skills` (a skill about authoring skills). Explicitly "small, easy to adapt, composable, work with any model" — a deliberate contrast to GSD/BMAD/Spec-Kit which "take away your control." (gh:mattpocock/skills)
- **emilkowalski/skills — "Skills for Design Engineers"** (7.9k★). Thesis: "Agents don't have great taste"; skills encode domain expertise ("a side-effect of domain-expertise… AI amplifies it"). Skills: `emil-design-eng`, `apple-design`, `animation-vocabulary`, `review-animations`. Installed via `npx skills@latest add emilkowalski/skills`, indexed on skills.sh. (gh:emilkowalski/skills)
- **@nyk_builderz (Hermes plugins, 14k★ awesome-hermes-agent):** "Agents did not become an ecosystem because a model got smarter. They became an ecosystem the moment capabilities became installable… agent capability just got a distribution format. The iPhone was interesting in 2007. It became inevitable in 2008 when the App Store shipped." (cache 4f6f32a6060e9026)
- **@undefinedKi:** Anthropic quietly open-sourced `anthropics/knowledge-work-plugins` — turns Claude into installable office roles (sales rep, marketer, financial analyst, legal reviewer, data analyst) via `claude plugin marketplace add` / `claude plugin install`. Frames the alternative to "one freelancer with amnesia." (cache 0b8ca1202236d56e)
- Cross-link pattern: **`npx skills@latest add <owner>/<repo>` + skills.sh registry** is emerging as the de-facto install/discovery path. This is packaging + distribution infra Arc does not touch.

## Arc-alignment (grounded in repos)
- **Where Arc already does this:** Arc's skill container model (`skills/<name>/SKILL.md` orchestrator context + `AGENT.md` subagent briefing + `sensor.ts` + `cli.ts`) is *more* structured than most repo skills here — it already separates "loaded into orchestrator" from "passed to subagent," which mattpocock's flat SKILL.md files do not. `arc-skill-manager` is Arc's authoring tool; 131 skills in `skills/`. mattpocock's `writing-great-skills` and `setup-matt-pocock-skills` map directly onto `arc-skill-manager -- create`.
- **Where it's a gap:** Arc's skills are **not installable or distributable**. There is no `SKILL.md`-only export, no `skills.sh`-style manifest, no `npx skills add arc0/...`. Arc's skills assume the full Arc runtime (task queue, dispatch, CLI). The market signal says the unit of value is the *portable* SKILL.md.
- **mattpocock's `triage` state-machine and `to-tickets` (tracer-bullet tickets with blocking edges)** are a near-exact external analog of Arc's `tasks` queue + `arc-workflows` state machines. Worth reading as a design cross-check on Arc's workflow DSL.
- **Port to agent-runtime?** Yes, strongly. A "skill export / portable-SKILL.md" capability belongs in **agent-runtime**, not arc-starter — a portable skill format levels up every fleet agent and is the precondition for ever selling a skill. arc-starter's `arc-skill-manager` stays the authoring front-end; agent-runtime owns the portable artifact spec (this echoes the existing council-DSL-in-agent-runtime pattern).

## How this was verified
- gh:mattpocock/skills (164,016★, fetched 2026-07-10T12:58Z), gh:emilkowalski/skills (7,957★).
- Tweets cached: `skills/arc-link-research/cache/4f6f32a6060e9026.json`, `.../0b8ca1202236d56e.json`.
- Dedup: supersedes/updates `research/2026-06-18T19:10:01Z_agent-skills-market-data.md` and `.../skill-extraction-from-sessions.md` on market magnitude.
