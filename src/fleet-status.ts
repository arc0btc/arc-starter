/**
 * Fleet status writer — advertises local state for peer agents to read via SSH.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { hostname, uptime as osUptime } from "node:os";
import { join } from "node:path";
import type { Task } from "./db.ts";
import { log } from "./utils.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const FLEET_STATUS_FILE = join(ROOT, "memory", "fleet-status.json");

function getDiskStats(): { diskTotalBytes: number; diskAvailBytes: number } {
  const diskResult = Bun.spawnSync(["df", "-B1", "--output=size,avail", ROOT]);
  const dfLines = diskResult.stdout.toString().trim().split("\n");
  let diskTotalBytes = 0;
  let diskAvailBytes = 0;
  if (dfLines.length >= 2) {
    const parts = dfLines[1].trim().split(/\s+/);
    diskTotalBytes = parseInt(parts[0] ?? "0", 10);
    diskAvailBytes = parseInt(parts[1] ?? "0", 10);
  }
  return { diskTotalBytes, diskAvailBytes };
}

/** Write fleet-status.json after a completed dispatch cycle. */
export function writeFleetStatus(task: Task, durationMs: number, costUsd: number): void {
  try {
    const { diskTotalBytes, diskAvailBytes } = getDiskStats();

    const status = {
      agent: hostname() || "arc",
      updated_at: new Date().toISOString(),
      idle: false,
      idle_since: null as string | null,
      last_task: {
        id: task.id,
        subject: task.subject,
        status: task.status,
        priority: task.priority,
      },
      last_cycle: {
        duration_ms: durationMs,
        cost_usd: costUsd,
      },
      health: {
        uptime_seconds: Math.floor(osUptime()),
        disk_total_bytes: diskTotalBytes,
        disk_avail_bytes: diskAvailBytes,
      },
    };

    writeFileSync(FLEET_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch (err) {
    log(`dispatch: failed to write fleet-status.json — ${err}`);
  }
}

/** Write fleet-status.json with idle=true when no pending tasks. Preserves last_task from previous state. */
export function writeFleetStatusIdle(): void {
  try {
    let existing: Record<string, unknown> = {};
    try {
      existing = JSON.parse(readFileSync(FLEET_STATUS_FILE, "utf-8"));
    } catch {
      // no existing file — fine
    }

    const { diskTotalBytes, diskAvailBytes } = getDiskStats();

    const now = new Date().toISOString();
    const previousIdleSince = existing.idle && typeof existing.idle_since === "string"
      ? existing.idle_since
      : now;

    const status = {
      agent: hostname() || "arc",
      updated_at: now,
      idle: true,
      idle_since: previousIdleSince,
      last_task: existing.last_task ?? null,
      last_cycle: existing.last_cycle ?? null,
      health: {
        uptime_seconds: Math.floor(osUptime()),
        disk_total_bytes: diskTotalBytes,
        disk_avail_bytes: diskAvailBytes,
      },
    };

    writeFileSync(FLEET_STATUS_FILE, JSON.stringify(status, null, 2) + "\n");
  } catch (err) {
    log(`dispatch: failed to write idle fleet-status.json — ${err}`);
  }
}
