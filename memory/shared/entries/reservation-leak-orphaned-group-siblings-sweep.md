---
id: reservation-leak-orphaned-group-siblings-sweep
topics: [social-x-posting, budget-ledger, reservation-leak, admission-control, sweep-gap]
source: task#22089, task#22165, task#22166
created: 2026-07-12
---

`releaseAbandonedReservations()` in `skills/social-engine/admission.ts` sweeps abandoned
`outbound_action` rows and decrements `budget_ledger.reserved_count` so a dead sender
doesn't leak reservations forever. #22089 added group-sibling release for a root that
dies mid-send (status='sending', a live lease). But the sweep's WHERE clause is narrow:

```sql
WHERE status='sending' AND provider_post_id IS NULL
  AND lease_expires_at IS NOT NULL AND lease_expires_at < ?
```

**Gap found 2026-07-12 (#22165/#22166):** a group that aborts BEFORE any row reaches
`claimForSend()` — e.g. `checkCreditsDepleted()` throwing right after `reserve-group`
admits the rows — leaves all group siblings at `status='queued'`, `lease_expires_at=NULL`.
This state is invisible to the sweep (`status != 'sending'`, `lease_expires_at IS NULL`),
so the reservation leaks permanently, silently eating lane headroom (`budget_ledger.reserved_count`)
every day until manually cleared. Concretely: Edition 8's daily-read post (task #22161)
hit exactly this — 4 rows stuck `queued` since 2026-07-12T13:15:05Z, `reserved_count=4/cap=6`
for the `daily-read` lane, which blocked Edition 9's `reserve-group` call the next cycle
with `budget_exhausted` even though Edition 9 would have voided on the same X-credits-depleted
gate anyway.

**Compounding bug:** task 22161's own summary claimed "reservation released cleanly, no
leak" — that claim was never verified against `budget_ledger`/`outbound_action` state,
it was inferred from the abort path completing without throwing an unhandled exception.

**Fix (filed, not yet shipped):** extend the sweep to also catch `status='queued'` rows
past a grace window (e.g. `created_at < now - 10min`), not just `status='sending'` with
a set lease.

**Pattern:** a "resource cleanup on failure" sweep that keys off one specific in-flight
status (`sending`) will miss earlier-lifecycle failures (`queued` that never got claimed).
When auditing a reservation/lease sweep, check EVERY status a row can be created into and
verify the sweep's WHERE clause actually covers all of them, not just the one status the
original bug report happened to hit.

See [[reserved-group-non-403-release-leak]] (the #22087 fix this backstops), [[x-reply-403-account-lock-cascade]].
