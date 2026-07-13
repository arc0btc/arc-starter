---
name: list-roster
description: Private X List over the curated roster — membership sync + since_id-disciplined tweet poll onto the candidate-maturation spine
updated: 2026-07-13
tags:
  - social
  - research
  - x
disallowed-tools:
  - Edit
  - Write
  - NotebookEdit
  - Bash
---

# List Roster Reader

Reads the curated roster (`social_accounts`, 138 eligible/ingestion_only rows)
directly via a **private X List** instead of the retired 96-blind-searches/day
keyword rotation — the roster's own accounts, read once per poll instead of
guessed at through search keywords. Part of the **Option B candidate-maturation
spine** (`src/candidate-spine.ts`, arc-x-research-channel quest Phase 2):
candidates land here, `skills/candidate-maturation/sensor.ts` (unchanged,
generic over `source_lane`) re-scores them 2-24h later and files `Research:`
tasks into the proven `arc-link-research` path.

## Read mechanism: List-poll, not Activity API

Chosen in Phase 1's console reconciliation
(`docs/observations/2026-07-13-x-console-reconciliation.md` §2): cost is a
wash ($0.005/post either way), but List-poll needs **zero new standing
infrastructure** — no persistent HTTP stream or public webhook receiver to
babysit between dispatch ticks — and fits this codebase's scheduled-poll
pattern everywhere else (`candidate-maturation`, `x-news-trends`). The Activity
API (self-serve 1,500 subscriptions, `post.create` events at $0.005/event) is
parked as a fast-follow if a future need for near-real-time detection arises;
2-24h-maturing research candidates don't need sub-second delivery.

## Sensor

- Name: `list-roster`
- Cadence: `POLL_INTERVAL_HOURS` constant, 4h default. `since_id` + the
  existing 24h-UTC dedup ledger make higher-cadence polling cheap (no
  re-billing of already-seen posts) — this dial is about freshness, not cost.
- State: `db/hook-state/list-roster.json` (the standard `claimSensorRun` claim
  gate) PLUS `db/hook-state/list-roster-state.json` (this skill's own state:
  `{listId, createdAt, sinceId}` — the List only needs to be created once).

## What it does each run

1. **Ensure the List exists.** First run creates a private X List ("Arc
   Research Roster") via `createXList` (`skills/social-x-posting/cli.ts`) and
   persists its id. Every subsequent run reuses the same id — never creates a
   second List.
2. **Membership sync (capped, free-rows-first).** Queries `social_accounts`
   for `targeting_status IN ('eligible','ingestion_only')` rows not yet added
   to the List. Rows that already have a `follow_target_id` (from a prior
   `follow-curated.ts` run — 32 of the 138 roster rows) sync for **free** (no
   lookup read). New rows cost one metered `resolveUserId` read ($0.010/
   resource, confirmed rate, `users` lane) — capped at `MEMBER_SYNC_CAP_PER_RUN`
   (5) NEW paid lookups per run so the ~106-row ramp (138 total minus the 32
   free ones) doesn't spike daily spend while Phase 3's news/trends lanes are
   also running. Self-healing: unsynced rows are picked up again next run
   (~22 runs at worst case, much faster in practice since most successful
   lookups also populate `follow_target_id` for future runs/the follow-policy
   hook to reuse for free).
3. **Tweet poll.** `GET /2/lists/{id}/tweets`, `since_id`-disciplined,
   `max_results=100`, billed **per-resource** ($0.005/post, `list-roster`
   lane, confirmed rate per Phase 1's console reconciliation — list tweets
   belong to OTHER accounts, so they're a non-owned read despite the List
   itself being owned). Tried over the EXISTING OAuth 1.0a path first (List
   tweets is a timeline-style read structurally like `fetchArcMentions`); on
   a live 403 "OAuth 1.0a User Context is forbidden," falls back to OAuth 2.0
   App-Only (`xApiGetAppOnly`) — same honest-discovery pattern Phase 3 used
   for Trends/News, never assumed. See the verify artifact for which auth
   path was actually needed live.
4. Each returned post becomes a candidate (`source_lane: "list-roster"`) via
   `insertCandidateIfNew` — author username (resolved via the response's
   `includes.users` expansion), full tweet text, and non-self-referential URLs
   captured for the eventual research task's context.
5. Candidates flow through `skills/candidate-maturation/sensor.ts`
   **unmodified**.

## Lanes this skill writes

| Lane | Pricing status | Billing shape |
|---|---|---|
| `list-roster` | confirmed ($0.005/resource) | per-resource |
| `users` | confirmed ($0.010/resource) | per-resource, capped 5 new lookups/run |

## Follow policy

This skill only reads the List and syncs membership — it does NOT decide who
gets promoted onto the roster in the first place. That's
`src/follow-policy.ts`'s `promoteResearchSourceHandle`, wired into
`arc-link-research`'s report-acceptance path (see that module's header and the
Phase 4 verify artifact) — a handle used in an accepted research report is
promoted into `social_accounts`, the List, and followed automatically, in
real time, not on this sensor's periodic cadence.

## Credentials

Same X OAuth 1.0a credentials as `social-x-posting` — no new credential
required. Falls back to the same OAuth 2.0 App-Only bearer exchange
`x-news-trends` already uses if List tweets turns out to require it live.

## When to Load

Sensor-only. No need to load it into dispatch context — it creates candidates
that `candidate-maturation` consumes, never tasks directly.
