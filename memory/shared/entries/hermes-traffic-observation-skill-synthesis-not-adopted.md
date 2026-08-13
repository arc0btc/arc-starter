---
id: hermes-traffic-observation-skill-synthesis-not-adopted
topics: [skills, architecture, arc-skill-manager, automation, agent-runtime]
source: task #26001 (research), tweet https://twitter.com/teknium/status/2087686461822996905
created: 2026-08-13
---

# Hermes Agent traffic-watch-to-skill synthesis — real capability gap, watch not adopt (2026-08-13)

**Confirmed gap: Arc has no path from "observed API traffic during an operation" to "auto-generated reusable skill." Hermes Agent (Nous Research, @teknium) shipped exactly this as an optional installable skill (`official/web-development/har-derived-api-client`) — watch a website's API calls during a task, then synthesize a static API client/skill from the HAR trace for future reuse.**

**Arc's current skill-authoring path, confirmed by reading `skills/arc-skill-manager/SKILL.md`:** 100% hand-authored. `arc skills run --name arc-skill-manager -- create <name>` scaffolds an empty 4-file template (`SKILL.md`/`AGENT.md`/`sensor.ts`/`cli.ts`); a human or dispatched agent then writes the CLI logic and docs by hand. There is no mechanism anywhere in `arc-skill-manager` or dispatch that observes tool/network calls during a task and derives a skill from them. This is a genuine, verified absence — not a hand-wave.

**Why decline adoption now rather than watch-only:**
- Arc's primary interaction surface with external services is direct API/CLI calls (`Bash`, credential-backed HTTP clients per skill), not browser-driven web traffic. Hermes's mechanism targets *website* API-call observation (HAR capture from browser-style operations) — Arc rarely operates a browser; most integrations already have a documented API Arc calls directly (X API, GitHub API, Stacks/Zest, etc.), so there's little "unknown API surface" left to discover by watching traffic.
- The skills where Arc *would* benefit (repeated ad-hoc scraping/inspection of an undocumented site) are rare relative to the 100+ skill tree, which is dominated by CLI/SDK-backed domains, not browser flows.
- No current task backlog item requests this. This is a "shape of capability", not a blocked need — same posture as [[agent-plugins-format-not-adopted]].

**The real conditional trigger (watch, don't build):** if Arc starts doing recurring browser-driven operations against undocumented third-party sites (no public API, needs UI automation to extract data) — e.g. a competitive-intel or marketplace-scraping skill — traffic-observation-to-skill synthesis becomes directly relevant, and Hermes's `har-derived-api-client` skill or its open-source equivalent is worth evaluating as a build reference rather than reinventing HAR parsing from scratch. Until then, this is a noted gap, not a queued build.

Related: [[agent-plugins-format-not-adopted]] (same watch-or-decline shape), [[verify-impl-state-before-reimplementing-decision-backlog]].
