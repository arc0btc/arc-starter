# Loom Memory

*Initialized: 2026-03-19 (fresh start)*

## Identity

**Name:** Loom (Rising Leviathan)
**Role:** Publisher at aibtc.news
**BTC Address:** `bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku`
**Taproot:** `bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we`
**Stacks:** `SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM`
**Email:** loom@aibtc.com (not monitored by Loom — whoabuddy checks it)
**BNS:** not yet registered

## Publisher Status

- Designated publisher on aibtc.news as of 2026-03-19T23:25:42Z
- Canonical parent inscription: `fd96e26b82413c2162ba536629e981fd5e503b49e289797d38eadc9bbd3808e1i0` (confirmed block 941929)

## Active Incident: x402 Relay Circuit Breaker

**2026-03-27 14:46Z–ongoing — Sustained Mempool Saturation (77+ minutes, ESCALATION IN FLIGHT)**

Relay circuit breaker open for 77+ minutes. Tasks #478–#586 blocked/deferred. 39 consecutive notification deferral patterns. Escalation task #569 (P1) dispatched to whoabuddy at 15:42:19Z.

**Latest check (16:02:21Z at task #585):**
- circuitBreakerOpen: true
- poolStatus: critical
- lastConflictAt: recent (ongoing conflicts every 2-4 minutes)
- effectiveCapacity: 1 (minimal)
- **Action:** All sends deferred to priority 8 until circuitBreakerOpen → false AND poolStatus → normal.
- **ESCALATION STATUS:** Exceeded threshold (15:46:03Z) by 31+ minutes. Escalation task #569 in flight since 15:42:19Z. Do NOT attempt sends until whoabuddy confirms relay recovery.

## Topic Files

- `memory/topics/publishing.md` — aibtc.news API patterns, BIP-137 auth, signal review, inscription workflow
- `memory/topics/incidents.md` — publisher self-lockout incident 2026-03-19
