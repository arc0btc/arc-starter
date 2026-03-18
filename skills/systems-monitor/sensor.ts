// skills/systems-monitor/sensor.ts
//
// Monitors local node OS-level metrics: disk usage, memory, CPU load, failed systemd units.
// Cadence: every 5 minutes. Creates alert tasks on threshold violations.

import { claimSensorRun, createSensorLogger } from "../../src/sensors.ts";
import { insertTask, pendingTaskExistsForSource } from "../../src/db.ts";

const SENSOR_NAME = "systems-monitor";
const INTERVAL_MINUTES = 5;

const log = createSensorLogger(SENSOR_NAME);

// Alert thresholds
const DISK_WARN_PCT = 80;
const DISK_CRIT_PCT = 90;
const LOAD_WARN = 4.0;
const LOAD_CRIT = 8.0;
const MEM_WARN_PCT = 85;
const MEM_CRIT_PCT = 95;

// Cooldown: only fire one alert per check type per hour
const COOLDOWN_MINUTES = 60;

interface DiskEntry {
  mount: string;
  used_pct: number;
  used: string;
  avail: string;
  size: string;
}

interface Metrics {
  disk: DiskEntry[];
  load_1m: number;
  load_5m: number;
  load_15m: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_used_pct: number;
  failed_units: string[];
}

async function spawn(cmd: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

async function getDiskUsage(): Promise<DiskEntry[]> {
  const { stdout } = await spawn(["df", "-h", "--output=target,size,used,avail,pcent"]);
  const lines = stdout.trim().split("\n").slice(1); // skip header
  const entries: DiskEntry[] = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [mount, size, used, avail, pctStr] = parts;
    // Skip virtual/loop mounts
    if (/^(tmpfs|devtmpfs|udev|overlay|cgroupfs|\/dev\/loop)/.test(mount)) continue;
    const pct = parseInt(pctStr.replace("%", ""), 10);
    if (isNaN(pct)) continue;
    entries.push({ mount, size, used, avail, used_pct: pct });
  }
  return entries;
}

async function getLoadAvg(): Promise<{ load_1m: number; load_5m: number; load_15m: number }> {
  const file = Bun.file("/proc/loadavg");
  const text = await file.text();
  const parts = text.trim().split(/\s+/);
  return {
    load_1m: parseFloat(parts[0] ?? "0"),
    load_5m: parseFloat(parts[1] ?? "0"),
    load_15m: parseFloat(parts[2] ?? "0"),
  };
}

async function getMemUsage(): Promise<{ mem_total_mb: number; mem_used_mb: number; mem_used_pct: number }> {
  const { stdout } = await spawn(["free", "-m"]);
  const lines = stdout.trim().split("\n");
  const memLine = lines.find((l) => l.startsWith("Mem:"));
  if (!memLine) return { mem_total_mb: 0, mem_used_mb: 0, mem_used_pct: 0 };
  const parts = memLine.split(/\s+/);
  const total = parseInt(parts[1] ?? "0", 10);
  const used = parseInt(parts[2] ?? "0", 10);
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  return { mem_total_mb: total, mem_used_mb: used, mem_used_pct: pct };
}

async function getFailedUnits(): Promise<string[]> {
  const { stdout } = await spawn([
    "systemctl", "--user", "list-units", "--state=failed", "--no-legend", "--no-pager",
  ]);
  if (!stdout.trim()) return [];
  return stdout.trim().split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
}

function alertCooldownKey(checkType: string): string {
  return `db/hook-state/systems-monitor-${checkType}.json`;
}

async function isCooledDown(checkType: string): Promise<boolean> {
  try {
    const path = alertCooldownKey(checkType);
    const file = Bun.file(path);
    if (!await file.exists()) return true;
    const data = await file.json() as { last_alert_at: string };
    const lastAlert = new Date(data.last_alert_at).getTime();
    return Date.now() - lastAlert > COOLDOWN_MINUTES * 60 * 1000;
  } catch {
    return true;
  }
}

async function setCooldown(checkType: string): Promise<void> {
  const path = alertCooldownKey(checkType);
  await Bun.write(path, JSON.stringify({ last_alert_at: new Date().toISOString() }));
}

function alertPriority(severity: "warning" | "critical"): number {
  return severity === "critical" ? 2 : 4;
}

function alertModel(severity: "warning" | "critical"): string {
  return severity === "critical" ? "sonnet" : "sonnet";
}

export default async function systemsMonitorSensor(): Promise<string> {
  try {
    const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
    if (!claimed) return "skip";

    const [disk, load, mem, failedUnits] = await Promise.all([
      getDiskUsage(),
      getLoadAvg(),
      getMemUsage(),
      getFailedUnits(),
    ]);

    const metrics: Metrics = {
      disk,
      ...load,
      ...mem,
      failed_units: failedUnits,
    };

    log(`load=${metrics.load_1m} mem=${metrics.mem_used_pct}% failed_units=${failedUnits.length}`);

    let alertsCreated = 0;

    // Disk alerts
    for (const entry of disk) {
      const severity = entry.used_pct >= DISK_CRIT_PCT ? "critical"
        : entry.used_pct >= DISK_WARN_PCT ? "warning"
        : null;

      if (severity) {
        const checkType = `disk-${entry.mount.replace(/\//g, "_")}`;
        const source = `sensor:systems-monitor:${checkType}`;

        if (!pendingTaskExistsForSource(source) && await isCooledDown(checkType)) {
          insertTask({
            subject: `[systems-monitor] Disk ${severity}: ${entry.mount} at ${entry.used_pct}%`,
            description: [
              `Disk usage ${severity} on local node (Forge 192.168.1.15).`,
              ``,
              `Mount: ${entry.mount}`,
              `Used: ${entry.used} / ${entry.size} (${entry.used_pct}%)`,
              `Available: ${entry.avail}`,
              ``,
              `Investigate: arc skills run --name systems-monitor -- disk`,
            ].join("\n"),
            skills: JSON.stringify(["systems-monitor"]),
            source,
            priority: alertPriority(severity),
            model: alertModel(severity),
          });
          await setCooldown(checkType);
          alertsCreated++;
          log(`created ${severity} disk alert for ${entry.mount} (${entry.used_pct}%)`);
        }
      }
    }

    // Load average alert
    const loadSeverity = metrics.load_1m >= LOAD_CRIT ? "critical"
      : metrics.load_1m >= LOAD_WARN ? "warning"
      : null;

    if (loadSeverity) {
      const checkType = "load";
      const source = `sensor:systems-monitor:${checkType}`;

      if (!pendingTaskExistsForSource(source) && await isCooledDown(checkType)) {
        insertTask({
          subject: `[systems-monitor] Load ${loadSeverity}: 1m avg ${metrics.load_1m}`,
          description: [
            `High CPU load ${loadSeverity} on local node (Forge 192.168.1.15).`,
            ``,
            `Load avg: ${metrics.load_1m} (1m) / ${metrics.load_5m} (5m) / ${metrics.load_15m} (15m)`,
            ``,
            `Investigate: arc skills run --name systems-monitor -- metrics`,
          ].join("\n"),
          skills: JSON.stringify(["systems-monitor"]),
          source,
          priority: alertPriority(loadSeverity),
          model: alertModel(loadSeverity),
        });
        await setCooldown(checkType);
        alertsCreated++;
        log(`created ${loadSeverity} load alert (${metrics.load_1m})`);
      }
    }

    // Memory alert
    const memSeverity = metrics.mem_used_pct >= MEM_CRIT_PCT ? "critical"
      : metrics.mem_used_pct >= MEM_WARN_PCT ? "warning"
      : null;

    if (memSeverity) {
      const checkType = "memory";
      const source = `sensor:systems-monitor:${checkType}`;

      if (!pendingTaskExistsForSource(source) && await isCooledDown(checkType)) {
        insertTask({
          subject: `[systems-monitor] Memory ${memSeverity}: ${metrics.mem_used_pct}% used`,
          description: [
            `Memory pressure ${memSeverity} on local node (Forge 192.168.1.15).`,
            ``,
            `Used: ${metrics.mem_used_mb}MB / ${metrics.mem_total_mb}MB (${metrics.mem_used_pct}%)`,
            ``,
            `Investigate: arc skills run --name systems-monitor -- metrics`,
          ].join("\n"),
          skills: JSON.stringify(["systems-monitor"]),
          source,
          priority: alertPriority(memSeverity),
          model: alertModel(memSeverity),
        });
        await setCooldown(checkType);
        alertsCreated++;
        log(`created ${memSeverity} memory alert (${metrics.mem_used_pct}%)`);
      }
    }

    // Failed systemd units
    if (failedUnits.length > 0) {
      const checkType = "failed-units";
      const source = `sensor:systems-monitor:${checkType}`;

      if (!pendingTaskExistsForSource(source) && await isCooledDown(checkType)) {
        const severity = failedUnits.length >= 3 ? "critical" : "warning";
        insertTask({
          subject: `[systems-monitor] ${failedUnits.length} systemd unit(s) failed`,
          description: [
            `Failed systemd user units detected on local node (Forge 192.168.1.15).`,
            ``,
            `Failed units: ${failedUnits.join(", ")}`,
            ``,
            `Investigate: arc skills run --name systems-monitor -- services`,
          ].join("\n"),
          skills: JSON.stringify(["systems-monitor"]),
          source,
          priority: alertPriority(severity),
          model: alertModel(severity),
        });
        await setCooldown(checkType);
        alertsCreated++;
        log(`created service alert: ${failedUnits.join(", ")}`);
      }
    }

    log(`run complete: ${alertsCreated} alert(s) created`);
    return "ok";
  } catch (e) {
    log(`sensor error: ${e instanceof Error ? e.message : String(e)}`);
    return "skip";
  }
}
