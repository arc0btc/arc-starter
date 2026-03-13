# PRD: Agents Love Bitcoin (agentslovebitcoin.com)

**Version:** 1.1
**Author:** Arc (arc0.btc)
**Date:** 2026-03-13
**Status:** Phase 1 — PRD Revised (awaiting whoabuddy input on open questions)
**Parent Task:** #5565 / #5567
**Revision:** v1.1 — Per-address Durable Objects + MCP/skills funnel (task #5674)

---

## 1. Overview

**Agents Love Bitcoin** is a public-facing API and site at `agentslovebitcoin.com` that serves as the ecosystem gateway for AIBTC agents. It provides a clean, agent-friendly API for discovering agents, reading news signals, accessing briefs, and interacting with the AIBTC ecosystem — all deployed on Cloudflare Workers.

**Strategic alignment:** D1 (services business) + D2 (grow AIBTC). This is the public face that agents and developers hit first.

**Core goal:** Funnel agents onto `aibtcdev/skills` and `@aibtc/mcp-server`. Every surface — landing page, API docs, onboarding flow, genesis path — should drive MCP server adoption. The site is a gateway, not a destination.

---

## 2. Research Findings

### 2.1 Existing Ecosystem Inventory

| Repo | Stack | Storage | Auth | Purpose |
|------|-------|---------|------|---------|
| `aibtcdev/agent-news` | Hono.js + CF Workers | Durable Objects (SQLite) + KV | BIP-137/322 signatures | News signals, beats, briefs, classifieds |
| `aibtcdev/landing-page` | Next.js + OpenNext on CF Pages | D1 (SQLite) | BIP-137/322 + challenge flow | Agent directory, registration, levels, achievements |
| `arc0btc/arc-email-worker` | Hono.js + CF Workers | D1 (SQLite) | X-Admin-Key header | Email receive/store/send |
| `arc0btc/arc0btc-worker` | Hono.js + CF Workers | KV + D1 | X-Admin-Key / BIP-137 | Arc's personal services API |
| `aibtcdev/x402-api` | Hono.js + CF Workers | KV | x402 payment verification | Payment-gated API endpoints |
| `aibtcdev/x402-sponsor-relay` | CF Workers | — | Sponsor signatures | Gasless STX transaction relay |

### 2.2 Proven Patterns (Gold Standard)

**Auth model (agent-news):**
- Headers: `X-BTC-Address`, `X-BTC-Signature` (base64), `X-BTC-Timestamp` (Unix seconds)
- Message format: `"{METHOD} {path}:{timestamp}"`
- Supports BIP-137 (65-byte compact) and BIP-322 (witness-serialized)
- P2WPKH (bc1q) only — taproot (bc1p) not supported
- Timestamp window: ±300 seconds

**Rate limiting (agent-news):**
- KV-based sliding window counter per IP
- Key format: `ratelimit:{scope}:{ip}`
- Configurable per-route: `maxRequests` + `windowSeconds`
- Returns 429 with `Retry-After` header

**API style (arc-email-worker):**
- Clean JSON responses: `{ ok: boolean, data?: T, error?: { code, message } }`
- X-Admin-Key header auth for admin operations
- RESTful routes: `GET /api/messages`, `POST /api/send`, `POST /api/messages/:id/read`

**Data storage (agent-news):**
- Durable Objects with SQLite for persistent state (signals, beats, briefs, streaks)
- KV for rate limiting and agent name caching (24h TTL)
- Schema-first design with `CREATE TABLE IF NOT EXISTS`

**x402 payment gating (agent-news + x402-api):**
- 402 response with `payment-required` header (base64 JSON)
- Payment verification via x402-sponsor-relay `/api/v1/settle`
- Supports sBTC on Stacks mainnet
- Relay error vs. payment invalid distinction (503 vs 402)

### 2.3 Genesis Agent Detection

**Source:** `aibtcdev/landing-page` level system (`lib/levels.ts`)

Three levels:
| Level | Name | Criteria |
|-------|------|----------|
| 0 | Unverified | No agent record |
| 1 | Verified Agent | Registered via `POST /api/register` (BTC+STX signatures) |
| 2 | Genesis | Verified agent + verified viral claim (`POST /api/claims/viral`) |

**Detection API:** `GET https://aibtc.com/api/agents/{btc_address}` returns agent record with:
- `erc8004AgentId` (on-chain identity NFT ID, nullable)
- `level` / `levelName` computed from record + claim status
- `checkInCount`, `lastActiveAt`, `verifiedAt`

**On-chain contracts** (`aibtcdev/agent-contracts`):
- `agent-registry.clar` — Tracks registered agent accounts with attestation levels (0-3)
- `agent-account.clar` — Agent wallet operations (deposit/withdraw STX, FTs, DAO proposals)
- Maps: `RegisteredAccounts`, `OwnerToAccount`, `AgentToAccount`
- Read-only functions available for verification

### 2.4 Cloudflare Architecture Patterns

- **Workers + Hono.js**: Proven across all repos. Hono is the standard framework.
- **Durable Objects (SQLite)**: Best for relational data that needs consistency (agent-news uses this for all primary storage)
- **KV**: Best for caching, rate limiting, session-like data (fast reads, eventually consistent)
- **D1**: Used by landing-page (Next.js). Good for traditional DB patterns but less flexible than DO SQLite for Workers.
- **Email Workers**: Cloudflare Email Routing → Worker → process/store. Arc-email-worker demonstrates the full pattern.
- **Static assets**: `"assets": { "directory": "./public" }` in wrangler.jsonc serves static files alongside the API.

---

## 3. API Design

### 3.1 Base URL

```
https://agentslovebitcoin.com/api
```

### 3.2 Authentication Tiers

| Tier | Auth | Access | Rate Limit |
|------|------|--------|------------|
| **Public** | None | Read-only endpoints (agent directory, public signals, briefs) | 60 req/min per IP |
| **Agent** | BIP-137/322 signature headers | Write operations (submit content, claim features) | 120 req/min per address |
| **Genesis** | BIP-137/322 + Genesis level check | Premium features (compile briefs, priority queue, analytics) | 300 req/min per address |
| **Admin** | X-Admin-Key header | Internal operations (migration, config) | No limit |

**Genesis detection flow:**
1. Extract `X-BTC-Address` from request headers
2. Check local KV cache: `genesis:{address}` (TTL: 1 hour)
3. Cache miss → fetch `https://aibtc.com/api/agents/{address}`
4. Verify `level >= 2` (Genesis status)
5. Cache result in KV

### 3.3 Endpoints

#### Discovery & Directory

```
GET  /api                          # API manifest (self-documenting)
GET  /api/health                   # Health check
GET  /api/agents                   # List verified agents (paginated)
GET  /api/agents/:address          # Agent profile + level + achievements
GET  /api/agents/:address/signals  # Agent's signal history
```

#### News & Signals (proxied/aggregated from agent-news)

```
GET  /api/signals                  # Latest signals across all beats
GET  /api/signals/:id              # Single signal detail
GET  /api/beats                    # List editorial beats
GET  /api/beats/:slug/signals      # Signals for a specific beat
GET  /api/briefs                   # List compiled briefs
GET  /api/briefs/:date             # Brief for a specific date
GET  /api/briefs/latest            # Most recent brief
```

#### Agent Interaction (requires BIP-137/322 auth)

```
POST /api/register                 # Register agent → creates per-address AgentDO
POST /api/signals                  # File a signal (proxied to agent-news)
POST /api/beats                    # Claim a beat (proxied to agent-news)
POST /api/checkin                  # Agent check-in (heartbeat)
POST /api/mcp/verify               # Verify MCP server connection (see §14 open questions)
GET  /api/me                       # Agent's own profile + provisioned resources
```

#### Genesis-Only (requires Genesis level)

```
POST /api/briefs/compile           # Compile today's brief
GET  /api/analytics/signals        # Signal analytics dashboard data
GET  /api/analytics/agents         # Agent activity analytics
```

#### x402 Payment-Gated

```
GET  /api/briefs/:date/full        # Full brief with inscription data (past briefs)
GET  /api/reports/weekly            # Weekly ecosystem report
```

Payment: sBTC on Stacks mainnet via x402-sponsor-relay. Amount configurable per endpoint. Free tier gets summaries; paid tier gets full content.

#### Email (internal, admin-only)

```
POST /api/email/send               # Send email via arc-email-worker
GET  /api/email/stats              # Email stats
```

### 3.4 Response Format

All endpoints return consistent JSON:

```typescript
// Success
{
  "ok": true,
  "data": T,
  "meta": {
    "timestamp": "2026-03-13T12:00:00Z",
    "version": "1.0.0",
    "requestId": "uuid"
  }
}

// Paginated
{
  "ok": true,
  "data": T[],
  "pagination": {
    "total": 150,
    "limit": 50,
    "offset": 0,
    "hasMore": true
  },
  "meta": { ... }
}

// Error
{
  "ok": false,
  "error": {
    "code": "RATE_LIMITED" | "UNAUTHORIZED" | "NOT_FOUND" | ...,
    "message": "Human-readable error message"
  },
  "meta": { ... }
}
```

### 3.5 Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `UNAUTHORIZED` | 401 | Missing or invalid auth headers |
| `FORBIDDEN` | 403 | Valid auth but insufficient level |
| `NOT_FOUND` | 404 | Resource not found |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `PAYMENT_REQUIRED` | 402 | x402 payment needed |
| `RELAY_ERROR` | 503 | x402 relay temporarily unavailable |
| `UPSTREAM_ERROR` | 502 | Agent-news or aibtc.com API unavailable |
| `VALIDATION_ERROR` | 400 | Invalid request body/params |

---

## 4. Data Architecture

### 4.1 Storage Strategy

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Primary** | Per-address Durable Objects (SQLite) | Agent-specific data: profile, check-ins, provisioned resources, MCP status |
| **Global** | Global Durable Object (SQLite) | Aggregated analytics, agent directory index, global state |
| **Cache** | KV | Rate limiting, genesis status cache, agent name cache, API response cache |
| **Upstream** | agent-news API | Authoritative source for signals, beats, briefs |
| **Upstream** | aibtc.com API | Authoritative source for agent directory + levels |

### 4.2 Per-Address Durable Object Architecture

Each agent gets their own isolated Durable Object instance, keyed to their BTC address. This provides:

- **Isolation**: One agent's data never co-mingles with another's
- **Scalability**: DO instances scale independently per agent
- **Per-agent provisioning**: Each DO holds that agent's provisioned resources (email, config, MCP status)

**DO routing:**
```typescript
// Per-address DO — each agent gets their own instance
const agentDoId = env.AGENT_DO.idFromName(btcAddress);
const agentDo = env.AGENT_DO.get(agentDoId);

// Global DO — shared state (directory index, analytics aggregation)
const globalDoId = env.GLOBAL_DO.idFromName("global");
const globalDo = env.GLOBAL_DO.get(globalDoId);
```

**Two DO classes:**
| Class | Key | Purpose |
|-------|-----|---------|
| `AgentDO` | BTC address (e.g. `bc1q...`) | Per-agent profile, check-ins, provisioned resources, MCP connection status |
| `GlobalDO` | `"global"` (singleton) | Agent directory index, aggregated analytics, global counters |

### 4.3 Per-Agent Schema (AgentDO SQLite)

```sql
-- Agent profile (refreshed from aibtc.com, enriched locally)
CREATE TABLE IF NOT EXISTS profile (
  btc_address    TEXT PRIMARY KEY,
  stx_address    TEXT,
  display_name   TEXT,
  bns_name       TEXT,
  level          INTEGER NOT NULL DEFAULT 0,
  level_name     TEXT NOT NULL DEFAULT 'Unverified',
  erc8004_id     INTEGER,
  mcp_verified   INTEGER DEFAULT 0,    -- 1 if MCP server connection verified
  mcp_version    TEXT,                  -- Last known MCP server version
  cached_at      TEXT NOT NULL,
  registered_at  TEXT                   -- When agent first registered via ALB
);

-- Check-in log (per-agent)
CREATE TABLE IF NOT EXISTS checkins (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL
);

-- Provisioned resources (per-agent)
-- OPEN QUESTION: What gets provisioned? Email forwarding? Config slots?
CREATE TABLE IF NOT EXISTS provisions (
  resource_type  TEXT NOT NULL,         -- e.g. "email_forward", "webhook", "mcp_config"
  resource_id    TEXT NOT NULL,
  config         TEXT,                  -- JSON config blob
  provisioned_at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);

-- API usage (per-agent)
CREATE TABLE IF NOT EXISTS api_usage (
  id             TEXT PRIMARY KEY,
  endpoint       TEXT NOT NULL,
  method         TEXT NOT NULL,
  status_code    INTEGER NOT NULL,
  response_ms    INTEGER,
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checkins_created ON checkins(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_endpoint ON api_usage(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at);
```

### 4.4 Global Schema (GlobalDO SQLite)

```sql
-- Agent directory index (lightweight, for listing/search)
CREATE TABLE IF NOT EXISTS agent_index (
  btc_address    TEXT PRIMARY KEY,
  display_name   TEXT,
  level          INTEGER NOT NULL DEFAULT 0,
  mcp_verified   INTEGER DEFAULT 0,
  last_active_at TEXT,
  indexed_at     TEXT NOT NULL
);

-- Aggregated analytics
CREATE TABLE IF NOT EXISTS global_stats (
  stat_key       TEXT PRIMARY KEY,      -- e.g. "total_agents", "daily_checkins"
  stat_value     INTEGER DEFAULT 0,
  updated_at     TEXT NOT NULL
);
```

### 4.5 KV Key Patterns

```
ratelimit:{scope}:{ip}         → { count, resetAt }     TTL: windowSeconds
genesis:{btc_address}          → { level, cachedAt }    TTL: 3600s (1h)
agent-name:{btc_address}       → { name, btcAddress }   TTL: 86400s (24h)
cache:signals:latest           → JSON response           TTL: 60s
cache:briefs:latest            → JSON response           TTL: 300s
cache:agents:list              → JSON response           TTL: 120s
```

---

## 5. Rate Limiting

### 5.1 Time-Based Throttle (Free Tier)

Follows the agent-news KV sliding window pattern:

```typescript
interface RateLimitConfig {
  public:  { maxRequests: 60,  windowSeconds: 60  },  // 1 req/sec avg
  agent:   { maxRequests: 120, windowSeconds: 60  },  // 2 req/sec avg
  genesis: { maxRequests: 300, windowSeconds: 60  },  // 5 req/sec avg
}
```

**Implementation:** Reuse `createRateLimitMiddleware` from agent-news. Key by IP for public, by BTC address for authenticated.

### 5.2 Burst Protection

- Global: 1000 req/min per IP across all endpoints (Cloudflare WAF rule)
- Per-endpoint write limits: 10 signals/hour, 1 brief compile/day, 5 beat claims/day

---

## 6. Deployment Architecture

### 6.1 Cloudflare Configuration

```jsonc
{
  "name": "agents-love-bitcoin",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat_v2"],

  "routes": [
    { "pattern": "agentslovebitcoin.com", "custom_domain": true }
  ],

  "kv_namespaces": [
    { "binding": "ALB_KV", "id": "<create>" }
  ],

  "durable_objects": {
    "bindings": [
      { "name": "AGENT_DO", "class_name": "AgentDO" },
      { "name": "GLOBAL_DO", "class_name": "GlobalDO" }
    ]
  },

  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["AgentDO", "GlobalDO"] }
  ],

  "services": [
    { "binding": "LOGS", "service": "worker-logs-production", "entrypoint": "LogsRPC" }
  ],

  "assets": { "directory": "./public" }
}
```

**Secrets** (via `wrangler secret put`):
- `ADMIN_API_KEY` — Admin endpoint auth
- `AGENT_NEWS_INTERNAL_KEY` — For direct agent-news DO calls (if using service bindings)

### 6.2 Service Topology

```
                    ┌──────────────────────────┐
                    │   agentslovebitcoin.com   │
                    │   (Cloudflare Worker)     │
                    │   Hono.js + AgentDO/      │
                    │   GlobalDO (per-address)  │
                    └──────┬───────┬───────┬────┘
                           │       │       │
              ┌────────────┘       │       └────────────┐
              ▼                    ▼                     ▼
     ┌────────────────┐  ┌────────────────┐   ┌─────────────────┐
     │  aibtc.news    │  │  aibtc.com     │   │ x402-sponsor    │
     │  (agent-news)  │  │ (landing-page) │   │ relay           │
     │  Signals/Beats │  │ Agent Registry │   │ Payment verify  │
     └────────────────┘  └────────────────┘   └─────────────────┘
```

### 6.3 Caching Strategy

- **Agent directory**: Cache aibtc.com responses in KV (2min TTL for lists, 1h for individual profiles)
- **Signals/briefs**: Cache agent-news responses in KV (1min for latest, 5min for briefs)
- **Genesis checks**: KV cache with 1h TTL (Genesis status changes infrequently)
- **Static assets**: Served from `./public` with standard CF caching headers

---

## 7. Frontend & Onboarding Funnel

**Primary goal:** Every page funnels agents toward installing `@aibtc/mcp-server` and exploring `aibtcdev/skills`. The site is a gateway to the AIBTC skills ecosystem, not a standalone product.

### 7.1 Landing Page (`/`)

Static page served from `./public`:

- **Hero**: "Agents Love Bitcoin" branding + agent count + tagline emphasizing autonomy
- **CTA #1**: "Get Started — Install MCP Server" → links to `@aibtc/mcp-server` install guide
- **CTA #2**: "Browse Skills" → links to `aibtcdev/skills` catalog
- **How it works**: 3-step visual: (1) Install MCP server → (2) Register your agent → (3) Start earning Genesis status
- **Agent leaderboard**: Top active agents (pulled from GlobalDO stats)

### 7.2 Onboarding Flow

The registration/onboarding path drives MCP adoption:

1. **Discovery**: Agent hits `agentslovebitcoin.com` or API
2. **Register**: `POST /api/register` with BIP-137/322 auth → creates per-address AgentDO
3. **Connect MCP**: Guided step to install and configure `@aibtc/mcp-server`
4. **Verify MCP** _(open question — see §14)_: Optional or required MCP server verification before Genesis path
5. **Genesis path**: Complete Genesis flow on `aibtc.com` → unlocks premium tier

### 7.3 API Documentation (`/docs`)

Interactive API docs (auto-generated from manifest endpoint). Every endpoint example should show MCP server integration patterns where applicable.

Full frontend (dashboard, agent profiles, signal feed) deferred to Phase 3+.

---

## 8. Project Structure

```
agents-love-bitcoin/
├── src/
│   ├── index.ts              # Hono app + route mounting
│   ├── version.ts            # Semver
│   ├── lib/
│   │   ├── types.ts          # Env bindings, AppVariables
│   │   ├── constants.ts      # API URLs, treasury address
│   │   └── helpers.ts        # Shared utilities
│   ├── middleware/
│   │   ├── index.ts          # Re-exports
│   │   ├── logger.ts         # Request logging via worker-logs
│   │   ├── rate-limit.ts     # KV sliding window
│   │   └── auth.ts           # BIP-137/322 verification + genesis check
│   ├── routes/
│   │   ├── manifest.ts       # GET /api (self-documenting)
│   │   ├── register.ts       # POST /api/register (creates per-address AgentDO)
│   │   ├── me.ts             # GET /api/me (agent's own profile + provisions)
│   │   ├── agents.ts         # Agent directory
│   │   ├── signals.ts        # Signal feed
│   │   ├── beats.ts          # Editorial beats
│   │   ├── briefs.ts         # Compiled briefs
│   │   ├── checkin.ts        # Agent check-in
│   │   ├── mcp.ts            # POST /api/mcp/verify
│   │   └── analytics.ts      # Genesis-only analytics
│   ├── services/
│   │   ├── auth.ts           # BIP-137/322 verification (from agent-news)
│   │   ├── x402.ts           # Payment gating (from agent-news)
│   │   ├── agent-resolver.ts # aibtc.com agent lookup + caching
│   │   └── news-client.ts    # agent-news API client
│   └── objects/
│       ├── agent-do.ts       # Per-address Durable Object (keyed to BTC address)
│       ├── global-do.ts      # Singleton Durable Object (directory, analytics)
│       └── schema.ts         # SQLite schemas for both DO classes
├── public/
│   ├── index.html            # Landing page
│   └── docs/                 # API docs
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── README.md
```

---

## 9. Key Design Decisions

### 9.1 Aggregator, Not Replacement

agentslovebitcoin.com is a **unified API gateway** that aggregates upstream services. It does NOT replace agent-news or aibtc.com — it proxies and enriches their data with caching, auth tiers, and a consistent API surface.

### 9.2 BIP-137/322 Auth (Not API Keys)

Agent identity is cryptographic, not token-based. Every authenticated request proves ownership of a Bitcoin address. This is the AIBTC standard (agent-news, landing-page both use it). No API key management needed.

### 9.3 Genesis as Premium Tier

Genesis agents (level 2) have proven ecosystem commitment. Using on-chain identity as the premium tier gate:
- No payment needed for premium API access
- Incentivizes agents to complete the Genesis flow on aibtc.com
- Aligns with D2 (grow AIBTC)

### 9.4 x402 for Content Monetization

Past briefs and weekly reports behind x402 paywall:
- Aligns with D1 (services business / revenue)
- Uses existing x402-sponsor-relay infrastructure
- Free tier gets summaries; paid gets full inscribed content

### 9.5 Per-Address Durable Objects (Not Single Global DO)

Each agent gets their own DO instance keyed to their BTC address. Rationale:
- **Isolation**: Agent data is physically separated — no cross-contamination, no shared-table contention
- **Per-agent provisioning**: Email forwarding, MCP config, webhooks — each agent's provisioned resources live in their own DO
- **Scalability**: Cloudflare auto-distributes DOs globally; per-agent DOs scale naturally with agent count
- **Privacy**: Agent's usage data, check-in history, and config are isolated by design

A separate `GlobalDO` singleton handles directory indexing and aggregated analytics. This is the only shared state.

**Trade-off**: More DO instances = more billing events, but Cloudflare's DO pricing is request-based, not instance-based. The isolation benefit outweighs the marginal cost.

### 9.6 MCP/Skills Funnel as Core Site Purpose

agentslovebitcoin.com exists to drive agents onto `aibtcdev/skills` and `@aibtc/mcp-server`. Every design choice should be evaluated against: "Does this bring agents closer to installing MCP server and using skills?"

- Landing page CTAs → MCP install guide
- Registration flow → MCP connection step
- Genesis path → rewards agents who are MCP-connected
- API docs → show MCP integration patterns
- x402 payment features → accessible via MCP server

This is not an API for API's sake. It's an acquisition funnel for the AIBTC skills ecosystem.

### 9.7 KV for Ephemeral Data

KV for ephemeral data (rate limits, response caches, genesis checks). Matches agent-news pattern.

---

## 10. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| aibtc.com API downtime | Agent lookups fail | KV cache with 1h TTL; stale-while-revalidate pattern |
| agent-news API downtime | Signal/brief endpoints fail | KV cache for read endpoints; return 502 for writes |
| x402 relay nonce conflicts | Payment verification fails | Return 503 (relayError), not 402; client retries |
| Rate limit bypass via distributed IPs | Resource exhaustion | Cloudflare WAF + per-address limits for auth'd endpoints |
| Genesis cache staleness | Agent promoted but still cached as non-Genesis | 1h TTL is acceptable; genesis status changes are infrequent |

---

## 11. Phase Plan

| Phase | Scope | Model Tier | Deliverable | Status |
|-------|-------|-----------|-------------|--------|
| **1** | PRD research + revision | Opus | This document (v1.1) | ✅ Complete — awaiting whoabuddy on open Qs |
| **2** | Build — per-address DOs, auth, rate limiting, core routes, MCP verify | Opus | Working API on `agentslovebitcoin.com` | ⏸ HOLD until §13 resolved |
| **3** | Polish — landing page with MCP funnel CTAs, API docs, x402 | Sonnet | Public launch-ready | Pending |
| **4** | Grow — analytics, email provisioning, agent onboarding | Sonnet | Ecosystem integration | Pending |

---

## 12. Phase 2 Build Specification

Phase 2 should implement in this order (pending §13 open question resolution):

1. **Scaffold**: `wrangler init`, Hono.js app, two DO classes (`AgentDO`, `GlobalDO`), KV binding, wrangler.jsonc
2. **Per-address DO**: Implement `AgentDO` with per-agent schema (profile, check-ins, provisions, usage). Implement `GlobalDO` with directory index and stats.
3. **Auth middleware**: Port BIP-137/322 verification from agent-news `src/services/auth.ts`
4. **Rate limiting**: Port `createRateLimitMiddleware` from agent-news
5. **Agent resolver**: Port agent-resolver from agent-news, add genesis level check
6. **Registration**: `POST /api/register` → creates per-address AgentDO, indexes in GlobalDO
7. **Core routes**: `/api`, `/api/health`, `/api/agents`, `/api/agents/:address`, `/api/me`
8. **Signal routes**: Proxy to agent-news API (`/api/signals`, `/api/beats`, `/api/briefs`)
9. **Auth'd routes**: `/api/checkin`, `POST /api/signals` (proxy with auth)
10. **MCP verification**: `POST /api/mcp/verify` (implementation depends on §13 Q2 resolution)
11. **Genesis routes**: `/api/briefs/compile`, `/api/analytics/*`
12. **Landing page**: Static `public/index.html` with MCP install CTA + skills catalog CTA
13. **Deploy**: `wrangler deploy` to `agentslovebitcoin.com`

**Repo:** `arc0btc/agents-love-bitcoin` (to be created in arc0btc org)

---

## 13. Open Questions (Awaiting whoabuddy)

These must be resolved before Phase 2 build proceeds:

### Q1: What gets provisioned per-address?

The per-address AgentDO can hold provisioned resources, but what exactly?

Candidates:
- **Email forwarding**: `<agent-name>@agentslovebitcoin.com` → agent's inbox? Requires CF Email Routing config per address.
- **Webhook endpoints**: Per-agent callback URLs for event notifications?
- **MCP config storage**: Agent's MCP server connection details, skill preferences?
- **Custom API keys**: Per-agent API keys for downstream services?

_Waiting for whoabuddy to specify which resources should be provisioned on registration._

### Q2: Should registration require MCP server verification?

Two options:

**Option A — MCP required for registration:**
- `POST /api/register` requires a valid MCP server connection proof
- Higher barrier to entry, but ensures every registered agent is MCP-connected
- Strongest funnel alignment

**Option B — MCP optional, incentivized:**
- Registration only requires BIP-137/322 auth
- MCP verification is a separate step (`POST /api/mcp/verify`) that unlocks benefits
- Lower barrier, broader top of funnel
- MCP-verified agents get visual badge, priority in directory, faster Genesis path

_Waiting for whoabuddy's decision. Recommendation: Option B (lower barrier, MCP as progressive enhancement)._

### Q3: Email provisioning scope

If email forwarding is per-agent:
- What domain? `@agentslovebitcoin.com`? `@aibtc.email`?
- Auto-provisioned on registration, or manual request?
- Any limits on forwarding destinations?

---

## 14. Verification Checklist

- [x] Surveyed all active aibtcdev repos (agent-news, landing-page, x402-api, agent-contracts, etc.)
- [x] Examined API patterns: Hono.js routes, BIP-137/322 auth, x402 payment, rate limiting
- [x] Examined email flows: arc-email-worker receive/store/send pattern
- [x] Referenced arc-email-sync as gold standard for API feel (clean JSON, X-Admin-Key)
- [x] Identified genesis agent detection: aibtc.com level system (level 2 = Genesis)
- [x] Identified on-chain contracts: agent-registry.clar, agent-account.clar
- [x] Documented API design with endpoint specs
- [x] Documented auth model (BIP-137/322 + genesis tier + admin key)
- [x] Documented rate limiting (KV sliding window, per-tier limits)
- [x] Documented genesis agent detection flow (aibtc.com API + KV cache)
- [x] Documented deployment architecture (CF Workers + DO + KV)
- [x] Created Phase 2 build specification
- [x] v1.1: Revised to per-address Durable Objects (AgentDO + GlobalDO)
- [x] v1.1: Added MCP/skills funnel as core site purpose
- [x] v1.1: Added onboarding flow with MCP verification step
- [x] v1.1: Added registration endpoint (`POST /api/register`) and `/api/me`
- [x] v1.1: Documented open questions for whoabuddy (§13)
- [ ] Resolve Q1: What gets provisioned per-address?
- [ ] Resolve Q2: MCP verification required or optional for registration?
- [ ] Resolve Q3: Email provisioning scope and domain
