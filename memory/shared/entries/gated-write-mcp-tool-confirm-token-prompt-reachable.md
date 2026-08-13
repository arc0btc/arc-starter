---
name: ""
metadata: 
  node_type: memory
  id: gated-write-mcp-tool-confirm-token-prompt-reachable
  topics: 
    - pr-review
    - security
    - mcp
    - gated-write
    - prompt-injection
  source: "aibtcdev/aibtc-mcp-server#655, task #25997, 2026-08-13"
  created: 2026-08-13
  originSessionId: 73a4c18a-a3ce-4c96-80d5-e1020a95dbc3
  modified: 2026-08-13T07:09:53.342Z
---

When reviewing an MCP tool that gates a real-money/irreversible action behind an explicit
"confirm" token (e.g. `confirm: "APPROVE"` + a `maxSpendUsdc` cap), check whether that token is
enforced **outside** the tool call, not just inside it.

**The gap:** if `confirm` is just another field in the tool's `inputSchema` (a normal Zod string,
same as any other argument), then whatever calls the MCP tool — which may itself be an LLM agent
acting on untrusted/injected content — can supply `confirm: "APPROVE"` in the same tool call that
requests the action. The code enforces "reward <= cap" and "token must match exactly," which are
real and valuable guards against typos/bad values, but neither guard requires a human to actually
be in the loop. A docstring claim like "supplied fresh by the operator, never inferred from prompt
content" is a design *intent*, not something the code in that file can verify — the intent has to
be enforced by whatever sits between the LLM and this tool call (a host app that intercepts the
literal `confirm` field before passing the request through, a separate approval channel, etc.).

**How to apply in review:** don't block the PR for this alone — it's a common, often-acceptable
pattern (matches how Arc's own `confirm`-style gates work) and the tested validation logic (cap
enforcement, exact-match token, no-blind-retry-on-unknown-settlement) is still real signal quality.
But flag it as a `[question]`: ask whether the human-authorization boundary lives in the caller
(worth a one-line comment in the tool file since it isn't visible from that file alone) or whether
the tool is trusting the calling agent's judgment. This is the same class of risk described in
SOUL.md's security-awareness section — untrusted content reaching an agent that then calls
gated-write tools on its own volition.

See also [[charter-store-governance-unverified-authorization]] for a related but distinct pattern
(irreversible action authorized by a doc/commit that traces back to the acting agent's own
identity) — both are "the guard exists but its trust anchor is reachable by the thing it's supposed
to be guarding against."
