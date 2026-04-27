# Resume prompt — Phase L soak check-in (paste into a fresh session)

Reusable. Don't anchor your reasoning on stale timestamps in this file or in memory — **pull live state and report against the soak criteria.**

---

You are Loom / @rising-leviathan, Publisher at aibtc.news. We just shipped the publisher-side Phase L fixes from `plans/2026-04-26-eic-recovery-and-nonce-hygiene.md` on branch `fix/nonce-recovery-shining-example`. The sprint is documented in [arc0btc/arc-starter#21](https://github.com/arc0btc/arc-starter/issues/21). We're currently soaking the changes against organic daily-cycle traffic before re-enabling `agent-welcome` (Phase L6) and opening the PR.

## Required reading (in order)

1. `SOUL.md` — identity
2. `CLAUDE.md` — agent handbook
3. `plans/2026-04-26-eic-recovery-and-nonce-hygiene.md` — the recovery plan with phase-by-phase status (Phases A–F + G–H complete; L2–L5 + L6-prep complete on branch; L1 handed off; L6 deferred until soak passes)
4. `db/payouts/eic-2026-04-24/audit.md` + `recovery-2026-04-26.md` — final recovery log (only useful for context)
5. `gh issue view 21 -R arc0btc/arc-starter` — sprint issue with soak criteria checkboxes

## Hard constraints (still apply)

- **No on-chain broadcasts without explicit user approval.** Any gap-fill, RBF, or manual payout retry needs dry-run + user "go" before send.
- **Do not un-pause `agent-welcome`.** It stays paused (`skills/agent-welcome/sensor.ts.paused`) until the soak passes. Re-enabling means renaming back to `sensor.ts` AND removing the early `return "skip"` line — both required.
- **Do not pause `inbox-notify`.** Correspondents need signal-approval notifications during the trial.
- **Memory edits are now permitted** (Phase G is complete) — but only update entries that have actually changed. Don't churn memory just because.

## What to do first

Pull live state in parallel and produce a status report. Don't act until the user confirms next steps.

```bash
# 1. Sprint issue + branch state
gh issue view 21 -R arc0btc/arc-starter --json state,title,comments | jq '{state, title, recent_comments: [.comments[-3:][] | {author: .author.login, createdAt}]}'
git log --oneline main..fix/nonce-recovery-shining-example 2>&1 | head -10
git status --short | head -10

# 2. Chain state — publisher wallet
curl -s "https://api.hiro.so/extended/v1/address/SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM/nonces" \
  | jq '{last_executed_tx_nonce, last_mempool_tx_nonce, possible_next_nonce, detected_missing_nonces}'
curl -s "https://api.hiro.so/extended/v1/address/SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM/mempool" \
  | jq '{total: .total, results: [.results[] | {nonce, tx_status, tx_id}] | sort_by(.nonce)}'

# 3. Reconciler state — receipt-driven, the heart of Phase L
arc skills run --name nonce-manager -- soak-report --address SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM
arc skills run --name nonce-manager -- broadcasts --address SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM | head -50

# 4. Phantom alerts — the soak failure signal
bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log(JSON.stringify(d.query(\"SELECT id, status, subject, created_at FROM tasks WHERE source LIKE 'sensor:nonce-reconcile:phantoms:%' ORDER BY id DESC LIMIT 10\").all(), null, 2));"

# 5. Day 4 EIC payout state — should fire ~09:00 UTC daily
arc skills run --name eic-payout -- status --date $(date -u +%Y-%m-%d)
arc skills run --name eic-payout -- status --date $(date -u -d 'yesterday' +%Y-%m-%d)
bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log(JSON.stringify(d.query('SELECT * FROM eic_payouts ORDER BY date DESC LIMIT 5').all(), null, 2));"

# 6. Brief-inscribed notification cycle — Day 4's first real test of the new x402-send path
bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log(JSON.stringify(d.query(\"SELECT id, status, subject, completed_at FROM tasks WHERE subject LIKE 'Notify editors of % brief inscription%' ORDER BY id DESC LIMIT 5\").all(), null, 2));"
ls -la db/inbox-notify/brief-inscribed-*.json 2>/dev/null | tail -5

# 7. Contact-registry backfill sensor — should fire every 6h
bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log(JSON.stringify(d.query(\"SELECT id, status, subject, created_at, completed_at FROM tasks WHERE source LIKE 'sensor:contact-registry-backfill:%' ORDER BY id DESC LIMIT 5\").all(), null, 2));"
bun -e "import {Database} from 'bun:sqlite'; const d=new Database('db/arc.sqlite',{readonly:true}); console.log('local agent count:', d.query(\"SELECT COUNT(*) AS n FROM contacts WHERE type='agent'\").get()); console.log('eligible for welcome:', d.query(\"SELECT COUNT(*) AS n FROM contacts c WHERE c.type='agent' AND c.status='active' AND c.btc_address IS NOT NULL AND c.stx_address IS NOT NULL AND c.agent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contact_interactions ci WHERE ci.contact_id=c.id AND ci.type='outreach')\").get());"
curl -s "https://aibtc.com/api/agents?limit=1" | jq '.pagination.total'  # upstream agent count

# 8. agent-welcome sensor state (should still be paused)
arc sensors list | grep -E "agent-welcome|nonce-reconcile|contact-registry" || echo "(agent-welcome correctly NOT listed — paused)"
ls skills/agent-welcome/sensor.ts.paused skills/agent-welcome/sensor.ts 2>&1

# 9. Tests still green
bun test skills/nonce-manager/ skills/inbox-notify/ skills/contact-registry/ 2>&1 | tail -5
```

## Soak success criteria (from issue #21)

Report each as ✅ / ⏳ / ❌:

1. **Day 4 brief notify cycle** — completed cleanly, all 3 messages reached `confirmed` via `nonce-reconcile` within ~3 cycles each
2. **Day 4 EIC payout** — landed at next nonce post-1941 (probably 1942 or higher depending on inbox-notify activity); confirmed on chain
3. **Reconciler `pending_broadcasts`** — returns to 0 between cycles; never accumulates
4. **Hiro `detected_missing_nonces`** — `[]` continuously
5. **Phantom alert tasks** — none queued by `sensor:nonce-reconcile:phantoms:*` source

## Decision tree

After reporting state:

- **All five ✅:** recommend Phase L6 (un-pause `agent-welcome`). Rename `skills/agent-welcome/sensor.ts.paused` → `sensor.ts` AND remove the early `return "skip"` belt-and-suspenders line. Wait for explicit user "go" before doing it.
- **Phantoms detected (criterion 5 ❌):** drill into the phantom alert task description — it lists each `(address, nonce, source, outcome, detail)` tuple. Identify which skill path produced it. Don't gap-fill until user approves.
- **Day 4 EIC payout missing or failed (criterion 2 ❌):** check `eic_payouts` row for today; if `status='failed'` it needs a manual retry (Phase F-style) — but only after user approves and the chain is gap-clean.
- **Reconciler accumulating pending (criterion 3 ❌) without phantoms:** could be relay-side index lag. Spot-check a few `pending` rows by hand against Hiro / payment-status to verify they're transient. TTL is 30 min before they become `expired`.
- **Backfill sensor not firing (criterion 7 from check 7):** sensor cycle runs every 6h; check if last task is older than 6h+1m. If yes, look at sensor cycle logs for errors.

## Output

Two parts, in this order:

1. **Status table** — five soak criteria + their state + the relevant data point each.
2. **One-paragraph recommendation** — what to do next, gated on the criterion outcomes. Don't execute. Wait for user "go".

If everything is clean and the user says "go", proceed to Phase L6 (agent-welcome un-pause) — but flag explicitly the two-step nature: rename + remove the `return "skip"` line. Then offer to open the PR (push the branch + `gh pr create`) once L6 is in place.
