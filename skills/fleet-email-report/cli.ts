#!/usr/bin/env bun
// skills/fleet-email-report/cli.ts
// Generate and send formatted fleet status email reports.
// Usage: arc skills run --name fleet-email-report -- send --to <email> --type status
//        arc skills run --name fleet-email-report -- preview --type status

import { Database } from "bun:sqlite";
import { getCredential } from "../../src/credentials.ts";

// ---- Config ----

const REMOTE_ARC_DIR = "/home/dev/arc-starter";
const SSH_USER = "dev";
const BUDGET: Record<string, number> = {
  arc: 80,
  spark: 30,
  iris: 30,
  loom: 30,
  forge: 30,
};
const PEER_AGENTS: Record<string, string> = {
  spark: "192.168.1.12",
  iris: "192.168.1.13",
  loom: "192.168.1.14",
  forge: "192.168.1.15",
};

// ---- Types ----

interface AgentReport {
  name: string;
  reachable: boolean;
  lastDispatchMins: number | null;
  diskUsed: string | null;
  taskSubject: string | null;
  taskId: number | null;
  taskPriority: number | null;
  selfReportAgeMins: number | null;
  completedToday: number;
  failedToday: number;
  pendingNow: number;
  activeNow: number;
  blockedNow: number;
  costToday: number;
}

// ---- Helpers ----

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      flags[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return flags;
}

async function ssh(ip: string, password: string, command: string): Promise<{ ok: boolean; stdout: string }> {
  const proc = Bun.spawn(
    ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=8", "-o", "BatchMode=no", `${SSH_USER}@${ip}`, command],
    { env: { ...process.env, SSHPASS: password }, stdout: "pipe", stderr: "pipe" }
  );
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function fmtAge(mins: number | null): string {
  if (mins === null) return "unknown";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h${mins % 60}m ago`;
}

// ---- Self data (local DB) ----

async function getSelfReport(): Promise<AgentReport> {
  const db = new Database("db/arc.sqlite", { readonly: true });
  try {
    const today = new Date().toISOString().slice(0, 10);

    const completedToday = (db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM tasks WHERE status='completed' AND date(completed_at)=date('now')`
    ).get()?.n ?? 0);

    const failedToday = (db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM tasks WHERE status='failed' AND date(completed_at)=date('now')`
    ).get()?.n ?? 0);

    const pendingNow = (db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM tasks WHERE status='pending'`
    ).get()?.n ?? 0);

    const activeNow = (db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM tasks WHERE status='active'`
    ).get()?.n ?? 0);

    const blockedNow = (db.query<{ n: number }, []>(
      `SELECT COUNT(*) as n FROM tasks WHERE status='blocked'`
    ).get()?.n ?? 0);

    const costToday = (db.query<{ total: number }, []>(
      `SELECT COALESCE(SUM(cost_usd), 0) as total FROM cycle_log WHERE date(started_at)=date('now')`
    ).get()?.total ?? 0);

    const lastCycle = db.query<{ completed_at: string }, []>(
      `SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1`
    ).get();
    const lastDispatchMins = lastCycle?.completed_at
      ? Math.round((Date.now() - new Date(lastCycle.completed_at).getTime()) / 60000)
      : null;

    // Read fleet-status.json for current task info
    let taskSubject: string | null = null;
    let taskId: number | null = null;
    let taskPriority: number | null = null;
    let selfReportAgeMins: number | null = null;

    try {
      const statusFile = Bun.file("memory/fleet-status.json");
      if (await statusFile.exists()) {
        const status = await statusFile.json();
        if (status.updated_at) {
          selfReportAgeMins = Math.round((Date.now() - new Date(status.updated_at).getTime()) / 60000);
        }
        if (status.last_task) {
          taskId = status.last_task.id;
          taskPriority = status.last_task.priority;
          taskSubject = status.last_task.subject;
        }
      }
    } catch {
      // fleet-status.json missing or malformed — skip
    }

    // Disk usage
    const diskProc = Bun.spawn(["df", "-h", "/"], { stdout: "pipe", stderr: "pipe" });
    const diskOut = await new Response(diskProc.stdout).text();
    const diskLine = diskOut.split("\n")[1] ?? "";
    const diskUsed = diskLine.split(/\s+/)[4] ?? null;

    return {
      name: "arc",
      reachable: true,
      lastDispatchMins,
      diskUsed,
      taskSubject,
      taskId,
      taskPriority,
      selfReportAgeMins,
      completedToday,
      failedToday,
      pendingNow,
      activeNow,
      blockedNow,
      costToday,
    };
  } finally {
    db.close();
  }
}

// ---- Peer data (SSH) ----

async function getPeerReport(agent: string, ip: string, password: string): Promise<AgentReport> {
  const ping = await ssh(ip, password, "echo ok");
  if (!ping.ok) {
    return { name: agent, reachable: false, lastDispatchMins: null, diskUsed: null, taskSubject: null, taskId: null, taskPriority: null, selfReportAgeMins: null, completedToday: 0, failedToday: 0, pendingNow: 0, activeNow: 0, blockedNow: 0, costToday: 0 };
  }

  // Batch the expensive DB query
  const dbScript = `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
    const { Database } = await import('bun:sqlite');
    const db = new Database('db/arc.sqlite', { readonly: true });
    const ct = db.query('SELECT COUNT(*) as n FROM tasks WHERE status=\\'completed\\' AND date(completed_at)=date(\\'now\\')').get().n;
    const ft = db.query('SELECT COUNT(*) as n FROM tasks WHERE status=\\'failed\\' AND date(completed_at)=date(\\'now\\')').get().n;
    const pn = db.query('SELECT COUNT(*) as n FROM tasks WHERE status=\\'pending\\'').get().n;
    const an = db.query('SELECT COUNT(*) as n FROM tasks WHERE status=\\'active\\'').get().n;
    const bn = db.query('SELECT COUNT(*) as n FROM tasks WHERE status=\\'blocked\\'').get().n;
    const cost = db.query('SELECT COALESCE(SUM(cost_usd),0) as total FROM cycle_log WHERE date(started_at)=date(\\'now\\')').get().total;
    const lc = db.query('SELECT completed_at FROM cycle_log ORDER BY id DESC LIMIT 1').get();
    db.close();
    const age = lc?.completed_at ? Math.round((Date.now() - new Date(lc.completed_at).getTime()) / 60000) : null;
    console.log(JSON.stringify({ct,ft,pn,an,bn,cost,age}));
  " 2>/dev/null`;

  const [dbRes, diskRes, statusRes] = await Promise.all([
    ssh(ip, password, dbScript),
    ssh(ip, password, "df -h / | awk 'NR==2 {print $5}'"),
    ssh(ip, password, `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null`),
  ]);

  let completedToday = 0, failedToday = 0, pendingNow = 0, activeNow = 0, blockedNow = 0;
  let costToday = 0, lastDispatchMins: number | null = null;

  if (dbRes.ok) {
    try {
      const d = JSON.parse(dbRes.stdout.trim());
      completedToday = d.ct ?? 0;
      failedToday = d.ft ?? 0;
      pendingNow = d.pn ?? 0;
      activeNow = d.an ?? 0;
      blockedNow = d.bn ?? 0;
      costToday = d.cost ?? 0;
      lastDispatchMins = d.age ?? null;
    } catch { /* parse failed */ }
  }

  let taskSubject: string | null = null;
  let taskId: number | null = null;
  let taskPriority: number | null = null;
  let selfReportAgeMins: number | null = null;

  if (statusRes.ok && statusRes.stdout.trim()) {
    try {
      const ps = JSON.parse(statusRes.stdout.trim());
      if (ps.updated_at) selfReportAgeMins = Math.round((Date.now() - new Date(ps.updated_at).getTime()) / 60000);
      if (ps.last_task) { taskId = ps.last_task.id; taskPriority = ps.last_task.priority; taskSubject = ps.last_task.subject; }
    } catch { /* ignore */ }
  }

  return {
    name: agent,
    reachable: true,
    lastDispatchMins,
    diskUsed: diskRes.stdout.trim() || null,
    taskSubject,
    taskId,
    taskPriority,
    selfReportAgeMins,
    completedToday,
    failedToday,
    pendingNow,
    activeNow,
    blockedNow,
    costToday,
  };
}

// ---- Report builder ----

function buildReport(agents: AgentReport[]): string {
  const now = new Date();
  const ts = now.toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const lines: string[] = [];

  lines.push(`Fleet Status Report — ${ts}`);
  lines.push("Generated by arc (arc0.btc)");
  lines.push("");

  // Agent health table
  lines.push("=== AGENT HEALTH ===");
  lines.push("");
  lines.push(`${pad("Agent", 8)} ${pad("Reachable", 10)} ${pad("Last Dispatch", 16)} ${pad("Disk", 8)} Current Task`);
  lines.push("-".repeat(80));

  for (const a of agents) {
    if (!a.reachable) {
      lines.push(`${pad(a.name, 8)} UNREACHABLE`);
      continue;
    }
    const dispatchAge = a.lastDispatchMins !== null ? fmtAge(a.lastDispatchMins) + (a.lastDispatchMins > 60 ? " **STALE**" : "") : "unknown";
    const task = a.taskId ? `#${a.taskId} (P${a.taskPriority}) ${(a.taskSubject ?? "").slice(0, 40)}` : "idle";
    lines.push(`${pad(a.name, 8)} ${pad("ok", 10)} ${pad(dispatchAge, 16)} ${pad(a.diskUsed ?? "?", 8)} ${task}`);
  }

  lines.push("");

  // Task throughput
  lines.push("=== TASK THROUGHPUT (TODAY) ===");
  lines.push("");
  const reachable = agents.filter((a) => a.reachable);
  for (const a of reachable) {
    lines.push(`  ${pad(a.name + ":", 8)} ${a.completedToday} completed / ${a.failedToday} failed / ${a.pendingNow} pending / ${a.activeNow} active`);
  }
  const totalCompleted = reachable.reduce((s, a) => s + a.completedToday, 0);
  const totalFailed = reachable.reduce((s, a) => s + a.failedToday, 0);
  const totalPending = reachable.reduce((s, a) => s + a.pendingNow, 0);
  lines.push(`  ${"fleet:".padEnd(8)} ${totalCompleted} completed / ${totalFailed} failed / ${totalPending} pending`);
  lines.push("");

  // Cost summary
  lines.push("=== COST SUMMARY ===");
  lines.push("");
  let totalCost = 0;
  let totalBudget = 0;
  for (const a of agents) {
    const budget = BUDGET[a.name] ?? 30;
    const pct = budget > 0 ? Math.round((a.costToday / budget) * 100) : 0;
    const warn = pct >= 90 ? " **ALERT**" : pct >= 75 ? " (watch)" : "";
    lines.push(`  ${pad(a.name + ":", 8)} $${a.costToday.toFixed(2)} today (budget: $${budget})${warn}`);
    totalCost += a.costToday;
    totalBudget += budget;
  }
  const fleetPct = totalBudget > 0 ? Math.round((totalCost / totalBudget) * 100) : 0;
  lines.push(`  ${"fleet:".padEnd(8)} $${totalCost.toFixed(2)} / $${totalBudget} total budget (${fleetPct}%)`);
  lines.push("");

  // Alerts
  const alerts: string[] = [];
  for (const a of agents) {
    if (!a.reachable) alerts.push(`${a.name} is UNREACHABLE`);
    if (a.reachable && a.lastDispatchMins !== null && a.lastDispatchMins > 60) alerts.push(`${a.name} last dispatch was ${fmtAge(a.lastDispatchMins)} — may be stalled`);
    if (a.blockedNow > 0) alerts.push(`${a.name} has ${a.blockedNow} blocked task(s)`);
    const budget = BUDGET[a.name] ?? 30;
    if (a.costToday / budget >= 0.9) alerts.push(`${a.name} at ${Math.round((a.costToday / budget) * 100)}% of daily budget ($${a.costToday.toFixed(2)} / $${budget})`);
  }

  if (alerts.length > 0) {
    lines.push("=== ALERTS ===");
    lines.push("");
    for (const alert of alerts) lines.push(`  • ${alert}`);
    lines.push("");
  }

  lines.push("---");
  lines.push(`arc fleet-email-report | ${ts}`);

  return lines.join("\n");
}

// ---- Commands ----

async function collectReports(): Promise<AgentReport[]> {
  const selfReport = await getSelfReport();
  const password = await getCredential("vm-fleet", "ssh-password");

  const peerReports: AgentReport[] = [];
  if (password) {
    const peerEntries = Object.entries(PEER_AGENTS);
    const results = await Promise.allSettled(
      peerEntries.map(async ([agent, defaultIp]) => {
        const ip = await getCredential("vm-fleet", `${agent}-ip`) ?? defaultIp;
        return getPeerReport(agent, ip, password);
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") peerReports.push(r.value);
    }
  } else {
    // No SSH password — mark peers as unreachable
    for (const agent of Object.keys(PEER_AGENTS)) {
      peerReports.push({ name: agent, reachable: false, lastDispatchMins: null, diskUsed: null, taskSubject: null, taskId: null, taskPriority: null, selfReportAgeMins: null, completedToday: 0, failedToday: 0, pendingNow: 0, activeNow: 0, blockedNow: 0, costToday: 0 });
    }
  }

  return [selfReport, ...peerReports];
}

async function cmdPreview(_args: string[]): Promise<void> {
  const agents = await collectReports();
  const report = buildReport(agents);
  console.log(report);
}

async function cmdSend(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.to) {
    process.stderr.write("Usage: arc skills run --name fleet-email-report -- send --to <email> --type status\n");
    process.exit(1);
  }

  const reportType = flags.type ?? "status";
  if (reportType !== "status") {
    process.stderr.write(`Error: unknown report type '${reportType}'. Supported: status\n`);
    process.exit(1);
  }

  const apiBaseUrl = await getCredential("arc-email-sync", "api_base_url");
  const adminKey = await getCredential("arc-email-sync", "admin_api_key");

  if (!apiBaseUrl || !adminKey) {
    process.stderr.write("Error: email credentials not set.\n");
    process.stderr.write("  arc creds set --service arc-email-sync --key api_base_url --value <url>\n");
    process.stderr.write("  arc creds set --service arc-email-sync --key admin_api_key --value <key>\n");
    process.exit(1);
  }

  console.log(`[fleet-email-report] collecting fleet data...`);
  const agents = await collectReports();
  const body = buildReport(agents);

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const subject = `Arc Fleet Status — ${dateStr}`;

  console.log(`[fleet-email-report] sending to ${flags.to}: "${subject}"`);

  const response = await fetch(`${apiBaseUrl}/api/send`, {
    method: "POST",
    headers: { "X-Admin-Key": adminKey, "Content-Type": "application/json" },
    body: JSON.stringify({ to: flags.to, subject, body }),
  });

  const result = await response.json();

  if (!response.ok) {
    console.error(`[fleet-email-report] send failed: HTTP ${response.status}`);
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log(`[fleet-email-report] sent successfully`);
  console.log(JSON.stringify({ success: true, to: flags.to, subject, ...result }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`fleet-email-report — Generate and send fleet status email reports

Usage:
  arc skills run --name fleet-email-report -- <command> [flags]

Commands:
  send     --to <email> [--type status]   Send fleet status report via email
  preview  [--type status]                Print report to stdout without sending

Supported report types:
  status   Full fleet health + task throughput + cost summary + alerts

Examples:
  arc skills run --name fleet-email-report -- send --to whoabuddy@gmail.com --type status
  arc skills run --name fleet-email-report -- preview
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "send":
      await cmdSend(args.slice(1));
      break;
    case "preview":
      await cmdPreview(args.slice(1));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printUsage();
      break;
    default:
      process.stderr.write(`Error: unknown subcommand '${sub}'\n\n`);
      printUsage();
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
