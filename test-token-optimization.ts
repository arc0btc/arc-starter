#!/usr/bin/env bun
/**
 * Test harness for token optimization impact measurement.
 * Runs dispatch cycles with and without optimization flags and measures costs.
 */

import { Database } from "bun:sqlite";
import { join } from "node:path";

const ROOT = import.meta.dir;
const db = new Database(join(ROOT, "db", "arc.sqlite"));

interface CycleRecord {
  id: number;
  task_id: number | null;
  started_at: string;
  duration_ms: number | null;
  cost_usd: number | null;
}

function getCyclesSince(afterDate: string): CycleRecord[] {
  const stmt = db.prepare(`
    SELECT id, task_id, started_at, duration_ms, cost_usd
    FROM cycle_log
    WHERE started_at > ?
    ORDER BY started_at ASC
  `);
  return stmt.all(afterDate) as CycleRecord[];
}

function getTaskById(id: number) {
  const stmt = db.prepare("SELECT id, subject, status FROM tasks WHERE id = ?");
  return stmt.get(id) as { id: number; subject: string; status: string } | undefined;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log("=== Token Optimization Test Harness ===\n");

  const baselineTestTasks = [563, 564, 565, 566, 567];
  const optimizedTestTasks = [568, 569, 570, 571, 572];

  // Phase 1: Baseline measurement (5 cycles without optimization)
  console.log("Phase 1: Baseline measurement (5 cycles)\n");
  const baselineStartTime = new Date().toISOString();

  for (let i = 0; i < 5; i++) {
    console.log(`  Running baseline cycle ${i + 1}/5...`);
    const proc = Bun.spawn(["bash", "bin/arc", "run"], { cwd: ROOT });
    await proc.exited;
    await sleep(2000); // Wait for DB to settle
  }

  const baselineCycles = getCyclesSince(baselineStartTime);
  const baselineData = baselineCycles.slice(0, 5);
  const baselineCosts = baselineData
    .map((c) => c.cost_usd ?? 0)
    .filter((cost) => cost > 0);
  const baselineAvg = baselineCosts.length > 0 ? baselineCosts.reduce((a, b) => a + b) / baselineCosts.length : 0;

  console.log(`  Baseline cycles completed: ${baselineData.length}`);
  console.log(`  Baseline costs: ${baselineCosts.map((c) => `$${c.toFixed(6)}`).join(", ")}`);
  console.log(`  Baseline avg: $${baselineAvg.toFixed(6)}\n`);

  // Phase 2: Optimized measurement (5 cycles with optimization)
  console.log("Phase 2: Optimized measurement (5 cycles with MAX_THINKING_TOKENS=10000)\n");
  const optimizedStartTime = new Date().toISOString();

  // Create 5 optimized test tasks
  for (let i = 0; i < 5; i++) {
    const proc = Bun.spawn(
      ["bash", "bin/arc", "tasks", "add", "--subject", `Test: Quick status analysis (optimized ${i + 1})`, "--priority", "5"],
      { cwd: ROOT }
    );
    await proc.exited;
  }

  for (let i = 0; i < 5; i++) {
    console.log(`  Running optimized cycle ${i + 1}/5...`);
    const env = { ...process.env, TEST_TOKEN_OPTIMIZATION: "true" };
    const proc = Bun.spawn(["bash", "bin/arc", "run"], { cwd: ROOT, env });
    await proc.exited;
    await sleep(2000); // Wait for DB to settle
  }

  const optimizedCycles = getCyclesSince(optimizedStartTime);
  const optimizedData = optimizedCycles.slice(0, 5);
  const optimizedCosts = optimizedData
    .map((c) => c.cost_usd ?? 0)
    .filter((cost) => cost > 0);
  const optimizedAvg = optimizedCosts.length > 0 ? optimizedCosts.reduce((a, b) => a + b) / optimizedCosts.length : 0;

  console.log(`  Optimized cycles completed: ${optimizedData.length}`);
  console.log(`  Optimized costs: ${optimizedCosts.map((c) => `$${c.toFixed(6)}`).join(", ")}`);
  console.log(`  Optimized avg: $${optimizedAvg.toFixed(6)}\n`);

  // Phase 3: Analysis
  console.log("=== RESULTS ===\n");
  const reduction = ((baselineAvg - optimizedAvg) / baselineAvg) * 100;
  const reductionAmount = baselineAvg - optimizedAvg;

  console.log(`Baseline avg cost/cycle:  $${baselineAvg.toFixed(6)}`);
  console.log(`Optimized avg cost/cycle: $${optimizedAvg.toFixed(6)}`);
  console.log(`Cost reduction:           $${reductionAmount.toFixed(6)} (${reduction.toFixed(1)}%)`);
  console.log(`\nSuccess criteria:         ≥40% reduction`);
  console.log(`Test result:              ${reduction >= 40 ? "✓ PASS" : "✗ FAIL"}\n`);

  // Detailed breakdown
  console.log("Detailed breakdown:");
  console.log("\nBaseline cycles:");
  baselineData.forEach((c, i) => {
    const task = getTaskById(c.task_id ?? 0);
    console.log(
      `  ${i + 1}. Task #${c.task_id}: ${task?.subject ?? "unknown"} — $${(c.cost_usd ?? 0).toFixed(6)} (${c.duration_ms ?? 0}ms)`
    );
  });

  console.log("\nOptimized cycles:");
  optimizedData.forEach((c, i) => {
    const task = getTaskById(c.task_id ?? 0);
    console.log(
      `  ${i + 1}. Task #${c.task_id}: ${task?.subject ?? "unknown"} — $${(c.cost_usd ?? 0).toFixed(6)} (${c.duration_ms ?? 0}ms)`
    );
  });

  console.log("\n=== END ===\n");
  db.close();
}

main().catch(console.error);
