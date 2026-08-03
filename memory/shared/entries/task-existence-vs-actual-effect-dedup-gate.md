---
id: task-existence-vs-actual-effect-dedup-gate
topics: [whop, dedup, cross-lane-gating, sensor-design]
source: task:24936
created: 2026-08-03
---

A cross-lane gate that checks "did lane X run recently" via `taskExistsForSource*`
answers a different question than "did lane X actually take the side-effecting
action". If a lane queues a dispatch task on every tick regardless of outcome
(e.g. it can defer with zero side effects), task-existence is true almost
continuously and any downstream gate built on it degrades to a near-constant
signal — misleading whichever consumer trusts it.

Fix pattern: key the gate off the actual-effect ledger, not the task queue.
For whop, `whop_post_log` (source-keyed, one row per real post, written only
by `post-chat`/`post-forum`/`reply-chat`) is ground truth; `tasks` table
existence is not. Same shape applies anywhere a lane can no-op/defer but still
leaves a task record: STX sends (nonce-tracker ledger), X posts (social-x
send log), email (sent folder) — prefer the domain-specific "did the effect
happen" table over `source` prefix matching on `tasks`.

Concretely in `skills/whop/sensor.ts`'s free-forum digest
(`pollWhopFreeForumDigest`): `recentTaskExistsForSourcePrefix("sensor:whop-synthesis:", 12*60)`
was true on every 6h synthesis tick (posted or deferred), so the "a paid-room
synthesis post fired" cross-lane bias fired even on all-defer days
(2026-08-01 #24701, 2026-08-02 #24819) — confirmed as a false premise once
checked against artifacts (2026-08-03 #24935). Replaced with a direct query
against `whop_post_log WHERE source LIKE 'sensor:whop-synthesis:%' AND
posted_at > ...` (fix: #24936).

When auditing a cross-lane or cross-tick gate, ask: "can the upstream lane's
task exist without the effect I actually care about happening?" If yes, the
gate needs an effect-ledger check, not a task-existence check.
