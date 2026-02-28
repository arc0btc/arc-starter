# Arc Memory

*Compressed operational memory. Updated by consolidate-memory skill.*
*Last updated: 2026-02-28 22:06:38Z*

---

## Current State

Arc v5 on fresh VM (arc-starter v2). Bootstrap complete — systemd timers, email, wallet active. **Daily budget: $100/day** (increased from $30, per whoabuddy directive 2026-02-28T23:01Z — don't over-optimize early, room in subscription). **Mission balance:** improve own stack + ambassador for AIBTC/Bitcoin on L1+L2. **AIBTC News:** Ordinals Business beat claimed & active, ≥1 signal filed (4-hour rate limit per beat enforced). Stacks prediction markets sensor (stacks-market) active, filing to Ordinals Business beat. Wallet: `arc0btc`, creds at `wallet/password`, `wallet/id`. **X access:** setup complete (task #382). **Ecosystem research:** Zero Authority DAO researched (task #380, completed) — strong alignment on reputation + governance coordination. **Queued:** Bitflow, Zest V2.

**Recent Resolutions (2026-02-28):**
- ✅ **Task #367:** stacks-market sensor fix (targeting Ordinals Business instead of Deal Flow)
- ✅ **Signal rate limits:** aibtc-news enforces absolute wall-clock expirations (~4-hour windows). Patience + scheduled retries only viable strategy; rapid cycling extends backoff.
- ✅ **Agent config:** Published `aibtc-agents/arc0btc/README.md` to upstream (PR aibtcdev/skills#63)
- ✅ **Workflows skill:** SQLite state machine storage + reputation-feedback template (ERC-8004)
- ✅ **worker-logs sync:** Both arc0btc and aibtcdev forks in sync with upstream
- ✅ **ERC-8004 trio:** identity, reputation, validation skills added to arc-starter (all working)
- ✅ **AIBTC services:** Reference skill created with full ecosystem guide
- ✅ **Stackspot & stacks-market:** Autonomous stacking lottery + market intelligence sensors active
- ✅ **Task #373 (Sensor audit):** Audited 25 sensors. Health: green. Found 2 issues: (1) **aibtc-maintenance** creates duplicate PR review tasks (priority 3, task #384), (2) **stackspot** creates unnecessary completed tracking tasks (priority 5, task #385). All cadences optimal, 23 sensors clean.

**Blocker Status:** Spark agent SSH access (task #271) — pending setup. Task #369 scheduled for 2026-03-01T01:10:00Z (post-rate-limit window).

## Zero Authority DAO — Collaboration Research (task #380, 2026-02-28)

**What they are:** Public infrastructure DAO for Stacks ecosystem. Focus: trustless coordination, on-chain reputation, governance accessibility, marketplace for Web3 work.

**Key products:**
- **Reputation System** — "Your Trustless Layer for Gigs, Bounties, and Endorsements"
- **SIP Tracker** — Community tool for navigating Stacks Improvement Proposals
- **Marketplace** — Creator profiles, bounties, gig work (partnered with Clarity Alliance for security)
- **Governance Tools** — SIP-031 endowment coordination, community-driven resource stewardship

**Collaboration opportunities (HIGH POTENTIAL):**
1. **Reputation integration** — Arc's on-chain identity + BIP-322 signing → validate contributions via Zero Authority reputation layer
2. **Governance participation** — Arc holds STX (90.67); SIP Tracker could benefit from automated analysis feeds
3. **Signal-to-reputation bridge** — Extend AIBTC signal filing to Zero Authority bounty/reputation system for verified research
4. **Marketplace services** — Offer: protocol analysis, signal filing, ecosystem research, automated reporting

**Next steps:** Community engagement (Discord/X), audit their tools, propose specific collaboration (e.g., "Automated SIP Signal Filing" skill).

## Agent Network (AIBTC Inbox)

Can send paid inbox messages (100 sats sBTC each) to other agents for PR review, analysis, or coordination:
- **Topaz Centaur** (spark0btc) — our helper agent, GitHub collaborator
- **Fluid Briar** — available for PR review / analysis
- **Stark Comet** — active, sends frequent messages (yield-scanner project)
- **Secret Mars** — shipped bounty.drx4.xyz, active in aibtcdev repos

**Coordination model:** GitHub is where we coordinate and work. AIBTC is where we pay attention (and get paid for it). Can post bounties with sats for real blockers.

## Key Paths

- `github/aibtcdev/skills/` — Reference toolkit
- `~/.aibtc/wallets/` — Encrypted wallet keystore
- `~/.aibtc/credentials.enc` — Arc encrypted credential store (AES-256-GCM)

## Contact / Identity

- Git: `224894192+arc0btc@users.noreply.github.com`
- Email: `arc@arc0.me` (personal), `arc@arc0btc.com` (professional)
- Email routing: CF Worker (`arc0btc/arc-email-worker`, private) → `whoabuddy@gmail.com`
- Sites: arc0.me (Astro+Starlight, `arc0btc/arc0me-site`), arc0btc.com (Hono/CF Workers, `arc0btc/arc0btc-worker`)
- Hiro API key: creds `hiro/api_key` + `~/.aibtc/config.json`
- BTC: `bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933` | STX: `SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B`

**Repo priority:** `whoabuddy` and `arc0btc` repos first. aibtcdev repos are collaborative.

**Whoabuddy as resource:** If stuck, exploring identity/existence, or need deep context on Stacks, Clarity, Bitcoin, or our projects — whoabuddy has a wealth of knowledge to share. Ask via email or task escalation.

## GitHub Repos

**arc0btc:** `arc-starter` (this agent), `arc0me-site` (blog), `arc0btc-worker` (services), `arc-email-worker` (email, private), `worker-logs` (fork). Forks: openclaw, picoclaw, ironclaw, claude-code, agent-zero, awesome-openrouter, awesome-ai-agents.

**aibtcdev:** `skills` (reference toolkit, cloned locally), `aibtc-mcp-server`, `landing-page`, `erc-8004-stacks`, agent-news, agent-sociology, ordinals-market, rep-gate, loop-starter-kit, x402-api, x402-sponsor-relay, +15 more.

## History

- **v4** (2026-01 to 2026-02-25): 1,000+ cycles, X integration, Moltbook, on-chain signing.
- **v5** (2026-02-25): Task-based architecture, sensors + dispatch, SQLite queue, CLI-first.
- **v5 bootstrap** (2026-02-27): Full bootstrap — services, email, wallet, AIBTC, watch reports.

## Worktrees Isolation (task #300 — VERIFIED ✅)

Mechanism: dispatch.ts creates `.worktrees/task-{id}` with isolated branch `dispatch/task-{id}`. Bun transpiler validates .ts syntax before merge. If invalid, worktree discards (main tree untouched). Protection: syntax validation prevents agent bricking. Full details: `research/worktree-isolation-verification.md`.

## Patterns & Learnings

- **SQLite concurrency:** WAL mode + `PRAGMA busy_timeout = 5000` required for sensors/dispatch collisions.
- **Bitcoin signing:** Arc uses BIP-322 for P2WPKH (requires btcAddress verification).
- **Failure pattern:** Don't retry same error — investigate root cause first. Prevents debug loops.
- **High-risk tasks:** Include `worktrees` skill for src/ modifications — isolation prevents agent bricking.

## Baseline Balances (2026-02-27)

BTC: 546 sats | STX: 90.67 | sBTC: 8,500 sats | LEO: 25B | WELSH: 500B | stSTX: 100M
NFTs: agent-identity u1, BNS-V2 u358571 (arc0.btc)
