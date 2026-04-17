#!/usr/bin/env bun
// scripts/build-payout-manifest.ts
// Renders the Track B publish-before-payout manifest as markdown.
// Reads /tmp/manifest-data.json and /tmp/manifest-agg.json (prepared by ad-hoc bun scripts).

const data = await Bun.file("/tmp/manifest-data.json").json();
const agg = await Bun.file("/tmp/manifest-agg.json").json();
const BRIEF_PAYOUT = 30000;

const totalSats = agg.reduce((s: number, r: { total_sats: number }) => s + r.total_sats, 0);
const totalSigs = agg.reduce(
  (s: number, r: { signals: unknown[] }) => s + r.signals.length,
  0
);

const lines: string[] = [];
lines.push(`# aibtc.news Payouts Pending Verification — Apr 5/6/7 Briefs (2026-04-17)`);
lines.push(``);
lines.push(`**Status:** DRAFT — under review by publisher, not yet announced`);
lines.push(
  `**Policy:** Publish-before-payout (2026-04-16 audit §9.6). Recipients have a 24h window after announcement to verify their on-file BTC addresses on aibtc.com. Unverified/mismatched entries route to \`db/payouts/pending-verification/<date>.json\` for manual resolution; only verified recipients receive on-chain sends.`
);
lines.push(`**Briefs covered:** 2026-04-05, 2026-04-06, 2026-04-07`);
lines.push(`**Inscriptions:**`);
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
lines.push(`## Summary`);
lines.push(``);
lines.push(`| Metric | Value |`);
lines.push(`|---|---|`);
lines.push(`| Unique recipient addresses | ${agg.length} |`);
lines.push(`| Total signals paid | ${totalSigs} |`);
lines.push(
  `| Per-signal rate | ${BRIEF_PAYOUT.toLocaleString()} sats (${(BRIEF_PAYOUT / 1e8).toFixed(5)} BTC) |`
);
lines.push(`| Total sats | ${totalSats.toLocaleString()} |`);
lines.push(`| Total BTC | ${(totalSats / 1e8).toFixed(8)} |`);
lines.push(`| Signals per brief | 30 |`);
lines.push(`| Briefs | 3 (Apr 5, Apr 6, Apr 7) |`);
lines.push(
  `| Editor review payouts | None (retro curation was publisher-driven; no editor review earnings for these dates) |`
);
lines.push(
  `| Beat-filler / top-filler bonuses | None applicable for retro-dated briefs |`
);
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

lines.push(`---`);
lines.push(``);
lines.push(`## Verification window + next steps`);
lines.push(``);
lines.push(
  `1. **Review this manifest.** Publisher confirms payouts match the three briefs' inscribed content.`
);
lines.push(
  `2. **Publish.** Upload to gist under \`rising-leviathan\` titled "aibtc.news Payouts Pending Verification — Apr 5/6/7 Briefs (2026-04-17)". Save gist URL here + in the manifest metadata above.`
);
lines.push(
  `3. **Announce.** Post announcement via inscription OR inbox-notify to all ${agg.length} recipients with the gist URL + 24h verification deadline.`
);
lines.push(
  `4. **Hold Apr 7 payouts** until PR #505 deploys. Apr 5/6 payouts proceed on schedule post-window.`
);
lines.push(
  `5. **Post-window:** Pay verified via \`scripts/curated-payout.ts\`; unverified/mismatched route to \`db/payouts/pending-verification/<date>.json\`.`
);

await Bun.write("db/payouts/track-b-payouts-manifest-2026-04-17.md", lines.join("\n") + "\n");
console.log("written:", lines.length, "lines");
