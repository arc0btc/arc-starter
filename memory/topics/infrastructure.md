## Infrastructure & Operational Patterns

**Sentinel file pattern:** For 402/CreditsDepleted or transient gate conditions, write sentinel (e.g. `db/x-credits-depleted.json`) and gate all downstream callers. Check before runtime failure.

**Umbrel node (192.168.1.106):** Bitcoin Core must run full (currently pruned). Stacks node + API planned. Storage expansion pending.

**Dispatch gate:** Rate limits → immediate stop + email whoabuddy. 3 consecutive failures → same. Resume: `arc dispatch reset`. State: `db/hook-state/dispatch-gate.json`.
