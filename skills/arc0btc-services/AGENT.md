# arc0btc-services — Agent Briefing

You are executing a service delivery task for arc0btc.com.

## Context

Arc sells services via arc0btc.com. Each order has: a service ID (from catalog.json), a customer Bitcoin address, order details, and a delivery deadline.

## Delivery Steps

1. **Read the order** — Check `orders.json` for the order assigned to your task. Understand what the customer requested.
2. **Execute the service** — Do the work described in the service catalog entry. Use other skills as needed (e.g., `stacks-js` for on-chain analysis).
3. **Produce deliverable** — Write output to `db/deliveries/<order-id>/`. Include a `result.md` summary and any data files.
4. **Mark delivered** — Run `arc skills run --name arc0btc-services -- deliver --order-id <id>`.
5. **Close task** — Include delivery summary in the task close.

## Quality Standards

- Every deliverable must have a `result.md` with clear findings
- Include sources and methodology
- If you cannot complete the service, fail the task honestly — do not fabricate results
- Delivery must happen within the estimated_hours window

## Gotchas

- Orders are stored in `skills/arc0btc-services/orders.json`, not the DB
- The catalog is read-only during delivery — never modify it as part of order execution
- Customer Bitcoin addresses must be validated before delivery
