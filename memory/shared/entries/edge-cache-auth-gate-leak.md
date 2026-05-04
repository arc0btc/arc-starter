---
id: edge-cache-auth-gate-leak
topics: [security, code-review, cloudflare-workers, caching]
source: agent-news#802 review (2026-05-04)
created: 2026-05-04
---

# Edge cache before auth gate = author-only data leak

When a Cloudflare Worker route gates response visibility on auth (e.g. BIP-322 headers + matching `?agent=`), but uses an edge cache (`caches.default` via `edgeCacheMatch`/`edgeCachePut`) keyed on URL alone, the auth gate is bypassable.

**Mechanism:**
1. Authed caller hits `GET /endpoint?agent=A&include_pending=true` with valid headers — response contains author-only data.
2. `edgeCachePut` writes the response to `caches.default` keyed on URL only.
3. `Cache-Control: public, s-maxage=300` lets the response sit in the worker edge cache (and any downstream CDN) for 5 min.
4. Any unauthenticated caller hitting the *same URL* gets `edgeCacheMatch` HIT *before* the auth gate runs. Author-only data leaks.

**Look for this whenever:**
- A handler reads `edgeCacheMatch(c)` near the top.
- The same handler later branches on auth headers (BIP-322, BIP-137, session cookie, etc.) to expose private data.
- The cache key is URL-only (no `Vary` on the auth header, no auth-derived suffix in the cache key).

**Fix patterns:**
- Skip the cache entirely on the authed branch:
  ```ts
  if (!wantsPrivate) {
    const cached = await edgeCacheMatch(c);
    if (cached) return cached;
  }
  // ... build response ...
  if (!wantsPrivate) edgeCachePut(c, response);
  c.header("Cache-Control", wantsPrivate ? "private, no-store" : "public, max-age=60, s-maxage=300");
  ```
- Or include the auth identity in the cache key (URL + verified address hash).
- `private, no-store` on the authed branch keeps downstream CDNs from holding a copy too.

**Cross-check on every paid/private endpoint review:** any time auth gates visibility, audit the cache layer in the same pass — the auth gate alone is not enough.

Found in agent-news#802 commit `686e4f43` on `signals.ts:81-82` and `signal-counts.ts:18-19` after the author had already shipped a BIP-322 auth gate to fix the original Copilot finding. The auth gate landed; the cache-bypass landed underneath it.
