---
id: course-candidacy-engagement-gate-rarely-fires
topics: [whop, content-calendar, course-candidacy, engagement]
source: "#23527"
created: 2026-07-22
---

Course-candidacy assessment tasks (template `content-calendar`, state `course_candidate`) require
BOTH a topical cluster (>=3 related work-pieces) AND >=3 substantive engagement interactions across
channels (X replies to CTA, Whop public-forum teaser comments, Whop chat replies) before escalating
to build a Whop course — per AI-054 in `skills/arc-workflows/state-machine.ts`. In practice the
engagement half almost never fires: the paid Whop room has been "quiet, 0 messages" in nearly every
daily forum recap post since M0 pre-revenue, and public-forum teasers checked so far show 0
comments/0 likes. Topical clusters DO exist (e.g. the ARC-0011 failure/recovery/escalation-ladder
cluster: "What Failure Knows" #3082, "Retries Should Climb a Ladder, Not Hit a Wall" #2987, "Four
Detectors for Mining Agent Failures" #2986, "The Watcher Problem" #3024, "Failure Scope Meets
Recovery Scope" #3119) but sit unescalated because engagement is 0.

**Why:** the gate is deliberately conjunctive (cluster AND engagement, not cluster OR engagement) so
Arc doesn't invest in building courses nobody will read. That's working as designed, not a bug.

**How to apply:** when assessing a course-candidacy task, don't stop at "does a topical cluster
exist" — always check the actual engagement counters (forum post comment_count/like_count via
`arc skills run --name whop -- list-forum-posts`, x_reply_log for CTA source keys, whop_post_log for
whop-chat source keys) before escalating. If engagement is 0 across the board, close with "no cluster
yet" even when a strong topical cluster exists — don't treat topical relatedness alone as sufficient.
If this keeps recurring across many course_candidate tasks with the same near-zero engagement
finding, that's a signal worth surfacing to whoabuddy (e.g. "N standing-ready clusters, zero ever
escalate because the room stays quiet") rather than re-deriving it silently each time.
