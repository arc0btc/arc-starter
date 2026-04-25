# Status check — EIC trial activation (paste into a fresh session)

Reusable prompt. Don't anchor your reasoning on stale timestamps; pull live state and report against the plan.

---

You are Loom / @rising-leviathan, Publisher at aibtc.news. The EIC trial activation for Dual Cougar (#634) was executed through Phase 1–3 on 2026-04-24. I want a **current status read only — do not take any action.** No new comments, no new issues, no code changes. Read, query, report.

## Required reading (fast)

1. `SOUL.md` — identity
2. `CLAUDE.md` — agent handbook
3. `plans/2026-04-24-eic-trial-activation.md` — authoritative plan with Phase 1/2/3 checkboxes and the `## Revisions` log. Trust the plan over `MEMORY.md` for current activation state (memory is intentionally pre-activation per the plan's hard constraints).
4. `plans/2026-04-24-eic-trial-activation-reset-prompt.md` — full Phase-1–3-complete context. Read if you need detail; skip if the plan is enough.

**Hard constraints** (still in effect):
- Do not touch `MEMORY.md` — close-out hygiene only, after Final phase report-back.
- Forward-only scope — prior-structure disputes (#606, #613, #627, #628, #632, #637) stay on their own track.
- Don't run `scripts/register-editors.ts` (HISTORICAL — would re-create a two-editor state).

## What I want to know

Pull these in parallel where possible:

### 1. DC platform access (#634)
- Did DC (`@teflonmusk`) confirm the STX address `SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M`?
- Did DC complete the functional signal-approval test (any signal approved on any beat by DC)?
- Commands:
  - `gh issue view 634 --repo aibtcdev/agent-news --comments --json comments --jq '.comments[] | select(.author.login=="teflonmusk") | {at: .createdAt, body: (.body[0:300])}'`
  - `curl -s "https://aibtc.news/api/signals?status=approved&limit=20" | jq '.signals[] | select(.editor_address=="bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0" or .reviewed_by=="bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0")'`

### 2. Day 1 brief — 2026-04-24
- Did the brief compile? Inscribe?
- Did v3 `eic-payout` fire?
- Commands:
  - `curl -s https://aibtc.news/api/brief/2026-04-24 | jq '{compiledAt, inscribedAt, signalCount, sections: ((.sections // []) | length)}'`
  - `arc skills run --name eic-payout -- status --date 2026-04-24`
  - `arc skills run --name eic-payout -- balance-check --next-date 2026-04-25`

### 3. #644 rubric evolution
- Last known position: DC (`@teflonmusk`) was iterating live, accepting whoabuddy's SpaceX restructure (binary gates + continuous score). The last comment I tracked was @KaranSinghBisht proposing a gate-name taxonomy + preflight linter at 2026-04-24T19:49Z.
- Has DC posted v3 / locked the rubric since?
- Command: `gh issue view 644 --repo aibtcdev/agent-news --comments --json comments --jq '.comments[] | {at: .createdAt, who: .author.login, body: (.body[0:300])}' | tail -40`

### 4. v2 silence check
- The v2 `editor-payout` sensor was frozen 2026-04-24 (file renamed to `.retired` + in-function skip gate). Confirm no v2 payouts hit since.
- Command:
  - `bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log(d.query('SELECT date, beat_slug, editor_name, amount_sats, status, txid FROM editor_payouts WHERE date >= ? ORDER BY date DESC, beat_slug').all('2026-04-24'));"`
  - Any rows for date >= 2026-04-24 → flag immediately. None expected.

### 5. Held work — the 5-issue plan
A 5-issue plan was drafted (in conversation) to file on `aibtcdev/agent-news` for platform-code gaps surfaced in #644 feedback: (1) source-scoring formula vs tier hierarchy, (2) per-beat approval caps under 1-EIC, (3) quantum cluster cap semantics + discoverability, (4) disclosure field clarity, (5) rejection feedback granularity. **Held — not filed.** If DC's v3 lock has resolved any of these in-rubric, flag which still need filing and which can be dropped.

### 6. Cross-thread movement
- #634: Opal Gorilla (@Robotbot69) had ack'd. Anyone else moved since?
- Prior-structure dispute threads (#606, #613, #627, #628, #632, #637): any new escalations Publisher must address? Cap at one-line each.

## Output format

Single status table, then a short next-action suggestion. Keep total response under ~500 words.

```
| Item                          | Status                          | Evidence (one line)                              |
|-------------------------------|---------------------------------|--------------------------------------------------|
| DC STX confirmation (#634)    | ✓ / pending / blocked           | comment ID or "no reply"                         |
| DC functional test (approvals)| ✓ / pending                     | first approval at <ts> on <beat> / "0 approvals" |
| Day 1 brief compile           | ✓ / not compiled                | compiledAt or null                               |
| Day 1 brief inscribe          | ✓ / not inscribed               | inscribedAt or null                              |
| v3 eic-payout fired           | ✓ / pending / skipped-no-signals| txid or status:none                              |
| Balance ok for next day       | ✓ / short                       | balance vs 400K                                  |
| v2 sensor silence             | confirmed / BREACH              | row count for date >= 2026-04-24                 |
| #644 rubric                   | locked / iterating / silent     | latest commenter + ts                            |
| Held 5-issue plan             | still held / needs reshape      | one line on what changed                         |
| Other thread escalations      | none / list                     | issue # + one-line                               |
```

Then 1–2 sentences:
- **Next concrete Publisher action** (or "no action required, holding").
- **Anything that needs the user's call** before continuing.

Do not post, file, or commit anything. Just report.
