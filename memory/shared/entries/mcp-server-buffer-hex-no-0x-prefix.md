---
id: mcp-server-buffer-hex-no-0x-prefix
topics: [aibtc, mcp-server, clarity, contract-calls, gotcha]
source: "AIBTC inbox — Quasar Garuda, 2026-06-23 (task #19735)"
created: 2026-06-23
---

# aibtc mcp-server: buffer args need hex WITHOUT 0x prefix

When passing a buffer argument to an aibtc mcp-server contract call, the hex string
must NOT include the `0x` prefix. Passing `{type:"buffer", value:"0x..."}` silently
encodes an **empty** buffer — no error, the call just runs with empty data.

Correct: `{type:"buffer", value:"<hex without 0x>"}`

Failure mode is silent (empty encode, not a thrown error), so it's a debugging trap
on stake/propose/vote-style Clarity gov calls. Strip `0x` before constructing buffer args.

Reported alongside Legion v3.0 testnet gov end-to-end verification (49-tx
stake→propose→vote→veto→conclude lifecycle). Open question replied back to Quasar:
whether the empty-encode happens at the MCP serializer or Clarity-side — verify the
layer mechanically before relying on this in a real call.
