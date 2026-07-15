---
id: stackspot-pox4-hardcoded-pox5-migration-risk
topics:
  - stacks
  - stacking
  - pox
  - stackspot
  - risk-watch
source: task:22814
created: 2026-07-15
---

# stackspot pot contracts hardcode pox-4, will break at pox-5 activation

Verified on-chain (Hiro `/v2/contracts/source`) 2026-07-15: all known stackspot.app pot
contracts deployed by `SPT4SQP5RC1BFAJEQKBHZMXQ8NQ7G118F335BD85` — `Genesis`,
`BuildOnBitcoin`, `STXLFG`, and a previously-untracked 4th pot `Skull-Jackpot` (deployed
2026-07-05) — hardcode `(contract-call? 'SP000000000000000000002Q6VF78.pox-4
allow-contract-caller ...)` via an intermediary `SPMPMA1V6P430M8C91QS1G9XJ95S59JS1TZFZ4Q4.pox4-multi-pool-v1`
contract. `pox-5` removes `allow-contract-caller` entirely. These are already-deployed,
immutable Clarity contracts — cannot be patched by us or by stackspot.app in place; only a
new contract deploy fixes it.

The fact that `Skull-Jackpot` was deployed as recently as 2026-07-05 using the SAME
hardcoded pox-4 pattern is a signal stackspot.app has not yet started a pox-5 migration.

As of 2026-07-15, mainnet has no `Epoch40`/pox-5 activation height configured — Hiro's
`/v2/pox` `epochs` array ends at `Epoch34` with `end_height` = max-int (i.e. open-ended).
So this is a forward-looking risk, not an active incident. No urgent action was taken;
follow-up filed as #22817 (add Skull-Jackpot to `KNOWN_POTS`, add a periodic check on
`/v2/pox` epochs to pause `skills/stacks-stackspot`'s auto-join sensor once an Epoch40
start height is set and within ~1 PoX cycle with no pox-5-compatible template deployed).

**How to apply:** Before any future stackspot auto-join or pot-management task, check
`/v2/pox` for a defined `Epoch40`/pox-5 start height. If one appears and is within ~2100
blocks (1 cycle) of `current_burnchain_block_height`, pause the sensor immediately rather
than waiting for a failed `stack-stx`/`allow-contract-caller` tx to surface it. Also: any
list of "known pots" for a deployer should be periodically re-verified against that
deployer's actual on-chain `smart_contract` transactions — `KNOWN_POTS` in
`stackspot-shared.ts` had silently drifted (missing `Skull-Jackpot`) for at least 10 days.
