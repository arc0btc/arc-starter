#!/usr/bin/env bun
// skills/arc-attribution/cli.ts
//
// MRR / attribution report CLI — P8 (arc-demand-flywheel).
// Usage:
//   bun skills/arc-attribution/cli.ts report            # human-readable
//   bun skills/arc-attribution/cli.ts report --json      # machine-readable (Discord monitor, CEO report)
//
// JSON output is ALWAYS a parseable object, even on failure — dev-council (hohpe/newman/
// kleppmann, 2026-07-05) all independently flagged that an unhandled throw previously produced
// empty stdout + exit 1, indistinguishable from the "found unattributed dollars" business
// signal, to a cross-machine caller (the Discord monitor) that can only see exit code + stdout.
// Exit codes are now distinct:
//   0 = report computed cleanly, no unattributed dollars
//   1 = report computed cleanly, unattributed_dollars is non-empty (a business signal — real
//       revenue with no channel attribution, worth alerting on, NOT a crash)
//   2 = computeAttributionReport() itself threw — stdout still carries a parseable
//       {status:"error", ...} JSON object with the error message, never blank output
//
// control-plane-remediation Phase 7 (track c) added a second command:
//   bun skills/arc-attribution/cli.ts record-click --ref <code> --surface <s> --target <url> [--note <text>]
// This is the manual/CLI ingestion point for click_log this phase — a live public /go/:ref
// redirect + a KV-to-click_log sync step are named follow-ups, not built this phase (see
// SKILL.md). Exit 0 on success, 2 on validation failure (unknown ref_code, missing flag),
// matching `report`'s exit-code discipline (2 = "this command could not do its job", never a
// blank/unparseable stdout).

import { computeAttributionReport, SCHEMA_VERSION, type AttributionReport } from "./lib/report.ts";
import { recordClick } from "./lib/click-log.ts";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function renderHuman(r: AttributionReport): string {
  const lines: string[] = [];
  lines.push(`Arc attribution report (schema v${r.schema_version}) — generated ${r.generated_at}`);
  lines.push("");
  lines.push(`MRR: ${usd(r.mrr.mrr_cents)}  (${r.mrr.active_members} active members, ${r.mrr.paying_customers} paying customers total)`);
  lines.push(`  source: ${r.mrr.source}`);
  lines.push(`  caveat: ${r.mrr.provenance_caveat}`);
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
      const incomplete = c.organic_amount_cents_complete ? "" : " (incomplete — excludes x402 amounts)";
      const missing = c.organic_rows_with_missing_amount > 0 ? ` [${c.organic_rows_with_missing_amount} row(s) missing amount]` : "";
      lines.push(`  ${c.channel}: organic=${c.organic_count} (${usd(c.organic_amount_cents)}${incomplete}) self_funded_test=${c.self_funded_test_count}${missing}`);
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
  lines.push(
    `  packaging backlog remaining: ${r.reach.packaging_backlog_remaining ?? `unknown (${r.reach.packaging_backlog_error})`}`,
  );
  lines.push("");
  lines.push(`Before (P0) -> After:`);
  for (const row of r.before_after) lines.push(`  ${row.metric}: ${row.before} -> ${row.after}`);
  lines.push("");
  if (r.unattributed_dollars.length > 0) {
    lines.push(`UNATTRIBUTED DOLLARS (action needed):`);
    for (const u of r.unattributed_dollars) lines.push(`  - [gap=${u.gap_count}] ${u.detail}`);
  } else {
    lines.push(`No unattributed dollars.`);
  }
  lines.push("");
  lines.push(`Demand-gen (P5, arc-demand-gen):`);
  const dr = r.demand_gen.daily_read;
  lines.push(
    `  daily-read: last_queued=${dr.last_queued_date ?? "unknown"} (${dr.days_stale ?? "?"}d stale)` +
      (dr.last_defer_reason ? ` | last defer: ${dr.last_defer_reason} @ ${dr.last_defer_at}` : "") +
      (dr.hook_state_error ? ` | ERROR: ${dr.hook_state_error}` : ""),
  );
  lines.push(
    `  x402 listing: checked directly by ops/monitor/arc-demand-gen-health.ts (manage-agents repo), not this report — see that monitor's output`,
  );
  lines.push(
    `  mention pre-fill: ${r.demand_gen.mention_pipeline.mention_events_total} event(s) logged, ${r.demand_gen.mention_pipeline.candidates_curated} candidate(s) curated` +
      (r.demand_gen.mention_pipeline.last_mention_at
        ? ` | last: article ${r.demand_gen.mention_pipeline.last_mention_article_n} @ ${r.demand_gen.mention_pipeline.last_mention_at}`
        : ""),
  );
  lines.push(`  seed-batch actions logged: ${r.demand_gen.seed_batch.operator_channel_actions_logged}`);
  lines.push("");
  lines.push(`Click attribution (Phase 7, click_log joined to whop_sale/x402_sale by a_param/ref_code):`);
  if (r.click_attribution.length === 0) {
    lines.push("  (no clicks recorded yet — see 'record-click' subcommand)");
  } else {
    for (const c of r.click_attribution) {
      lines.push(
        `  ${c.ref_code}: ${c.clicks} click(s) [${c.first_clicked_at} .. ${c.last_clicked_at}] -> ` +
          `matched_whop_sales=${c.matched_whop_sales} matched_x402_sales=${c.matched_x402_sales}`,
      );
    }
  }
  lines.push("");
  lines.push(`Known gaps:`);
  for (const g of r.known_gaps) lines.push(`  - ${g}`);
  return lines.join("\n");
}

function flagValue(args: string[], flag: string): string | undefined {
  const flagIndex = args.indexOf(flag);
  if (flagIndex === -1) return undefined;
  return args[flagIndex + 1];
}

async function runRecordClick(args: string[]) {
  const ref = flagValue(args, "--ref");
  const surface = flagValue(args, "--surface");
  const target = flagValue(args, "--target");
  const note = flagValue(args, "--note");
  if (!ref || !surface || !target) {
    console.error(
      "Usage: bun skills/arc-attribution/cli.ts record-click --ref <code> --surface <s> --target <url> [--note <text>]",
    );
    process.exit(2);
    return;
  }
  try {
    const row = recordClick({ ref_code: ref, surface, target_url: target, source_note: note });
    console.log(JSON.stringify({ status: "ok", row }, null, 2));
    process.exit(0);
  } catch (error) {
    console.log(
      JSON.stringify(
        { status: "error", error: error instanceof Error ? error.message : String(error) },
        null,
        2,
      ),
    );
    process.exit(2);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === "record-click") {
    await runRecordClick(args.slice(1));
    return;
  }
  if (command !== "report") {
    console.error("Usage: bun skills/arc-attribution/cli.ts report [--json]");
    console.error("       bun skills/arc-attribution/cli.ts record-click --ref <code> --surface <s> --target <url> [--note <text>]");
    process.exit(2);
    return;
  }
  const asJson = args.includes("--json");

  let report: AttributionReport;
  try {
    report = await computeAttributionReport();
  } catch (error) {
    const errorPayload = {
      schema_version: SCHEMA_VERSION,
      status: "error" as const,
      generated_at: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
    // Always emit parseable JSON, even in human-readable mode — a crash should never produce
    // blank/unparseable output to a caller shelling this out over SSH.
    console.log(JSON.stringify(errorPayload, null, asJson ? 2 : undefined));
    process.exit(2);
    return;
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(renderHuman(report));
  }
  process.exit(report.unattributed_dollars.length > 0 ? 1 : 0);
}

if (import.meta.main) {
  await main();
}
