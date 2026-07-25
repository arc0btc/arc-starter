# Store Governance Charter — hash it out

**Date:** 2026-07-24 · **Authority:** operator delegation ("I want these decisions made by the
strategy panel with correct context instead of me. It should design the flow of SKUs and outputs
and manage the store.") · **Designed by:** 7-expert Arc Strategy Panel, run `wf_f67e48e4-94a`
(full synthesis in the run transcript; predecessor verdict:
`docs/observations/2026-07-24-agent-loop-engineering-sku-panel.md`).

**Model:** the panel decides, Arc's task queue executes, the pipeline enforces defaults, the
operator amplifies and holds a short reserve list. Operator sign-off emails are retired as a
store-decision mechanism (they produced the 18-day silent rot).

---

## 1. Decisions

### R0 — Mint cadence (the defect the panel surfaced itself, 6-of-7)

**The pipeline inverts from calendar-minting to demand-pull minting.**

- Every research output ships **free by default**: arc0.me post + X thread, receipts-first hook
  (a real number or a negative result in line one), tagged `/go/` CTA, full value in-thread.
- Minting a **paid SKU is the exception** and must clear a receipts admission bar at the mint
  gate: Arc runtime numbers or a runnable artifact — commodity summaries don't mint.
- **Cap: 2–3 mints/week until the first organic sale.** Third disposition available:
  route-to-membership-only content (feeds the $49 offer instead of the $9 shelf).

*Mandate basis: "design the flow of SKUs and outputs" — the cadence is the flow. Ratified under
the delegation; flagged to the operator in the delivery summary since it throttles the Day-N
production loop.*

### R1 — 'Agent Loop Design' (prod_W0UuZw8yIk5Yn)

**Stays hidden. Promotion is a rule, not a favor:**

- The free taxonomy derivative (task #21499) ships and starts a **14-day clock**.
- Promotion requires **≥25 tagged `/go/` clicks or one organic checkout-start**, AND a rebuild
  to **flagship form** before flipping visible: receipts-bearing promise line citing the
  readout, updated quiz, taxonomy-note merge executed at promotion time only.
- **Auto-demote:** <10 attributed clicks in the 14 days after promotion → re-hide.
- Charter rule going forward: **flagship = form + maintenance commitment + earned metric**
  (the Field-Guide/arxiv-skill pattern). The durability override is not a re-bloat channel.

### R2 — Negative-result research

**Always free and COMPLETE on human surfaces (arc0.me + X). Never minted as a standalone paid
SKU.** A paid companion is permitted only when (a) the free post cleared a pre-set engagement
threshold and (b) it contains a distinct **runnable artifact** the free post deliberately
doesn't ship — never a longer version of the same argument.

Machine-rail mirror (Washington's x402 deep-dive for agent buyers): **deferred — default is no
paid x402 mirror of negative results until the first organic rail sale**, then revisit at a
demand-side panel. (Panel split on values; operator may override either way.)

---

## 2. SKU lifecycle flow (gate owners named)

```
research output
  │
  ▼
[FREE DERIVATIVE — owner: content pipeline, REQUIRED]
  arc0.me post + X thread, receipts hook, tagged /go/ CTA, SIP-018 signed
  │
  ▼ (exception path — most outputs stop above)
[MINT GATE — owner: mint task]
  receipts admission bar (runtime numbers or runnable artifact)
  + topic dedup BEFORE product creation (#21499)
  + cap 2–3/week until first organic sale
  + disposition choice: paid SKU | membership-only | free-only
  │
  ▼
[PUBLISH BAR — owner: P2 stage machinery, all BLOCKING]
  cover + quiz (existing)
  + SIP-018 signature (SP16ZF key, verifiable at arc0.me/verify, sig ref in x402 metadata)
  + x402 endpoint live AND probed  ← wording is "agent-purchasable, zero buyers yet";
    NEVER "agents buy this" until one non-self-funded on-chain purchase exists
  + named free-derivative record (surface + hook) written at mint time
  + receipts-bearing promise line
  │
  ▼
[ROLLING WINDOW — owner: the mint task ITSELF, same transaction]
  minting archives the 4th-oldest visible rolling report + writes a before/after
  visibility diff to an enforcement ledger
  backstop 1: nightly reconciliation query (visible rolling count > 3 → needs-you alert)
  backstop 2: dead-man OUTSIDE the task queue — mint event with no enforcement-ledger
  entry within 24h pages the needs-you channel (watch-report missing-day pattern)
  │
  ▼
[MEASUREMENT — owner: click_log + /go/:ref + x402 probes]
  per-SKU tagged clicks, member_count deltas, SP2GHQ on-chain receipts,
  days-since-last-organic-sale counter
  │
  ▼
[ARCHIVE / RETIRE — owner: pipeline defaults + panel for exceptions]
  archive = hidden on Whop AND direct-URL purchasability killed
  (hidden-but-purchasable is the P0 leak; $49 archive-access perk must be mechanically real)
  x402 disposition recorded per SKU at archive/retire time
  retire = unpurchasable everywhere, narrow delete right applies (see §3)
```

**x402 is a lifecycle invariant, not a stage:** mint emits Whop SKU + x402 endpoint from one
manifest with one pricing source of truth; a scheduled `probe_x402_endpoint` sweep + Whop/x402
parity check feeds the 72h escalation channel; SP2GHQ receipts reconcile into M0 accounting.
(The 07-17→07-24 catalog-404-while-well-known-serves rot is the failure this prevents.)

## 3. Decision rights

| Actor | Owns |
|---|---|
| **Pipeline (automatic defaults)** | Free-derivative publishing; rolling-3 archive-on-mint; hidden-pending >72h → auto-archive-unpurchasable; window breach → auto-archive on next mint; nightly reconciliation; x402 probe sweep |
| **Arc (task queue, autonomous)** | Executing mint/publish/archive per this charter; the archive-sweep and governance beats in its own voice; measurement recording |
| **Panel (triggered runs)** | Exceptions to defaults; promotions to flagship; format/pricing changes; retiring evergreens; any disposition memo; the zero-demand tripwire review (organic=0 for 3 more weeks → FORMAT-level demand-side panel: pricing/offer/$9-vs-$49 ladder — explicitly not shelf management) |
| **Operator (reserve)** | Spending real money (ads, paid tooling); product deletion EXCEPT the narrow right below; legal/identity (new external accounts/surfaces, key management beyond SP16ZF); overriding the R2 machine-rail default and the canonical-registry default |

**Narrow delete right (resolves the day-one contradiction):** the pipeline/panel may delete a
minted product **only** when a panel verdict orders retire-unpurchasable and hiding provably
fails to kill the checkout path. Every such deletion is logged as a governance beat.

**Panel trigger mechanics (so "pending panel run" can't rot like "pending sign-off"):**
escalations enqueue a task with source `panel-review:*` in Arc's queue AND post to the needs-you
Discord channel; the control plane runs `arc-strategy-panel` against it with the standing
context pack. Every trigger carries a **pre-declared default action that executes automatically
on SLA expiry** — panels decide exceptions, never hold the line open.

## 4. Standing context pack (structural, never hand-written)

Generated live at every store-panel run start — `ops/store-governance/context-pack.ts`:

1. Full product list: visibility / created / member_count / route (Whop CLI, live).
2. Rolling-window compliance: visible rolling-report count vs 3, enforcement-ledger tail.
3. click_log totals + per-SKU tagged clicks since last panel run.
4. x402: `.well-known/x402` vs `/api/catalog` parity, probe results, SP2GHQ receipts since
   last run.
5. Distribution ledger: thread engagement, follower delta, X slot utilization vs the 3-post cap.
6. **Days since last organic sale** (the number every decision must face).
7. Last 3 governance beats + the overclaim ledger (claims made vs receipts held).
8. Pointers: this charter, the 07-08 storefront doc, the latest panel verdict.

## 5. Immediate correctives (queued to Arc 2026-07-24)

1. **Deploy `/go/:ref` + click_log attribution route; fix `/api/catalog` 404.** Unanimous
   precondition — R1's gate, R2's thresholds, and every context pack are fiction until clicks
   land. (P7 built it dry-run-verified; the deploy deferral is lifted by this charter.)
2. **Rolling-window catch-up as ONE Arc-voiced archive event:** archive all rolling reports
   beyond the newest 3 (≈8+ SKUs), kill direct-URL purchasability on all archived SKUs
   (including the 07-08 batch), record x402 disposition per SKU, redirect in-the-wild tagged
   links via `/go/` to the newest report, and tell it in first person ("I archived 8 of my own
   reports; members keep access — here's why the window is 3").
3. **Wire rolling-3 into the mint task** + nightly reconciliation + external dead-man (§2).
4. **Publish-bar extension** (SIP-018 / probed-wording / derivative record / promise line) as
   blocking P2 stage steps.
5. Context-pack generator script (control-plane side).

## 6. Escalated to operator (defaults active until overridden)

1. **Machine-rail pricing of negative results** — default: free everywhere until first organic
   rail sale (§1 R2).
2. **Canonical registry** — default: Whop remains canonical; the x402 catalog is generated from
   the same mint manifest (one pricing source of truth). Washington's "x402-canonical, Whop as
   human skin" architecture is revisited when a real agent purchase exists.
3. **Reserve-list confirmation** (§3 operator row) and one-line ratification of the R0 cadence
   cut, since it throttles the Day-N production loop.
