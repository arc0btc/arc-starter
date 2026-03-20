#!/usr/bin/env bun

import {
  initDatabase,
  countArcMemories,
  listArcMemory,
  searchArcMemory,
  expireArcMemories,
  consolidateMemories,
  findDuplicateGroups,
  getArcMemory,
} from "../../src/db.ts";
import type { ArcMemoryFull } from "../../src/db.ts";

initDatabase();

const DOMAINS = [
  "fleet",
  "incidents",
  "cost",
  "integrations",
  "defi",
  "publishing",
  "identity",
  "infrastructure",
] as const;

function parseArgs(args: string[]): { command: string; params: Record<string, string> } {
  const command = args[0] ?? "";
  const params: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i]?.startsWith("--")) {
      const key = args[i].slice(2);
      params[key] = args[i + 1] || "";
      i++;
    }
  }
  return { command, params };
}

function formatDate(iso: string): string {
  return iso.replace("T", " ").slice(0, 19);
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

function cmdHealth(): void {
  const total = countArcMemories();
  const allEntries = listArcMemory(undefined, 1000);

  const noTtl = allEntries.filter((e) => e.ttl_days === null).length;
  const now = Date.now();
  const stale90 = allEntries.filter(
    (e) => now - new Date(e.updated_at).getTime() > 90 * 24 * 60 * 60 * 1000,
  ).length;
  const stale60 = allEntries.filter(
    (e) => now - new Date(e.updated_at).getTime() > 60 * 24 * 60 * 60 * 1000,
  ).length;
  const highImportance = allEntries.filter((e) => e.importance <= 3).length;
  const lowImportance = allEntries.filter((e) => e.importance >= 8).length;

  console.log("=== Memory Health Report ===\n");
  console.log(`Total entries:      ${total}`);
  console.log(`Without TTL:        ${noTtl} (${total > 0 ? Math.round((noTtl / total) * 100) : 0}%)`);
  console.log(`Stale (60+ days):   ${stale60}`);
  console.log(`Stale (90+ days):   ${stale90}`);
  console.log(`High importance:    ${highImportance} (importance 1-3)`);
  console.log(`Low importance:     ${lowImportance} (importance 8-10)`);

  console.log("\n--- Domain Breakdown ---");
  for (const domain of DOMAINS) {
    const count = countArcMemories(domain);
    if (count > 0) {
      const bar = "#".repeat(Math.min(count, 40));
      console.log(`  ${domain.padEnd(16)} ${String(count).padStart(4)}  ${bar}`);
    }
  }

  // Orphaned domains (not in standard list)
  const knownDomains = new Set<string>(DOMAINS);
  const otherDomains = new Set<string>();
  for (const e of allEntries) {
    if (!knownDomains.has(e.domain)) otherDomains.add(e.domain);
  }
  if (otherDomains.size > 0) {
    console.log("\n--- Non-Standard Domains ---");
    for (const d of otherDomains) {
      const count = allEntries.filter((e) => e.domain === d).length;
      console.log(`  ${d.padEnd(16)} ${String(count).padStart(4)}`);
    }
  }

  // Status
  const issues: string[] = [];
  if (total > 500) issues.push(`Entry count (${total}) exceeds 500`);
  if (noTtl > total * 0.8 && total > 20) issues.push(`${Math.round((noTtl / total) * 100)}% entries lack TTL`);
  if (stale90 > 10) issues.push(`${stale90} entries stale 90+ days`);

  if (issues.length > 0) {
    console.log("\n--- Issues ---");
    for (const issue of issues) console.log(`  ⚠ ${issue}`);
  } else {
    console.log("\n✓ No issues detected");
  }
}

function cmdAnalyze(params: Record<string, string>): void {
  const domain = params.domain;
  const entries = listArcMemory(domain, 1000);

  if (entries.length === 0) {
    console.log(domain ? `No entries in domain "${domain}"` : "No memory entries found");
    return;
  }

  console.log(`=== Memory Analysis${domain ? ` (${domain})` : ""} ===\n`);
  console.log(`Entries: ${entries.length}`);

  // Importance distribution
  const importanceBuckets: Record<string, number> = { "1-3 (high)": 0, "4-6 (medium)": 0, "7-10 (low)": 0 };
  for (const e of entries) {
    if (e.importance <= 3) importanceBuckets["1-3 (high)"]++;
    else if (e.importance <= 6) importanceBuckets["4-6 (medium)"]++;
    else importanceBuckets["7-10 (low)"]++;
  }
  console.log("\n--- Importance Distribution ---");
  for (const [bucket, count] of Object.entries(importanceBuckets)) {
    console.log(`  ${bucket.padEnd(16)} ${String(count).padStart(4)}`);
  }

  // TTL status
  const withTtl = entries.filter((e) => e.ttl_days !== null);
  const withoutTtl = entries.filter((e) => e.ttl_days === null);
  console.log("\n--- TTL Status ---");
  console.log(`  With TTL:    ${withTtl.length}`);
  console.log(`  Without TTL: ${withoutTtl.length}`);
  if (withTtl.length > 0) {
    const ttlValues = withTtl.map((e) => e.ttl_days as number);
    console.log(`  TTL range:   ${Math.min(...ttlValues)}-${Math.max(...ttlValues)} days`);
  }

  // Age distribution
  const now = Date.now();
  const ageBuckets: Record<string, number> = { "<7d": 0, "7-30d": 0, "30-90d": 0, ">90d": 0 };
  for (const e of entries) {
    const age = (now - new Date(e.created_at).getTime()) / (1000 * 60 * 60 * 24);
    if (age < 7) ageBuckets["<7d"]++;
    else if (age < 30) ageBuckets["7-30d"]++;
    else if (age < 90) ageBuckets["30-90d"]++;
    else ageBuckets[">90d"]++;
  }
  console.log("\n--- Age Distribution ---");
  for (const [bucket, count] of Object.entries(ageBuckets)) {
    console.log(`  ${bucket.padEnd(16)} ${String(count).padStart(4)}`);
  }

  // Recent entries
  const sorted = [...entries].sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
  console.log("\n--- 5 Most Recent ---");
  for (const e of sorted.slice(0, 5)) {
    console.log(`  [${e.domain}] ${e.key} (${daysAgo(e.updated_at)}d ago, imp=${e.importance})`);
  }
}

function cmdStale(params: Record<string, string>): void {
  const days = parseInt(params.days || "60", 10);
  const entries = listArcMemory(undefined, 1000);
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  const stale = entries
    .filter((e) => new Date(e.updated_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());

  if (stale.length === 0) {
    console.log(`No entries older than ${days} days`);
    return;
  }

  console.log(`=== Stale Entries (>${days} days since update) ===\n`);
  console.log(`Found: ${stale.length}\n`);
  for (const e of stale) {
    const age = daysAgo(e.updated_at);
    const ttlStr = e.ttl_days !== null ? `ttl=${e.ttl_days}d` : "no-ttl";
    console.log(`  ${age}d  [${e.domain}] ${e.key} (imp=${e.importance}, ${ttlStr})`);
  }
}

function cmdDedup(params: Record<string, string>): void {
  const domain = params.domain;
  const entries = listArcMemory(domain, 1000);

  if (entries.length < 2) {
    console.log("Not enough entries for dedup analysis");
    return;
  }

  console.log(`=== Dedup Analysis${domain ? ` (${domain})` : ""} ===\n`);

  // Group by key prefix (before first colon or hyphen)
  const prefixGroups = new Map<string, ArcMemoryFull[]>();
  for (const e of entries) {
    const prefix = e.key.split(/[:\-]/)[0] || e.key;
    const group = prefixGroups.get(prefix) || [];
    group.push(e);
    prefixGroups.set(prefix, group);
  }

  // Find groups with >1 entry (potential duplicates)
  let foundDupes = false;
  for (const [prefix, group] of prefixGroups) {
    if (group.length > 1) {
      if (!foundDupes) {
        console.log("Potential duplicate groups (shared key prefix):\n");
        foundDupes = true;
      }
      console.log(`  Prefix "${prefix}" (${group.length} entries):`);
      for (const e of group) {
        console.log(`    - ${e.key} [${e.domain}] (${daysAgo(e.updated_at)}d ago)`);
      }
      console.log();
    }
  }

  // Simple content similarity: entries with very short content that might be redundant
  const shortEntries = entries.filter((e) => e.content.length < 50);
  if (shortEntries.length > 0) {
    console.log(`\nShort-content entries (< 50 chars, may be stubs):`);
    for (const e of shortEntries) {
      console.log(`  ${e.key} [${e.domain}]: "${e.content.slice(0, 80)}"`);
    }
  }

  if (!foundDupes && shortEntries.length === 0) {
    console.log("No obvious duplicates detected");
  }
}

function cmdExpire(): void {
  const expired = expireArcMemories();
  console.log(`Expired ${expired} entries`);
}

function cmdTop(params: Record<string, string>): void {
  const limit = parseInt(params.limit || "10", 10);
  const entries = listArcMemory(undefined, 1000);

  const sorted = [...entries].sort((a, b) => a.importance - b.importance);
  const top = sorted.slice(0, limit);

  if (top.length === 0) {
    console.log("No entries found");
    return;
  }

  console.log(`=== Top ${limit} by Importance ===\n`);
  for (const e of top) {
    const ttlStr = e.ttl_days !== null ? `ttl=${e.ttl_days}d` : "no-ttl";
    console.log(
      `  imp=${e.importance}  [${e.domain}] ${e.key} (${daysAgo(e.updated_at)}d ago, ${ttlStr})`,
    );
    console.log(`         ${e.content.slice(0, 100)}${e.content.length > 100 ? "..." : ""}`);
  }
}

function cmdConsolidate(params: Record<string, string>): void {
  const domain = params.domain;
  const result = consolidateMemories(domain);

  console.log("=== Memory Consolidation Report ===\n");
  console.log(`TTL assigned:        ${result.ttlAssigned} entries`);
  console.log(`Importance decayed:  ${result.importanceDecayed} entries`);
  console.log(`Expired (removed):   ${result.expired} entries`);

  if (result.domainAlerts.length > 0) {
    console.log("\n--- Domain Budget Alerts ---");
    for (const alert of result.domainAlerts) {
      console.log(`  ${alert.domain.padEnd(16)} ${alert.count} entries (over budget)`);
    }
  } else {
    console.log("\nAll domains within budget.");
  }

  // Also show duplicate groups if any
  const dupes = findDuplicateGroups(domain);
  const largeDupes = [...dupes.entries()].filter(([, g]) => g.length > 3);
  if (largeDupes.length > 0) {
    console.log("\n--- Large Duplicate Groups (>3 entries) ---");
    for (const [prefix, group] of largeDupes) {
      console.log(`  "${prefix}" — ${group.length} entries`);
    }
    console.log("\nRun 'dedup' for detailed duplicate analysis.");
  }

  const remaining = countArcMemories(domain);
  console.log(`\nTotal remaining: ${remaining} entries`);
}

function cmdFleetStatus(): void {
  const AGENT_NAMES = ["spark", "iris", "loom", "forge"];
  const entries = AGENT_NAMES.map((name) => ({
    name,
    entry: getArcMemory(`fleet-state:${name}`),
  }));

  const hasAny = entries.some((e) => e.entry !== null);
  if (!hasAny) {
    console.log("No fleet-state memory entries found.");
    console.log("Fleet-health sensor populates these every 15 minutes.");
    return;
  }

  console.log("=== Fleet State (from memory) ===\n");

  for (const { name, entry } of entries) {
    if (!entry) {
      console.log(`--- ${name} ---\n  No state recorded\n`);
      continue;
    }
    console.log(`--- ${name} ---`);
    for (const line of entry.content.split("\n")) {
      console.log(`  ${line}`);
    }
    const age = Math.floor((Date.now() - new Date(entry.updated_at).getTime()) / 60000);
    console.log(`  Memory updated: ${age}m ago (importance=${entry.importance})\n`);
  }
}

function printUsage(): void {
  console.log(`Usage: bun skills/memory-hygiene/cli.ts <command> [options]

Commands:
  health                          Full health report
  analyze [--domain DOMAIN]       Domain breakdown and stats
  stale [--days N]                Find stale entries (default: 60 days)
  dedup [--domain DOMAIN]         Detect potential duplicates
  expire                          Run TTL expiry pass
  consolidate [--domain DOMAIN]   Run full pruning pass (TTL, decay, expire, budget)
  top [--limit N]                 Highest importance entries (default: 10)
  fleet-status                    Per-agent fleet state dashboard`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, params } = parseArgs(args);

  switch (command) {
    case "health":
      cmdHealth();
      break;
    case "analyze":
      cmdAnalyze(params);
      break;
    case "stale":
      cmdStale(params);
      break;
    case "dedup":
      cmdDedup(params);
      break;
    case "expire":
      cmdExpire();
      break;
    case "consolidate":
      cmdConsolidate(params);
      break;
    case "top":
      cmdTop(params);
      break;
    case "fleet-status":
      cmdFleetStatus();
      break;
    default:
      printUsage();
      if (command) process.exit(1);
  }
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
