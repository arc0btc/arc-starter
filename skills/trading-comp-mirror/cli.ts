#!/usr/bin/env bun
/**
 * trading-comp-mirror CLI — competitor trade analysis.
 *
 * Usage:
 *   arc skills run --name trading-comp-mirror -- list [--limit N] [--competitor <addr|label>] [--since YYYY-MM-DD]
 *   arc skills run --name trading-comp-mirror -- stats [--days N]
 *   arc skills run --name trading-comp-mirror -- competitors
 *   arc skills run --name trading-comp-mirror -- add-competitor --address <STX_addr> --label <name>
 *   arc skills run --name trading-comp-mirror -- remove-competitor --address <STX_addr>
 */

import { resolve } from "node:path";

const COMPETITORS_PATH = resolve(import.meta.dir, "competitors.json");
const TRADES_PATH = resolve(import.meta.dir, "trades.json");

interface Competitor {
  address: string;
  label: string;
}

interface TradeRecord {
  txid: string;
  competitor_address: string;
  competitor_label: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  burn_block_time: number;
  tx_status: string;
  detected_at: string;
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

async function loadCompetitors(): Promise<Competitor[]> {
  const file = Bun.file(COMPETITORS_PATH);
  if (!(await file.exists())) return [];
  return file.json();
}

async function saveCompetitors(list: Competitor[]): Promise<void> {
  await Bun.write(COMPETITORS_PATH, JSON.stringify(list, null, 2) + "\n");
}

async function loadTrades(): Promise<TradeRecord[]> {
  const file = Bun.file(TRADES_PATH);
  if (!(await file.exists())) return [];
  return file.json();
}

function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function shortToken(token: string): string {
  // Return last segment after "." (contract name) or the full string if no dot
  const parts = token.split(".");
  return parts[parts.length - 1] ?? token;
}

const [, , command, ...rest] = process.argv;
const flags = parseFlags(rest);

if (!command) {
  console.error(
    "Usage: bun skills/trading-comp-mirror/cli.ts <list|stats|competitors|add-competitor|remove-competitor> [flags]",
  );
  process.exit(1);
}

try {
  if (command === "list") {
    const trades = await loadTrades();
    const limit = flags.limit ? parseInt(flags.limit, 10) : 20;
    const competitorFilter = flags.competitor?.toLowerCase();
    const sinceFilter = flags.since
      ? new Date(flags.since).getTime() / 1000
      : 0;

    let filtered = trades.filter((t) => {
      if (
        competitorFilter &&
        !t.competitor_address.toLowerCase().includes(competitorFilter) &&
        !t.competitor_label.toLowerCase().includes(competitorFilter)
      ) {
        return false;
      }
      if (sinceFilter && t.burn_block_time < sinceFilter) return false;
      return true;
    });

    filtered = filtered.slice(0, limit);

    if (filtered.length === 0) {
      console.log("No trades found (run sensors to populate).");
    } else {
      console.log(
        `${"Competitor".padEnd(20)} ${"Pair".padEnd(30)} ${"Block Time".padEnd(22)} ${"Txid".padEnd(20)}`,
      );
      console.log("-".repeat(95));
      for (const t of filtered) {
        const pair = `${shortToken(t.token_in)} → ${shortToken(t.token_out)}`;
        const txShort = t.txid.slice(0, 18) + "…";
        console.log(
          `${t.competitor_label.padEnd(20)} ${pair.padEnd(30)} ${formatTimestamp(t.burn_block_time).padEnd(22)} ${txShort}`,
        );
      }
      console.log(`\n${filtered.length} trade(s) shown.`);
    }
  } else if (command === "stats") {
    const trades = await loadTrades();
    const days = flags.days ? parseInt(flags.days, 10) : 7;
    const cutoff = Date.now() / 1000 - days * 86400;

    const recent = trades.filter((t) => t.burn_block_time >= cutoff);

    if (recent.length === 0) {
      console.log(`No trades in the last ${days} day(s).`);
    } else {
      // Pair frequency table
      const pairCounts: Record<string, { total: number; competitors: Record<string, number> }> =
        {};

      for (const t of recent) {
        const pair = `${shortToken(t.token_in)} → ${shortToken(t.token_out)}`;
        if (!pairCounts[pair]) pairCounts[pair] = { total: 0, competitors: {} };
        pairCounts[pair].total++;
        pairCounts[pair].competitors[t.competitor_label] =
          (pairCounts[pair].competitors[t.competitor_label] ?? 0) + 1;
      }

      const sorted = Object.entries(pairCounts).sort(
        ([, a], [, b]) => b.total - a.total,
      );

      console.log(`Pair frequency — last ${days} day(s), ${recent.length} total trades\n`);
      console.log(`${"Pair".padEnd(35)} ${"Count".padEnd(8)} Competitors`);
      console.log("-".repeat(70));
      for (const [pair, data] of sorted) {
        const compStr = Object.entries(data.competitors)
          .map(([label, count]) => `${label}(${count})`)
          .join(", ");
        console.log(
          `${pair.padEnd(35)} ${String(data.total).padEnd(8)} ${compStr}`,
        );
      }
    }
  } else if (command === "competitors") {
    const competitors = await loadCompetitors();
    if (competitors.length === 0) {
      console.log("No competitors configured. Use add-competitor to add one.");
    } else {
      console.log(`${"Label".padEnd(25)} Address`);
      console.log("-".repeat(65));
      for (const c of competitors) {
        console.log(`${c.label.padEnd(25)} ${c.address}`);
      }
    }
  } else if (command === "add-competitor") {
    if (!flags.address || !flags.label) {
      console.error("Error: --address and --label are required");
      process.exit(1);
    }
    if (!/^SP[A-Z0-9]+$/.test(flags.address)) {
      console.error(
        "Error: --address must be a valid Stacks mainnet address (SP prefix)",
      );
      process.exit(1);
    }
    const competitors = await loadCompetitors();
    if (competitors.some((c) => c.address === flags.address)) {
      console.log(`Already tracking ${flags.address} — no change.`);
    } else {
      competitors.push({ address: flags.address, label: flags.label });
      await saveCompetitors(competitors);
      console.log(`Added competitor: ${flags.label} (${flags.address})`);
    }
  } else if (command === "remove-competitor") {
    if (!flags.address) {
      console.error("Error: --address is required");
      process.exit(1);
    }
    const competitors = await loadCompetitors();
    const before = competitors.length;
    const updated = competitors.filter((c) => c.address !== flags.address);
    if (updated.length === before) {
      console.log(`Address ${flags.address} not found in competitors.json — no change.`);
    } else {
      await saveCompetitors(updated);
      console.log(`Removed competitor: ${flags.address}`);
    }
  } else {
    console.error(
      `Unknown command: ${command}. Use: list, stats, competitors, add-competitor, remove-competitor`,
    );
    process.exit(1);
  }
} catch (error) {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
