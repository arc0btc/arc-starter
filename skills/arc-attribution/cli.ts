#!/usr/bin/env bun
// skills/arc-attribution/cli.ts
//
// MRR / attribution report CLI — P8 (arc-demand-flywheel).
// Usage:
//   bun skills/arc-attribution/cli.ts report            # human-readable
//   bun skills/arc-attribution/cli.ts report --json      # machine-readable (Discord monitor, CEO report)
//
// Exit code: 0 if no unattributed dollars, 1 if `unattributed_dollars` is non-empty (a real
// revenue/attribution mismatch worth alerting on).

import { computeAttributionReport, type AttributionReport } from "./lib/report.ts";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderHuman(r: AttributionReport): string {
  const lines: string[] = [];
  lines.push(`Arc attribution report — generated ${r.generated_at}`);
  lines.push("");
  lines.push(`MRR: ${usd(r.mrr.mrr_cents)}  (${r.mrr.active_members} active members, ${r.mrr.paying_customers} paying customers total)`);
  lines.push(`  source: ${r.mrr.source}`);
  lines.push("");
  lines.push(`Provenance split:`);
  lines.push(`  whop_sale:  organic=${r.provenance.whop_sale.organic} self_funded_test=${r.provenance.whop_sale.self_funded_test} other=${r.provenance.whop_sale.other}`);
  lines.push(`  x402_sale:  organic=${r.provenance.x402_sale.organic} self_funded_test=${r.provenance.x402_sale.self_funded_test} other=${r.provenance.x402_sale.other}`);
  lines.push("");
  lines.push(`Channel breakdown:`);
  if (r.channel_breakdown.length === 0) {
    lines.push("  (no attributed rows yet)");
  } else {
    for (const c of r.channel_breakdown) {
      lines.push(`  ${c.channel}: organic=${c.organic_count} (${usd(c.organic_amount_cents)}) self_funded_test=${c.self_funded_test_count}`);
    }
  }
  lines.push("");
  lines.push(`Pipeline:`);
  lines.push(`  whop_sale rows: ${r.pipeline.whop_sale_rows}`);
  lines.push(`  x402 organic/self-funded: ${r.pipeline.x402_sale_organic}/${r.pipeline.x402_sale_self_funded}`);
  lines.push(`  free-room joins: ${r.pipeline.free_room_joins}`);
  lines.push(
    `  email subscribers confirmed/pending: ${r.pipeline.email_subscribers_confirmed ?? "?"}/${r.pipeline.email_subscribers_pending ?? "?"}${r.pipeline.email_api_error ? ` (error: ${r.pipeline.email_api_error})` : ""}`,
  );
  lines.push("");
  lines.push(`Reach:`);
  lines.push(
    `  followers: ${r.reach.followers.current ?? "unknown"} (delta vs P0: ${r.reach.followers.delta_vs_p0 ?? "n/a"}) [${r.reach.followers.note}]`,
  );
  lines.push(`  daily-read editions posted: ${r.reach.daily_read_editions_posted}`);
  lines.push(`  articles published/staged-unfired: ${r.reach.articles_published}/${r.reach.articles_staged_unfired}`);
  lines.push(`  packaging backlog remaining: ${r.reach.packaging_backlog_remaining ?? "unknown"}`);
  lines.push("");
  lines.push(`Before (P0) -> After:`);
  for (const row of r.before_after) lines.push(`  ${row.metric}: ${row.before} -> ${row.after}`);
  lines.push("");
  if (r.unattributed_dollars.length > 0) {
    lines.push(`UNATTRIBUTED DOLLARS (action needed):`);
    for (const u of r.unattributed_dollars) lines.push(`  - ${u.detail}`);
  } else {
    lines.push(`No unattributed dollars.`);
  }
  lines.push("");
  lines.push(`Known gaps:`);
  for (const g of r.known_gaps) lines.push(`  - ${g}`);
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (cmd !== "report") {
    console.error("Usage: bun skills/arc-attribution/cli.ts report [--json]");
    process.exit(1);
  }
  const report = await computeAttributionReport();
  if (args.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHuman(report));
  }
  process.exit(report.unattributed_dollars.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
