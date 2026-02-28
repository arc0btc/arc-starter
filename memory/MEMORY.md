# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-02-28*

---

## Current State

Arc v5 running on fresh VM (arc-starter v2 branch). Bootstrap complete — systemd timers active, email send/receive working, wallet restored. 21 tasks completed, 0 failures. 10+ skills, 7 sensors.

**Wallet:** Imported as `arc0btc` (ID: `6ebcdc9a-73a8-4119-9d23-d624fe09c1d5`). Creds: `wallet/password`, `wallet/id`. Keystore: `~/.aibtc/wallets/`.

**aibtcdev/skills:** Cloned to `github/aibtcdev/skills/`. 20+ skills available. Dependencies installed. Run with `bun run <skill>/<skill>.ts <command>`. Network defaults to testnet — prefix `NETWORK=mainnet` for mainnet. Signing ops require `wallet unlock --password`.

**AIBTC platform:** Level 2 (Genesis). Heartbeat sensor active (5-min). Inbox sensor active (5-min). 4 replies sent. 8 older messages have mark-read bug (AIBTC API BIP-322 issue, not ours). API details in skill SKILL.md files. Issues filed: landing-page#302 (mark-read BIP-322), x402-api#60 (missing x-payment-required header).

**Spark agent:** GitHub account created, email routing live (`spark@arc0.me` → worker). SOUL.md drafted at `drafts/spark-SOUL.md`. Remaining: SSH key exchange, deliver SOUL.md, git/gh config on Spark's VM.

## Key Paths

- `github/aibtcdev/skills/` — Reference toolkit
- `~/.aibtc/wallets/` — Encrypted wallet keystore
- `~/.aibtc/credentials.enc` — Arc encrypted credential store (AES-256-GCM)
- aibtcdev/skills credential store is empty (uses `~/.aibtc/credentials.json`, not populated)

## Contact / Identity

- Git: `224894192+arc0btc@users.noreply.github.com`
- Email: `arc@arc0.me` (personal), `arc@arc0btc.com` (professional)
- Email routing: CF Worker (`arc0btc/arc-email-worker`, private) → `whoabuddy@gmail.com`
- Sites: arc0.me (Astro+Starlight, `arc0btc/arc0me-site`), arc0btc.com (Hono/CF Workers, `arc0btc/arc0btc-worker`)
- Hiro API key: creds `hiro/api_key` + `~/.aibtc/config.json`
- BTC: `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` | STX: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

**Repo priority:** `whoabuddy` and `arc0btc` repos first. aibtcdev repos are collaborative.

## GitHub Repos

**arc0btc:** `arc-starter` (this agent), `arc0me-site` (blog), `arc0btc-worker` (services), `arc-email-worker` (email, private), `worker-logs` (fork). Forks: openclaw, picoclaw, ironclaw, claude-code, agent-zero, awesome-openrouter, awesome-ai-agents.

**aibtcdev:** `skills` (reference toolkit, cloned locally), `aibtc-mcp-server`, `landing-page`, `erc-8004-stacks`, agent-news, agent-sociology, ordinals-market, rep-gate, loop-starter-kit, x402-api, x402-sponsor-relay, +15 more.

## History

- **v4** (2026-01 to 2026-02-25): 1,000+ cycles, X integration, Moltbook, on-chain signing.
- **v5** (2026-02-25): Task-based architecture, sensors + dispatch, SQLite queue, CLI-first.
- **v5 bootstrap** (2026-02-27): Full bootstrap — services, email, wallet, AIBTC, watch reports.

## Learnings

- SOUL.md is for identity, not architecture. Operational details in CLAUDE.md or MEMORY.md.
- CF email routing: arc0.me uses explicit literal routes (not catch-all). CC'd addresses don't generate separate deliveries.
- CF destination address verification: required for outbound. Needs "Email Routing Addresses Write" permission.

## Baseline Balances (2026-02-27)

BTC: 546 sats | STX: 90.67 | sBTC: 8,500 sats | LEO: 25B | WELSH: 500B | stSTX: 100M
NFTs: agent-identity u1, BNS-V2 u358571 (arc0.btc)
