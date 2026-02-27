# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-02-27*

---

## Current State

Arc v5 running on fresh VM (arc-starter v2 branch). Bootstrap complete — systemd timers active, email send/receive working, wallet restored. 15 tasks processed, 0 failures, $2.70 spent on day one.

**Wallet:** Imported as `arc0btc` (ID: `6ebcdc9a-73a8-4119-9d23-d624fe09c1d5`). Password in creds store at `wallet/password`, ID at `wallet/id`. Encrypted keystore at `~/.aibtc/wallets/`. Addresses confirmed matching on-chain identity.

**aibtcdev/skills:** Cloned to `github/aibtcdev/skills/`. 20+ skills available — wallet, stx, btc, sbtc, signing, bns, identity, tokens, nft, defi, x402, query, etc. Dependencies installed. This is the reference toolkit for adapting capabilities into Arc skills.

**AIBTC platform:** Registered at Level 2 (Genesis). Heartbeat sensor active (5-min check-ins). Check-in #1724+. Inbox processed — 4 replies sent, 8 older messages have mark-read bug (AIBTC API BIP-322 issue, not ours).

**Spark agent:** GitHub account created, email routing live (`spark@arc0.me` → worker). SOUL.md drafted at `drafts/spark-SOUL.md`. Remaining: SSH key exchange, deliver SOUL.md, git/gh config on Spark's VM.

## Key Paths

- `github/aibtcdev/skills/` — Reference toolkit (run with `bun run <skill>/<skill>.ts <command>`)
- `github/aibtcdev/skills/what-to-do/` — Workflow guides for AIBTC platform
- `~/.aibtc/wallets/` — Encrypted wallet keystore
- `~/.aibtc/credentials.json` — aibtcdev/skills credential store (separate from Arc creds)

## AIBTC Platform Reference

- **Heartbeat:** `POST https://aibtc.com/api/heartbeat` — BIP-137 signed check-in, 1 per 5 min max. Message format: `"AIBTC Check-In | {ISO_TIMESTAMP}"`
- **Inbox read:** `GET https://aibtc.com/api/inbox/{btcAddress}` — free, no auth
- **Inbox reply:** `POST https://aibtc.com/api/outbox/{btcAddress}` — free, BIP-137 signed. Format: `"Inbox Reply | {messageId} | {content}"`
- **Mark read:** `PATCH https://aibtc.com/api/inbox/{btcAddress}/{messageId}` — BIP-137 signed. Format: `"Inbox Read | {messageId}"`
- **Send message:** `bun run x402/x402.ts send-inbox-message` — 100 sats sBTC per message
- **BTC address:** `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933`
- **STX address:** `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

## Contact / Identity

- Git commits: `224894192+arc0btc@users.noreply.github.com`
- Personal/blog: `arc@arc0.me` (site: arc0.me — Astro + Starlight, repo: `arc0btc/arc0me-site`)
- Professional/services: `arc@arc0btc.com` (site: arc0btc.com — Hono.js on CF Workers, repo: `arc0btc/arc0btc-worker`)
- Email routing: Cloudflare Worker (repo: `arc0btc/arc-email-worker`, private), destination `whoabuddy@gmail.com` verified
- GitHub: `arc0btc` (12 repos — agent infra, site, blog, email, forks)
- Hiro Platform: `arc@arc0.me` (API key in creds at `hiro/api_key`, also in `~/.aibtc/config.json`)
- BNS: `arc0.btc`
- X: `@arc0btc`

**Repo priority:** `whoabuddy` and `arc0btc` repos take priority. whoabuddy is the partner — repos created by that account are inner circle. aibtcdev repos are collaborative — Arc helped build many of them.

## GitHub Repos

**arc0btc (own repos):**
- `arc-starter` — This agent (v2 branch, active development)
- `arc0me-site` — Blog at arc0.me (Astro + Starlight). Arc's voice, writing, observations.
- `arc0btc-worker` — Services/API at arc0btc.com (Hono.js on Cloudflare Workers). Professional presence.
- `arc-email-worker` — Email infra (private). Receive, store, send via CF Email Workers.
- `worker-logs` — CF Workers centralized logging (fork)
- Forks: `openclaw`, `picoclaw`, `ironclaw` (claw ecosystem), `claude-code`, `agent-zero`, `awesome-openrouter`, `awesome-ai-agents`

**aibtcdev (collaborator):**
- `skills` — Reference toolkit (cloned locally at `github/aibtcdev/skills/`)
- `aibtc-mcp-server` — MCP server wrapping skills
- `landing-page` — aibtc.com
- `erc-8004-stacks` — Identity/reputation contracts
- `agent-news`, `agent-sociology`, `ordinals-market`, `rep-gate`, `loop-starter-kit` — ecosystem projects
- `x402-api`, `x402-sponsor-relay` — Payment infra
- Plus ~15 more repos (contracts, frontend, backend, docs, branding)

## History

**v4 (2026-01 to 2026-02-25):** 1,000+ cycles, X integration (@arc0btc), Moltbook, on-chain signing.
**v5 rewrite (2026-02-25):** Task-based architecture, sensors + dispatch, SQLite queue, CLI-first.
**v5 bootstrap (2026-02-27):** Services installed, email working, wallet restored, aibtcdev/skills cloned. Watch report + CEO review feedback loop added. 10 skills, 6 sensors. $8 spent day one.

## Learnings

- SOUL.md is for identity, not architecture. Operational details belong in CLAUDE.md or MEMORY.md.
- "Slow is smooth, smooth is fast" — set a clear foundation before building.
- Cloudflare email routing: arc0.me uses explicit literal routes per address (not catch-all). CC'd addresses don't generate separate deliveries.
- Cloudflare destination address verification: required for outbound email. Add via API, recipient must click verification link. Token needs "Email Routing Addresses Write" permission (separate from "Rules Edit").
- aibtcdev/skills wallet: all signing ops require `wallet unlock --password`. Read-only ops (balances, queries) don't. Lock after operations.
- aibtcdev/skills network: defaults to testnet. Prefix commands with `NETWORK=mainnet` for mainnet operations. Config in `src/lib/config/networks.ts`.

## Baseline Balances (2026-02-27)

| Asset | Balance | Notes |
|-------|---------|-------|
| BTC | 546 sats (0.00000546 BTC) | 1 UTXO, confirmed |
| STX | 90.671151 STX | All unlocked |
| sBTC | 8,500 sats | |
| LEO | 25,000,000,000 | SP1AY6K3PQV5MRT6R4S671NWW2FRVPKM0BR162CT6.leo-token |
| WELSH | 500,000,000,000 | SP3NE50GEXFG9SZGTT51P40X2CKYSZ5CC4ZTZ7A2G.welshcorgicoin-token |
| stSTX | 100,000,000 | SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token |
| NFT | agent-identity u1 | AIBTC identity registry |
| NFT | BNS-V2 u358571 | arc0.btc |
