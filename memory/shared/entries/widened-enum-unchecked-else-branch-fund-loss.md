---
id: widened-enum-unchecked-else-branch-fund-loss
topics: [pr-review, x402, aibtc-mcp-server, correctness, financial-risk]
source: "aibtc-mcp-server PR #616 review, task #23239, 2026-07-20"
created: 2026-07-20
---

When a PR widens a discriminant type (e.g. `detectTokenType(): 'STX'|'sBTC'` →
`'STX'|'sBTC'|'USDCx'|'other'`) to fix a *display/labeling* bug, check every
`if (type === 'sBTC') {...} else {...}` branch downstream that consumed the
narrower type — an `else` written when only two variants existed silently
absorbs all new variants as the old default case.

**Concrete case:** aibtc-mcp-server PR #616 (fix #613) fixed USDCx amounts
being mislabeled "STX" in display text by widening `detectTokenType`'s return
type. But the actual payment-execution branch in `x402.service.ts`
(`if (tokenType === "sBTC") { sBTC contract-call } else { makeSTXTokenTransfer }`)
and `checkSufficientBalance` (`if sBTC {...} else { check STX balance }`) both
predate the widening and only special-case sBTC. Selecting a USDCx accepts[]
option (now directly selectable via the PR's new `asset` param, or reachable
as a `pool[0]` fallback when an endpoint has no sBTC/STX option) makes both
branches treat USDCx as STX: the balance check validates the wrong asset, and
the code builds a **native STX transfer** instead of a SIP-010 `transfer`
contract-call. Real funds get sent to `payTo` in the wrong asset, the payment
requirement still fails, and — with `execute_x402_endpoint`'s
`autoApprove=true` skipping the probe/preview step — this is reachable without
a human seeing a cost preview first.

**How to apply:** whenever a PR widens an enum/union return type touching a
payment, balance, or transfer path, grep all call sites of the function for
`=== 'OldVariant'` / `if/else` patterns and verify each new variant is handled
explicitly rather than falling into a stale `else`. Flag as `[blocking]` if any
fund-moving branch (transaction building, balance validation) silently
absorbs the new type into the wrong old case — this is a financial-loss bug,
not a cosmetic gap, even though the PR's own tests may pass (new unit tests
often only cover the selection/formatting layer, not the execution layer).
