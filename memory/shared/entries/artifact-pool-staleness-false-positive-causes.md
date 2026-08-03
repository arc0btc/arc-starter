---
name: ""
metadata: 
  node_type: memory
  id: artifact-pool-staleness-false-positive-causes
  topics: 
    - inflows
    - observability
    - arxiv-research
    - council-distill
  source: task:24861
  created: 2026-08-03
  originSessionId: 8620692c-a8a0-4dc0-9274-cec255f4b3e9
  modified: 2026-08-03T04:25:42.238Z
---

`arc-artifacts stuck-check` flagged arxiv (66h) and council (408h) as stale on
2026-08-03. Both traced to expected upstream causes, not sensor/code bugs — no
fix needed.

**arxiv (66h stale):** `skills/arxiv-research/sensor.ts` runs every 12h and only
queues a digest-compile task when `newCount > 0` new papers appear vs.
`lastSeenId`. Hook state (`db/hook-state/arxiv-research.json`) showed
`newPaperCount: 0` for the 2026-08-01 and 2026-08-02 fetches — arXiv does not
announce new listings on Sat/Sun (submissions queue and post Monday), so zero
new papers over a weekend is normal, not a fetch/parse bug. Confirmed via
`arc memory recall --query "Fetch and compile arXiv digest"`: daily digest
tasks completed successfully every day 07-27→07-31, then none over the
weekend. Expect self-resolution on the next Monday-morning fetch.

**council (408h stale):** `skills/council-distill/sensor.ts` compares a sha256
of the control-plane-delivered `fleet-digest/latest.md` against
`lastSeenDigestHash`. The hash has been identical (`3e197af6...`) since the
2026-07-17 digest — the control plane (`manage-agents` repo,
`skills/fleet-digest/generate.ts`) hasn't pushed a fresh snapshot in 17+ days.
Tasks #23788 (07-24) and #24583 (07-31) both ran, correctly detected "digest
unchanged," and no-opped rather than re-distilling identical content
(`HEAD_STABLE_SKIP_DAYS=7` forces a recheck weekly even on unchanged hash, but
recheck-and-noop still isn't a new artifact). This is dedup logic working as
intended, not a broken sensor — the actual staleness lives one hop upstream,
in the control plane's digest-generation cadence, which Arc cannot trigger or
verify from this side.

**Diagnostic gotcha:** `council-distill`'s hook state sets `lastDistillAt`
optimistically at task-*queue* time, not at confirmed artifact-write time — so
"lastDistillAt: 30h ago" in hook state does NOT mean an artifact landed 30h
ago, only that a task was queued then (which may itself have been a no-op).
Cross-check against `arc skills run --name arc-artifacts -- list <type>` for
ground truth, not hook-state timestamps alone.

**CLI gotcha hit during this triage:** `arc tasks --status X --limit N` sorts
`ORDER BY priority ASC, id ASC` — NOT by recency. A high `--limit` with a
status filter returns the *oldest* N matching rows, not the most recent. To
find a specific recent task by status, either use a very large limit (accept
the cost) or use `arc memory recall --query "<subject text>"`, which searches
completed-task history and returns results ordered usefully with summaries
attached — much faster for this kind of lookup.
