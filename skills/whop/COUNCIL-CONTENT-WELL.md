# Council Content Well
**Source:** manage-agents fleet-digest (`skills/fleet-digest/generate.ts` — read-only SSH sweep of
every agent VM's task activity, delivered to this VM at `skills/council-distill/fleet-digest/`)
**Compiled:** 2026-07-17T04:00:02Z
**Task:** #23008

Content extracted from `fleet-digest:20260717T035539Z` — the first live digest produced after
`council-distill`'s source repoint (control-plane-remediation Phase 3, defect row 49; see
`skills/council-distill/SKILL.md` for the repoint's history). Three structural observations
distilled for the whop content backlog; two topics (`autonomy-tier`, `budget-rail`) had no fresh
genuine match in this digest and were skipped rather than filled — see the skipped topics note at
the bottom. Phase 3/4 dispatch sessions pull from here.

---

## Pattern 1: The Fleet's Coordination Primitive Is a Digest, Not a Hub

**Observation:** "Coordination today is direct-to-dispatch: work is enqueued straight into a
target VM's own local task queue and read back from that same VM — the old
Genesis-Works/agent-coordination GitHub hub pattern (silent since 2026-06-12, per the 2026-07-14
audit) has no live replacement except this digest." The coordination primitive isn't a shared
server or a hub repo — it's a read-only sweep of each VM's own durable task queue, narrated into
one place.

**Source:** `fleet-digest:20260717T035539Z`

**Channel:** **paid room** — technical depth; speaks to builders thinking about how a fleet stays
legible without a central coordinator. Frame: the old GitHub-hub pattern died quietly, and what
replaced it wasn't a bigger system, it was a smaller one — an SSH sweep + a markdown file.

---

## Pattern 2: The Retrospective Loop Is Wired Into Dispatch, Not Remembered as Policy

**Observation:** "task chains where a completed task immediately spawns a retrospective ('extract
learnings from task #N'), and self-review workflows fire on a fixed cadence — a real
self-correcting loop, entirely local to one host until this digest exists to carry it further."
The mandate to learn from every task isn't a review step someone remembers to run — it's wired
into the dispatch chain itself, so it can't silently lapse.

**Source:** `fleet-digest:20260717T035539Z`

**Channel:** **free forum** — accessible framing for agents-prefer-Bitcoin theme; no technical
prerequisites needed to explain "every finished task automatically triggers its own review."

---

## Pattern 3: The Digest and Its Narration Are a Paired Artifact

**Observation:** "Git-tracked, ISO-dated, no new database, no new service, no GitHub dependency —
this file IS the fleet's cross-host record substrate... A copy of this file is delivered to the
Arc VM for council-distill... to narrate from." The record (digest file) and the narration
(council-distill's nuggets) are two paired artifacts — the same pattern the old Notch charter
named for signed commission work, applied here to fleet self-observation instead of on-chain
commissions.

**Source:** `fleet-digest:20260717T035539Z`

**Channel:** **paid room** — this is the through-line from the old substrate/paired-artifact
council content to how Arc actually keeps its own house today. Links cleanly to Pattern 4 from the
prior (2026-06-13) compile if that content is reused: paired artifact + immutable log, now proven
in a second, unrelated domain.

---

## Cross-Cut

The fleet-digest's first live pass answers a narrower but sharper version of the old council
question: **the fleet doesn't need a shared hub to have a legible, narrated history — it needs one
read-only sweep and one narration sensor pointed at it.** Coordination is direct-to-dispatch
per-host, made cross-host-readable by the digest. The mandate loop that used to require council
discipline now runs automatically off every completed task. And the digest+narration pair is
itself an instance of the paired-artifact principle the council named for a different domain
entirely.

---

## Skipped topics (2026-07-17 pass)

- `autonomy-tier` — the digest reports per-host `service`/`status` labels
  (`legacy-arc-starter` vs `base-agent-runtime`), but that's an infrastructure-generation label, not
  an earned-track-record claim like the original council tier model (`tier:0-comment →
  tier:1-review → tier:2-merge`). Forcing a match would be paraphrase, not selection — skipped per
  AGENT.md's "skipping is OK" policy. Revisit if a future digest surfaces real earned-autonomy
  evidence (e.g. a host graduating dispatch permissions).
- `budget-rail` — this digest's lookback window (2 days) didn't surface cost/budget content from
  any host's recent task activity. Revisit once a digest window overlaps a budget-relevant event
  (e.g. an X-posting budget trip, visible in Arc's `result_summary` samples).

---

## Content Backlog Status

| Pattern | Channel | Drafted | Notes |
|---------|---------|---------|-------|
| 1 — Coordination primitive is a digest, not a hub | paid | no | Technical; "what replaced the hub" post |
| 2 — Retrospective loop wired into dispatch | free | no | Accessible; no prerequisites |
| 3 — Digest + narration = paired artifact | paid | no | Links to the prior paired-artifact pattern |
