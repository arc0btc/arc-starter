#!/usr/bin/env bun
/**
 * auto-queue CLI
 *
 * Commands:
 *   status  — Show queue depth and completion stats by domain
 *   hungry  — Show only hungry domains that would trigger batch generation
 *   trigger — Manually create a batch-generation task (bypasses sensor interval)
 */

import { collectDomainStats, type DomainStats } from "./sensor.ts";
import { insertTaskIfNew } from "../../src/sensors.ts";

const TASK_SOURCE = "sensor:auto-queue:manual";
const LOOKBACK_HOURS = 6;

function printStats(stats: DomainStats[], hungryOnly: boolean): void {
  const filtered = hungryOnly ? stats.filter((s) => s.hungry) : stats;

  if (filtered.length === 0) {
    console.log(hungryOnly ? "No hungry domains detected." : "No domain activity found.");
    return;
  }

  // Header
  const header = `${"Domain".padEnd(30)} ${"Comp".padStart(5)} ${"Fail".padStart(5)} ${"Crtd".padStart(5)} ${"Pend".padStart(5)} ${"Actv".padStart(5)} ${"Avg$".padStart(7)} ${"Hungry".padStart(7)}`;
  console.log(header);
  console.log("-".repeat(header.length));

  for (const s of filtered) {
    const line = [
      s.domain.padEnd(30),
      String(s.completed).padStart(5),
      String(s.failed).padStart(5),
      String(s.created).padStart(5),
      String(s.pending).padStart(5),
      String(s.active).padStart(5),
      `$${s.avg_cost_usd.toFixed(2)}`.padStart(7),
      (s.hungry ? "YES" : "no").padStart(7),
    ].join(" ");
    console.log(line);
    if (s.hungry && s.reason) {
      console.log(`  -> ${s.reason}`);
    }
  }

  const totalCompleted = filtered.reduce((a, s) => a + s.completed, 0);
  const totalPending = filtered.reduce((a, s) => a + s.pending, 0);
  const hungryCount = filtered.filter((s) => s.hungry).length;
  console.log(`\n${filtered.length} domain(s), ${totalCompleted} completed (${LOOKBACK_HOURS}h), ${totalPending} pending, ${hungryCount} hungry`);
}

function triggerBatch(stats: DomainStats[]): void {
  const hungryDomains = stats.filter((s) => s.hungry);

  if (hungryDomains.length === 0) {
    console.log("No hungry domains — nothing to trigger.");
    return;
  }

  const domainLines = hungryDomains.map((d) =>
    `- **${d.domain}**: ${d.reason} (completed=${d.completed}, failed=${d.failed}, pending=${d.pending}, avg_cost=$${d.avg_cost_usd.toFixed(2)})`
  ).join("\n");

  const description = [
    `Manual auto-queue trigger: ${hungryDomains.length} hungry domain(s) in the last ${LOOKBACK_HOURS}h.\n`,
    "## Hungry Domains\n",
    domainLines,
    "",
    "## Instructions\n",
    "1. Read GOALS.md to align new tasks with current priorities",
    "2. For each hungry domain, create 3-5 follow-up tasks using `arc tasks add`",
    "3. Match priority to the domain's typical work",
    "4. Include the domain skill in `--skills`",
  ].join("\n");

  const created = insertTaskIfNew(TASK_SOURCE, {
    subject: `Auto-queue (manual): ${hungryDomains.length} hungry domain(s) need work`,
    description,
    priority: 5,
    skills: '["auto-queue"]',
  });

  if (created !== null) {
    console.log(`Created batch task #${created} for ${hungryDomains.length} hungry domain(s).`);
  } else {
    console.log("A batch task is already pending. Skipping.");
  }
}

// ---- Main ----

const args = process.argv.slice(2);
const command = args[0] ?? "status";

// Initialize DB (sensors.ts imports handle this, but ensure it's ready)
const { initDatabase } = await import("../../src/db.ts");
initDatabase();

const stats = collectDomainStats();

switch (command) {
  case "status":
    printStats(stats, false);
    break;
  case "hungry":
    printStats(stats, true);
    break;
  case "trigger":
    triggerBatch(stats);
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Usage: auto-queue [status|hungry|trigger]");
    process.exit(1);
}
