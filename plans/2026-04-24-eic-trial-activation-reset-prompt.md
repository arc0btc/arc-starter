# Reset-context prompt — EIC trial activation (post Phase 3)

Paste this into a fresh session to continue executing the EIC trial activation for Dual Cougar without re-establishing context.

---

You are Loom / @rising-leviathan, Publisher at aibtc.news. Continuing execution of the **EIC trial activation** for Dual Cougar under issue #634.

## Start here

Read in order:
1. `SOUL.md` — identity
2. `CLAUDE.md` — agent handbook
3. `memory/MEMORY.md` — operational state. **Note:** `Publisher Status` and `Full DRI roster` sections in memory are pre-activation and are intentionally not updated mid-flight (per plan hard constraint — memory updates happen after the Final step's #634 report-back). Trust the plan, not memory, for current activation state.
4. **`plans/2026-04-24-eic-trial-activation.md` — authoritative plan. All checkboxes and the `## Revisions` log are current. Ground every next action in this file.**

## Current state (2026-04-24, end of Phase 3)

**Phase 1 — complete.** Seat closures, DRI handoffs, platform admin-change all done. 10 GitHub comments live (`#568` umbrella closed, per-seat `#403`/`#438`/`#637`, DRI discussions `#609`/`#570`/`#622`/`#569`, `#644` Publisher framing, `#634` API question + outcome). All 3 beats show Dual Cougar (`bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0`) as sole active editor — verifiable at `GET /api/beats/{slug}/editors`.

**Phase 2 — Publisher-side complete, DC-side pending.** DC resolved end-to-end: BTC `bc1q9p6ch73nv4yl2xwhtc6mvqlqrm294hg4zkjyk0`, STX `SP105KWW31Y89F5AZG0W7RFANQGRTX3XW0VR1CX2M`, BNS `sable-arc.btc`, ERC-8004 id 12. `editor_registry` set manually (v2's `registry refresh` can't parse the new `beat.editor` object shape — not fixing, v2 is retired). Asked DC on #634 to (a) confirm STX and (b) approve one signal as a functional access test — awaiting both.

**Phase 3 — complete.** v2 `editor-payout` frozen (sensor renamed to `.retired` + in-function skip gate + SKILL.md retirement note). v3 `skills/eic-payout/` built with SKILL.md, cli.ts, sensor.ts, and `eic_payouts` audit table. Balance-check follow-on wired. Idempotency audit passed (all paths safe). Dispatch hygiene checked (`scripts/register-editors.ts` header rewritten as HISTORICAL).

**Final — pending on DC's signal-set handoff.**

## New files added today

- `scripts/reassign-editor.ts` — CLI for beat editor reassignment (DELETE + POST pattern). Takes `--beat`, `--to`, optional `--dry-run`.
- `skills/eic-payout/SKILL.md`, `cli.ts`, `sensor.ts` — v3 payout pipeline.
- `eic_payouts` table migration in `src/db.ts` (auto-created on next `initDatabase()`).

## Retired things (kept as reference, not active)

- `skills/editor-payout/sensor.ts.retired` — frozen. Sensors service discovers only `sensor.ts` (`src/sensors.ts:218`), so renamed file is inert. Early `return "skip"` added inside the function as a belt-and-suspenders gate if the file is ever put back.
- `skills/editor-payout/cli.ts` — still callable for historical queries (`registry list`, `status --date ...`). Don't use for new payouts.
- `scripts/register-editors.ts` — header now flags it as HISTORICAL; do not run. Use `scripts/reassign-editor.ts` for future reassignments.

## Next concrete action

Work the plan's **Final** phase. It's blocked on DC delivering an approved signal set for the 2026-04-24 brief. Until then:

1. Monitor #634 for DC's STX confirmation and functional-test ack. Reply when they land — tight operational replies, Publisher voice.
2. When the approved signal set arrives, run the accelerated Day 1 pipeline:
   - `arc skills run --name aibtc-news-editorial -- compile-brief --date 2026-04-24`
   - `bun run scripts/inscribe-brief.ts run --date 2026-04-24` (phased; dispatch queues continuations)
   - `arc skills run --name eic-payout -- calculate --date 2026-04-24` (sanity — `can_pay` should flip to true)
   - `arc skills run --name eic-payout -- execute --date 2026-04-24` (sends 400K, queues balance-check follow-on)
3. Confirm on #634 with txid + "first payment landed, DC fully in seat."
4. Then — and only then — do the memory updates listed in the plan's `§3 Final` block.

## Hard constraints (unchanged)

- **Do not touch `MEMORY.md`** or plan-archive work until the Final step's #634 report-back is posted. Memory updates are close-out hygiene, not mid-flight.
- **Forward-only scope.** Prior-structure disputes (#606, #613, #627, #628, #632, #637) stay on their own track. If they try to bleed into activation work: "Prior-structure claims remain on their original track; EIC trial is forward-only per #634."
- **Don't re-run `scripts/register-editors.ts`.** It would re-register Orb/Coda alongside DC and create a two-editor state. Use `scripts/reassign-editor.ts` if an editor ever needs to change.
- **Wallet-drain HOLD on Secret Mars remains** until attested new address lands. Independent of EIC's rate/role decisions.
- **Publisher does not backstop editor failures** under editor-covered model (per feedback memory `feedback_editor_covered_liability.md`).
- **Escalate to whoabuddy only on**: falsified proof, undisclosed self-dealing, ledger-visibility misses, anomalies >100 STX, or irreversible action.

## When in doubt

Re-read the plan. Every decision made during this activation is in §11 (Publisher decisions) and the `## Revisions` log. If a question isn't answered there or in `MEMORY.md`, surface it to the user before acting.

Begin.
