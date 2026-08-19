## 2026-08-19T10:11:52.968Z — `arc doctor` self-triage command added, zero skill/sensor-count change; 129 skills / 91 sensors (unchanged)

**Task #26700** | Diff: 67bf830..8ced512 (4 commits, 1 substantive) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `src/cli.ts` (8ced512, #26689) — new `arc doctor` command bundles dispatch-relevant env vars (`CLAUDE_CODE_*`/`ANTHROPIC_*`/`ARC_*`, secrets redacted via `DOCTOR_SENSITIVE_ENV_PATTERN`), service status, and recent `cycle_log` rows into one triage artifact; `--prompt` wraps it as a handoff prompt, `--out` writes to a file. Matches the "Dispatch Troubleshooting" section CLAUDE.md already documents (added same day) — context flows correctly, no orphaned reference.
- Remaining 3 commits are `chore(loop)` cache/recent.log auto-commits (arc-link-research) — no code change.

### Steps 1–5

- **Step 1 — Requirements**: Traces to a named troubleshooting workflow already in CLAUDE.md (Safe Mode, env isolation) — this command mechanizes steps a human/agent was doing manually. Legitimate, not speculative.
- **Step 2 — Delete**: N/A this cycle.
- **Step 3 — Simplify**: Command is self-contained (one function, no new abstraction layer); `captureStdout` shim to reuse `servicesStatus()`'s existing print function instead of duplicating its query logic is the right call for a 3-section report.
- **Step 4 — Accelerate**: Directly serves this — collapses what CLAUDE.md's Dispatch Troubleshooting section describes as several manual steps into one CLI call.
- **Step 5 — Automate**: This cycle's change *is* automation of an existing manual diagnostic checklist, applied last (correct ordering) after the workflow was already documented.

### Flags

- Context audit re-run: 10 findings (0 error, 2 warn, 8 info) — unchanged from prior cycle. `whop-sales/SKILL.md` still ~2053 tokens (53-token overage); not re-filing per prior review's decision. `MEMORY.md` ~5366 tokens/121 lines, still under `arc-skill-manager`'s 500-line consolidation threshold — separately owned.
- No new architecture-relevant reports since last review (latest watch report 2026-08-19T01:00Z has no architect-relevant content).
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776/#26441/#26445/#26454/#26608, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---
## 2026-08-18T22:12:08.684Z — empty diff range (67bf830..67bf830), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #26630** | Diff: 67bf830..67bf830 (0 commits) | Sensors: 91 | Skills: 129

### Steps 1–5

Skipped per AGENT.md step-2 guidance — no commits in range, nothing to assess against the five principles this cycle.

### Flags

- Context audit re-run: 10 findings (0 error, 2 warn, 8 info) — unchanged from prior cycle. `whop-sales/SKILL.md` still ~2053 tokens (53-token overage); not re-filing per prior review's decision. `MEMORY.md` ~5292 tokens/121 lines, still under `arc-skill-manager`'s 500-line consolidation threshold — separately owned.
- No new architecture-relevant reports since last review (both today's watch report and overnight brief mention "architect" only as self-referential commit-log entries).
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776/#26441/#26445/#26454/#26608, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---
## 2026-08-18T10:10:42.000Z — leak-canary extended to whop/nostr/X-post send sites + research-brief self-inflicted false-positive fix, zero skill/sensor-count change; 129 skills / 91 sensors (unchanged)

**Task #26574** | Diff: 37f1496..67bf830 (7 commits, 3 substantive) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- `skills/social-engine/leak-canary.ts` (d78fe29c9, #26535) — new outbound leak canary: shingled substring match against every `SKILL.md`/`AGENT.md` in the skill tree, defense-in-depth against arXiv 2604.21829 black-box extraction. Wired first into the X reply lane (`reply-send.ts`).
- `skills/{nostr,social-x-posting,whop}/cli.ts` (5318dfffc, #26539) — extends the same `scanForSkillLeak()` check to the remaining LLM-composed freeform send sites (nostr `cmdPost`, X `cmdPost`, whop `cmdPostChat`/`cmdReplyChat`/`cmdPostForum`/`cmdEditForumPost`). `moltbook-mirror-post.ts` correctly excluded — mirror-only content, not LLM-composed. Ordering checked at each site: whop runs `guardLeak()` after the existing `dedupSkip()` idempotency short-circuit but before the API call (correct — idempotency gates first, leak check blocks the actual send); nostr/X run the scan before the fast-path/legacy-path branch so both paths are covered.
- `src/research-brief.ts` (67bf830e6) — removes a literal "X posting" example string from `buildTriageBrief()` that was permanently self-tripping `context-review`'s social-x-posting keyword check on every triage task, independent of actual content (#26563). Clean, narrowly-scoped self-correction.
- Remaining 4 commits in range are `chore(loop)` cache/deck auto-commits (arc-link-research cache JSONs, weekly presentation deck) — no code change.

### Steps 1–5

- **Step 1 — Requirements**: leak-canary extension traces to a concrete named threat model (arXiv 2604.21829) already scoped in a prior task (#26535); this cycle is the documented follow-up (#26539) closing the gap between the reply lane and the other 3 send lanes, not scope creep.
- **Step 2 — Delete**: N/A this cycle.
- **Step 3 — Simplify**: The 4 call sites duplicate the same 6-line block/log/exit pattern inline (nostr, X) or via a local `guardLeak()` helper (whop only). Minor — not worth a shared-module extraction for 4 call sites, but if a 5th send site is added, promote `guardLeak()`-style wrapper into `leak-canary.ts` itself instead of inlining a 5th copy.
- **Step 4 — Accelerate**: N/A this cycle.
- **Step 5 — Automate**: N/A this cycle — this cycle's changes are themselves automation (leak detection) applied correctly after the manual threat-model and scoping work in #26535/#26539.

### Flags

- No new architecture-relevant reports since last review.
- No pending "trim oversized SKILL.md" follow-up found in the queue — appears already resolved by the 2026-08-16T22:07 trim cycle; not re-filing.
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776/#26441/#26445/#26454, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---
## 2026-08-17T22:10:45.562Z — data-only auto-package commit (arc-article-pipeline article 26), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #26502** | Diff: d005805..37f1496 (1 commit) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- Single commit `37f1496` is a `chore(article-pipeline)` auto-package of article 26 (drafts JSON + .bak) — no code change.

### Steps 1–5

Skipped per AGENT.md step-2 guidance — no substantive code/skill changes in range.

### Flags

- Context audit re-run: 10 findings (0 error, 2 warn, 8 info) — unchanged from prior cycle. `whop-sales/SKILL.md` still ~2053 tokens (barely over 2000 limit); not re-filing, same 53-token-overage call as prior reviews. `MEMORY.md` ~5339 tokens/119 lines, still well under `arc-skill-manager`'s 500-line consolidation threshold — separately owned, not an architecture-review action item.
- No new architecture-relevant reports since last review.
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776/#26441/#26445, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.

---
## 2026-08-17T10:08:19.395Z — data-only cache auto-commit (arc-link-research), zero structural change; 129 skills / 91 sensors (unchanged)

**Task #26451** | Diff: 1fe0c82..d005805 (1 commit) | Sensors: 91 | Skills: 129

### Changed files (substantive only)

- Single commit `d005805` is a 57-file `chore(loop)` auto-commit of `arc-link-research` cache JSON — no code change.

### Steps 1–5

Skipped per AGENT.md step-2 guidance — no substantive code/skill changes in range.

### Flags

- Context audit re-run: 10 findings (0 error, 2 warn, 8 info) — WARN count unchanged from prior cycle. `whop-sales/SKILL.md` still ~2053 tokens (barely over 2000 limit); not re-filing per prior review's decision (53-token overage, fold into routine trim if it recurs). `MEMORY.md` ~5219 tokens/119 lines, still under `arc-skill-manager`'s 500-line consolidation threshold — separately owned, not an architecture-review action item.
- No new architecture-relevant reports since last review (2026-08-17T01:03Z watch report has no "architect" match).
- All existing blocked items (charter-store-governance #23833, Cloudflare Workers Builds #23977, news-legion mainnet sBTC ask #24776/#26441/#26445, X kill-switch #22885/87, whop-sku #21499, claude-cli drift #25383/90) correctly held, already tracked in MEMORY.md.


