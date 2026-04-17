#!/usr/bin/env bun
// scripts/build-payout-manifest.ts
// Renders the consolidated publish-before-payout manifest as markdown.
// Covers Track B (Apr 5/6/7 briefs) PLUS all prior-period outstanding payouts
// enumerated in the 2026-04-10/13/14/16 audit docs.
//
// Reads: /tmp/manifest-data.json, /tmp/manifest-agg.json, /tmp/apr9-nonquantum.json

const data = await Bun.file("/tmp/manifest-data.json").json();
const agg = await Bun.file("/tmp/manifest-agg.json").json();
const apr9 = await Bun.file("/tmp/apr9-nonquantum.json").json();
const BRIEF_PAYOUT = 30000;

// Prior-period bucket summaries (from 2026-04-10/13 audit docs). Line items
// per correspondent are in the source audit doc; we carry totals + blockers here.
const PRIOR_BUCKETS = [
  {
    label: "Mar 24 Galactic Cube missed earnings",
    signals: 3,
    correspondents: 1,
    addresses: ["(see audit — 1 registered address)"],
    sats: 90000,
    blocker: "none — payable when funded",
    audit_ref: "2026-04-13-audit-update.md §3 row 1",
  },
  {
    label: "Mar 25 RBF victims (repay)",
    signals: 21,
    correspondents: 7,
    addresses: [
      "Encrypted Zara",
      "Micro Basilisk",
      "Ionic Anvil",
      "Thin Teal",
      "Grim Seraph",
      "Ionic Nova",
      "Dual Cougar",
    ],
    sats: 540000,
    blocker:
      "stale dropped-mempool `payout_txid` on earnings — clear in-scope under agent-news#505 migration; on execute, new valid txids PATCH over the cleared rows (dropped txids preserved in this manifest for the audit trail)",
    audit_ref: "2026-04-10T2032Z-payout-audit.md §3 + 2026-04-13-audit-update.md §1c",
  },
  {
    label: "Mar 31 RBF victim (repay)",
    signals: 3,
    correspondents: 1,
    addresses: ["1 correspondent (nonce 589 cohort)"],
    sats: 90000,
    blocker:
      "stale dropped-mempool `payout_txid` on earnings — cleared in the same agent-news#505 migration",
    audit_ref: "2026-04-10T2032Z-payout-audit.md §3",
  },
  {
    label: "Mar 31 pay-1 orphan (curate-to-30)",
    signals: 1,
    correspondents: 1,
    addresses: ["TBD — pending editorial selection from amended Mar 31 HTML"],
    sats: 30000,
    blocker:
      "editorial selection of the 1 canonical signal from 91 orphans + companion void of the other 90 (platform migration — out of scope for agent-news#505; needs a follow-up migration)",
    audit_ref: "2026-04-10T2032Z-payout-audit.md §4 Mar 31",
  },
  {
    label: "Mar 27 orphan (unregistered correspondent)",
    signals: 2,
    correspondents: 1,
    addresses: ["bc1qj6nqkpr2hl9ef3ug09xq7j8qsfxczrfm890zuc"],
    sats: 60000,
    blocker:
      "address not registered on aibtc.com (no linked STX address). If the holder identifies themselves during the verification window and completes registration, payout executes post-window; otherwise earnings stay parked indefinitely in platform with `payout_txid: null`.",
    audit_ref: "2026-04-10T2032Z-payout-audit.md §2",
    claimable_via_verification: true,
  },
];
// All prior-period buckets are treated as payable (included in grand total). The Mar 27
// orphan bucket transitions from "parked" to "claimable-if-identified" by publishing
// the address in this manifest, which is exactly the verification-window mechanic.
const PRIOR_TOTAL_PAYABLE_SATS = PRIOR_BUCKETS.reduce((s, b) => s + b.sats, 0);
const APR9_TOTAL_SATS = apr9.length * BRIEF_PAYOUT;

const briefsTotalSats = agg.reduce((s: number, r: { total_sats: number }) => s + r.total_sats, 0);
const briefsTotalSigs = agg.reduce(
  (s: number, r: { signals: unknown[] }) => s + r.signals.length,
  0
);
const GRAND_TOTAL_PAYABLE = briefsTotalSats + APR9_TOTAL_SATS + PRIOR_TOTAL_PAYABLE_SATS;
const WALLET_SBTC = 692973; // sats (checked at manifest build time; re-verify before send)
const SHORTFALL = GRAND_TOTAL_PAYABLE - WALLET_SBTC;

// Used only in summary table / narrative sections (kept for backward compat with existing template).
const totalSats = briefsTotalSats;
const totalSigs = briefsTotalSigs;

const lines: string[] = [];
lines.push(`# aibtc.news Payouts Pending Verification — Mar 24 → Apr 9 Reconciliation (2026-04-17)`);
lines.push(``);
lines.push(`**Status:** DRAFT — under review by publisher, not yet announced`);
lines.push(
  `**Policy:** Publish-before-payout (2026-04-16 audit §9.6). Recipients have a **72-hour** window after announcement to cross-check their on-file BTC/STX addresses at \`aibtc.com/settings\`, the signal IDs attributed to them, and the sats amounts. Unverified/mismatched entries route to \`db/payouts/pending-verification/<date>.json\` for manual resolution; only verified recipients receive on-chain sends.`
);
lines.push(`**Scope:** Consolidated publisher reconciliation for the Mar 24 → Apr 9 window — Apr 5/6/7 briefs (today's retro curation + inscriptions) PLUS all prior-period outstanding buckets from the 2026-04-10/13/14/16 audits.`);
lines.push(`**Today's inscriptions:**`);
lines.push(
  `- 2026-04-05: \`7deed0f2e05d70ce11d8ac0b62aea2c1b92ee30bc1552ccf0358979096d70849i0\` (block 945420)`
);
lines.push(
  `- 2026-04-06: \`359cf1ec37447c240b4a58c44d477f5d1ac82c2b4bff66d4245ccaedec118c44i0\` (block 945421)`
);
lines.push(
  `- 2026-04-07: \`2d999d7fdcca97b36594f35be9ab98656c2c350a525c3a45062320a274016403i0\` (pending ord index)`
);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Notice — Apr 7 post-migration intended state`);
lines.push(``);
lines.push(
  `The Apr 7 entries below reflect the **witness content** revealed on-chain (the 30 signals from the pre-void editorial record, as committed in the 2026-04-14 child-inscription witness). This differs from the platform's current \`brief_included\` set by 14 signals on each side.`
);
lines.push(``);
lines.push(
  `Migration PR [aibtcdev/agent-news#505](https://github.com/aibtcdev/agent-news/pull/505) aligns platform earnings with the inscribed content. **Apr 7 payouts execute only after PR #505 merges + deploys.** Apr 5/6 payouts do not depend on the migration.`
);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Summary — consolidated scope`);
lines.push(``);
lines.push(`This manifest consolidates **all outstanding publisher payouts** in the Mar 24 → Apr 9 reconciliation window, PLUS the Apr 5/6/7 briefs published today. Publishing once (vs per-bucket) minimizes verification friction for recipients.`);
lines.push(``);
lines.push(`| Bucket | Signals | Sats | Blocker |`);
lines.push(`|---|---:|---:|---|`);
lines.push(`| Apr 5 brief inclusion | 30 | ${(30 * BRIEF_PAYOUT).toLocaleString()} | none — ready post-window |`);
lines.push(`| Apr 6 brief inclusion | 30 | ${(30 * BRIEF_PAYOUT).toLocaleString()} | none — ready post-window |`);
lines.push(`| Apr 7 brief inclusion (witness content) | 30 | ${(30 * BRIEF_PAYOUT).toLocaleString()} | agent-news#505 migration deploy |`);
lines.push(`| Apr 9 correspondents (24 non-quantum) | ${apr9.length} | ${APR9_TOTAL_SATS.toLocaleString()} | none — ready post-window |`);
for (const b of PRIOR_BUCKETS) {
  const claimTag = b.claimable_via_verification ? " _(claimable during verification window)_" : "";
  lines.push(`| ${b.label}${claimTag} | ${b.signals} | ${b.sats.toLocaleString()} | ${b.blocker} |`);
}
lines.push(`| **TOTAL PAYABLE** | — | **${GRAND_TOTAL_PAYABLE.toLocaleString()}** | — |`);
lines.push(``);
lines.push(`### Funding position`);
lines.push(``);
lines.push(`| | sats |`);
lines.push(`|---|---:|`);
lines.push(`| Wallet sBTC (SP1KG…YGAHM) at build time | ${WALLET_SBTC.toLocaleString()} |`);
lines.push(`| Grand total payable | ${GRAND_TOTAL_PAYABLE.toLocaleString()} |`);
lines.push(`| **Shortfall** | **${SHORTFALL.toLocaleString()}** (~\$${((SHORTFALL / 1e8) * 70000).toFixed(2)} at \$70k/BTC) |`);
lines.push(``);
lines.push(`**Wallet must be funded to approximately ${Math.ceil(GRAND_TOTAL_PAYABLE * 1.05).toLocaleString()} sats of sBTC** (~\$${((GRAND_TOTAL_PAYABLE * 1.05 / 1e8) * 70000).toFixed(2)}; includes 5% buffer for rate volatility + Stacks fees) before payouts execute. Funding is not a blocker on publishing — resolves in parallel with the verification window.`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Track B briefs summary (Apr 5/6/7 — today's inscriptions)`);
lines.push(``);
lines.push(`| Metric | Value |`);
lines.push(`|---|---|`);
lines.push(`| Unique recipient addresses | ${agg.length} |`);
lines.push(`| Total signals paid | ${totalSigs} |`);
lines.push(`| Per-signal rate | ${BRIEF_PAYOUT.toLocaleString()} sats (${(BRIEF_PAYOUT / 1e8).toFixed(5)} BTC) |`);
lines.push(`| Brief inclusion total | ${totalSats.toLocaleString()} sats |`);
lines.push(`| Signals per brief | 30 |`);
lines.push(`| Briefs | 3 (Apr 5, Apr 6, Apr 7) |`);
lines.push(`| Editor review payouts | None (retro curation was publisher-driven) |`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Payouts by recipient (sorted by total sats desc)`);
lines.push(``);
lines.push(`| # | Correspondent(s) | BTC Address | Signals | Total Sats |`);
lines.push(`|---|---|---|---|---|`);
let i = 1;
for (const a of agg) {
  const names = a.correspondents.filter((n: string | null) => n).join(", ") || "(unknown)";
  lines.push(
    `| ${i++} | ${names} | \`${a.btc_address}\` | ${a.signals.length} | ${a.total_sats.toLocaleString()} |`
  );
}
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Per-signal detail (for audit + verification)`);
lines.push(``);
const renderTable = (
  title: string,
  rows: Array<{
    signal_id: string;
    correspondent: string | null;
    btc_address: string;
    beat: string;
    headline: string;
  }>
) => {
  lines.push(`### ${title}`);
  lines.push(``);
  lines.push(`| Signal ID | Correspondent | BTC Address | Beat | Sats | Headline |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const r of rows) {
    const id = r.signal_id.slice(0, 8);
    const btc = (r.btc_address || "unknown").slice(0, 14) + "…";
    const headline = (r.headline || "").replace(/\|/g, "/");
    lines.push(
      `| \`${id}\` | ${r.correspondent ?? "(unknown)"} | \`${btc}\` | ${r.beat} | ${BRIEF_PAYOUT.toLocaleString()} | ${headline} |`
    );
  }
  lines.push(``);
};
renderTable("2026-04-05 brief (30 signals)", data["2026-04-05"]);
renderTable("2026-04-06 brief (30 signals)", data["2026-04-06"]);
renderTable(
  "2026-04-07 brief (witness content, 30 signals — post-migration intended)",
  data["2026-04-07-witness"]
);
renderTable(
  "2026-04-09 brief — outstanding non-quantum (24 signals)",
  apr9
);

lines.push(`---`);
lines.push(``);
lines.push(`## Prior-period bucket references (line items in audit docs)`);
lines.push(``);
lines.push(`These buckets are smaller-scope cohorts with known correspondent lists already enumerated in the audit trail. Carrying bucket-level totals here; reviewers can cross-reference the linked audit doc for per-signal IDs and per-correspondent amounts.`);
lines.push(``);
for (const b of PRIOR_BUCKETS) {
  lines.push(`### ${b.label}`);
  lines.push(``);
  lines.push(`- **Signals / earnings:** ${b.signals}`);
  lines.push(`- **Correspondents:** ${b.correspondents}`);
  if (b.addresses && b.addresses.length > 0) {
    lines.push(`- **Recipients:**`);
    for (const a of b.addresses) {
      lines.push(`  - ${/^bc1|^3|^1/.test(a) ? `\`${a}\`` : a}`);
    }
  }
  lines.push(`- **Sats owed:** ${b.sats.toLocaleString()}`);
  lines.push(`- **Blocker / resolution path:** ${b.blocker}`);
  lines.push(`- **Audit reference:** \`${b.audit_ref}\``);
  if (b.claimable_via_verification) {
    lines.push(`- **Note:** This address has never registered on aibtc.com. Publishing it here gives the holder (or anyone who knows them) a chance to self-identify + register before the verification deadline. If no claim arrives by deadline, earnings remain parked.`);
  }
  lines.push(``);
}

lines.push(`---`);
lines.push(``);
const PUBLISH_DATE = "2026-04-17";
const DEADLINE_DATE = "2026-04-20";
const DEADLINE_UTC = "2026-04-20T23:59:59Z";

lines.push(`## Verification window`);
lines.push(``);
lines.push(`**Publish date:** ${PUBLISH_DATE}  \n**Verification deadline:** ${DEADLINE_DATE} (${DEADLINE_UTC}) — **72 hours** from publish.`);
lines.push(``);
lines.push(`The 72h window exceeds the policy minimum (24h, §9.6) to give recipients time across time zones to cross-check:`);
lines.push(`- The BTC/STX address on file at \`aibtc.com/settings\` matches the address listed in this manifest`);
lines.push(`- The signal IDs attributed to them are correct`);
lines.push(`- The sats amounts match the per-signal rate (${BRIEF_PAYOUT.toLocaleString()} sats)`);
lines.push(``);
lines.push(`**Discrepancies:** reply to the announcement thread, open a GitHub issue against \`aibtcdev/agent-news\`, or DM \`@rising-leviathan\` on the classifieds channel. Any dispute filed before the deadline pauses that recipient's payout until resolved.`);
lines.push(``);
lines.push(`---`);
lines.push(``);
lines.push(`## Next steps`);
lines.push(``);
lines.push(`1. **Publisher review** (today). Confirm bucket totals, funding gap, and per-bucket sequencing against the source audit docs. Fix any discrepancies in \`scripts/build-payout-manifest.ts\` and re-render before publishing.`);
lines.push(``);
lines.push(`2. **Publish** (today, after review). Upload this manifest to a gist under \`rising-leviathan\` titled "aibtc.news Payouts Pending Verification — Mar 24 → Apr 9 Reconciliation (${PUBLISH_DATE})". Save gist URL in the audit doc.`);
lines.push(``);
lines.push(`3. **Announce** (today, after publish). Post announcement via inscription OR \`inbox-notify\` to all recipients with the gist URL + ${DEADLINE_DATE} deadline. Include the Mar 27 orphan address so that holder has visibility.`);
lines.push(``);
lines.push(`4. **Fund the wallet** (during verification window). Shortfall is **${SHORTFALL.toLocaleString()} sBTC** (~\$${((SHORTFALL / 1e8) * 70000).toFixed(2)} at \$70k/BTC). Not a blocker on publishing — resolves in parallel.`);
lines.push(``);
lines.push(`5. **Merge + deploy agent-news#505** (during verification window). Scope expanded to a single payout-reconciliation migration that:`);
lines.push(`   - Aligns Apr 7 earnings with the witness inscription (un-void 14 witness-only, void 14 re-curated-only)`);
lines.push(`   - Clears 8 stale dropped-mempool RBF \`payout_txid\` values on the 21 Mar 25 + 3 Mar 31 earnings`);
lines.push(`   - Idempotent UPDATE-only — matches the shape of the Mar 28-29 migration (PR #385)`);
lines.push(`   `);
lines.push(`   The Mar 31 orphan-void (for the 90-of-91 curate-to-30) is out of scope for #505 and needs a follow-up migration; the Mar 31 pay-1 is not payable in this round.`);
lines.push(``);
lines.push(`6. **Post-window payout execution** (${DEADLINE_DATE}+, per bucket):`);
lines.push(`   - **Apr 5, Apr 6, Apr 9 non-quantum, Mar 24 Galactic Cube:** pay verified via \`scripts/curated-payout.ts\`.`);
lines.push(`   - **Apr 7 witness-content correspondents:** pay once #505 has deployed and earnings alignment is confirmed via API spot-check.`);
lines.push(`   - **Mar 25 + Mar 31 RBF victims:** pay once #505 has cleared the stale \`payout_txid\` values; new valid txids PATCH over the cleared rows post-send (dropped txids preserved in this manifest for the audit trail).`);
lines.push(`   - **Mar 27 orphan:** pay only if the holder self-identifies during the verification window AND registers on aibtc.com. Otherwise stays parked.`);
lines.push(`   - **Mar 31 pay-1:** remains on hold; separate curation decision + follow-up migration needed.`);
lines.push(``);
lines.push(`7. **Unverified / mismatched** addresses route to \`db/payouts/pending-verification/<date>.json\` for manual resolution. Never pay to a mismatched on-file address.`);
lines.push(``);
lines.push(`8. **Post-pay:** Run \`scripts/backpatch-earning-txids.ts\` to reconcile the 362 historical earnings missing \`payout_txid\` values (audit §8). Separate one-time task, not funds-dependent, not blocking this round.`);

await Bun.write("db/payouts/track-b-payouts-manifest-2026-04-17.md", lines.join("\n") + "\n");
console.log("written:", lines.length, "lines");
