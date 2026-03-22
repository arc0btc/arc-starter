#!/usr/bin/env bun
// skills/systems-monitor/cli.ts
// On-demand system health checks — local node or remote fleet VM via SSH.

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[key] = args[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

const FLEET: Record<string, string> = {
  arc: "192.168.1.10",
  spark: "192.168.1.12",
  iris: "192.168.1.13",
  loom: "192.168.1.14",
  forge: "192.168.1.15",
};

async function spawnLocal(command: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { stdout, stderr, code };
}

async function spawnSsh(host: string, remoteCmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const sshPass = process.env.SSH_PASSWORD ?? "";
  const sshArgs = [
    "ssh",
    "-o", "StrictHostKeyChecking=no",
    "-o", "ConnectTimeout=10",
    "-o", "BatchMode=yes",
    `dev@${host}`,
    remoteCmd,
  ];

  const cmd = sshPass ? ["sshpass", "-p", sshPass, ...sshArgs] : sshArgs;
  return spawnLocal(cmd);
}

function resolveHost(hostArg: string | undefined): { host: string | null; label: string } {
  if (!hostArg) return { host: null, label: "local" };
  // Accept agent name or IP
  const ip = FLEET[hostArg.toLowerCase()] ?? hostArg;
  const label = Object.entries(FLEET).find(([, v]) => v === ip)?.[0] ?? ip;
  return { host: ip, label };
}

async function run(command: string[], host: string | null): Promise<string> {
  if (host) {
    const { stdout, stderr, code } = await spawnSsh(host, command.join(" "));
    if (code !== 0) throw new Error(stderr.trim() || `SSH command failed (exit ${code})`);
    return stdout;
  }
  const { stdout, stderr, code } = await spawnLocal(command);
  if (code !== 0) throw new Error(stderr.trim() || `Command failed (exit ${code})`);
  return stdout;
}

async function cmdDisk(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const { host, label } = resolveHost(typeof flags["host"] === "string" ? flags["host"] : undefined);

  const stdout = await run(["df", "-h", "--output=target,size,used,avail,pcent"], host);
  const lines = stdout.trim().split("\n").slice(1);
  const entries = [];

  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [mount, size, used, avail, pctStr] = parts;
    if (/^(tmpfs|devtmpfs|udev|overlay|cgroupfs|\/dev\/loop)/.test(mount)) continue;
    const pct = parseInt(pctStr.replace("%", ""), 10);
    if (isNaN(pct)) continue;
    const status = pct >= 90 ? "critical" : pct >= 80 ? "warning" : "ok";
    entries.push({ mount, size, used, avail, used_pct: pct, status });
  }

  console.log(JSON.stringify({ node: label, disk: entries }, null, 2));
}

async function cmdMetrics(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const { host, label } = resolveHost(typeof flags["host"] === "string" ? flags["host"] : undefined);

  const [loadRaw, memRaw] = await Promise.all([
    run(["cat", "/proc/loadavg"], host),
    run(["free", "-m"], host),
  ]);

  const loadParts = loadRaw.trim().split(/\s+/);
  const load_1m = parseFloat(loadParts[0] ?? "0");
  const load_5m = parseFloat(loadParts[1] ?? "0");
  const load_15m = parseFloat(loadParts[2] ?? "0");

  const memLine = memRaw.split("\n").find((l) => l.startsWith("Mem:")) ?? "";
  const memParts = memLine.split(/\s+/);
  const mem_total_mb = parseInt(memParts[1] ?? "0", 10);
  const mem_used_mb = parseInt(memParts[2] ?? "0", 10);
  const mem_used_pct = mem_total_mb > 0 ? Math.round((mem_used_mb / mem_total_mb) * 100) : 0;

  console.log(JSON.stringify({
    node: label,
    load: {
      "1m": load_1m,
      "5m": load_5m,
      "15m": load_15m,
      status: load_1m >= 8 ? "critical" : load_1m >= 4 ? "warning" : "ok",
    },
    memory: {
      total_mb: mem_total_mb,
      used_mb: mem_used_mb,
      used_pct: mem_used_pct,
      status: mem_used_pct >= 95 ? "critical" : mem_used_pct >= 85 ? "warning" : "ok",
    },
  }, null, 2));
}

async function cmdServices(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const { host, label } = resolveHost(typeof flags["host"] === "string" ? flags["host"] : undefined);

  const stdout = await run(
    ["systemctl", "--user", "list-units", "--state=failed", "--no-legend", "--no-pager"],
    host,
  ).catch(() => "");

  const failed = stdout.trim()
    ? stdout.trim().split("\n").map((l) => l.trim().split(/\s+/)[0]).filter(Boolean)
    : [];

  console.log(JSON.stringify({
    node: label,
    failed_units: failed,
    status: failed.length >= 3 ? "critical" : failed.length > 0 ? "warning" : "ok",
  }, null, 2));
}

async function cmdStatus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const hostArg = typeof flags["host"] === "string" ? flags["host"] : undefined;

  // If no host: check all fleet VMs in parallel
  if (!hostArg) {
    const entries = Object.entries(FLEET);
    const settled = await Promise.allSettled(
      entries.map(([, ip]) => spawnSsh(ip, "echo ok")),
    );
    const results = entries.map(([name], i) => {
      const s = settled[i];
      const ok = s.status === "fulfilled" && s.value.code === 0;
      return { node: name, reachable: ok, status: ok ? "ok" : "unreachable" };
    });
    console.log(JSON.stringify({ fleet_status: results }, null, 2));
    return;
  }

  const { host, label } = resolveHost(hostArg);

  // Gather all metrics for a single host
  const [diskResult, metricsResult, servicesResult] = await Promise.allSettled([
    (async () => { await cmdDisk(["--host", host ?? ""]); })(),
    (async () => { await cmdMetrics(["--host", host ?? ""]); })(),
    (async () => { await cmdServices(["--host", host ?? ""]); })(),
  ]);

  if (diskResult.status === "rejected") process.stderr.write(`disk error: ${diskResult.reason}\n`);
  if (metricsResult.status === "rejected") process.stderr.write(`metrics error: ${metricsResult.reason}\n`);
  if (servicesResult.status === "rejected") process.stderr.write(`services error: ${servicesResult.reason}\n`);
}

function printUsage(): void {
  process.stdout.write(`systems-monitor CLI

USAGE
  arc skills run --name systems-monitor -- <subcommand> [flags]

SUBCOMMANDS
  status [--host IP|agent-name]
    Full health summary. Without --host, pings all fleet VMs.

  disk [--host IP|agent-name]
    Disk usage per mount point.

  metrics [--host IP|agent-name]
    CPU load average and memory utilization.

  services [--host IP|agent-name]
    List failed systemd user units.

FLEET AGENTS
  arc=192.168.1.10  spark=192.168.1.12  iris=192.168.1.13
  loom=192.168.1.14  forge=192.168.1.15

ENVIRONMENT
  SSH_PASSWORD  SSH password for dev@<ip> (if not using key-based auth)

EXAMPLES
  arc skills run --name systems-monitor -- status
  arc skills run --name systems-monitor -- disk --host forge
  arc skills run --name systems-monitor -- metrics --host 192.168.1.10
  arc skills run --name systems-monitor -- services --host arc
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "status":
      await cmdStatus(args.slice(1));
      break;
    case "disk":
      await cmdDisk(args.slice(1));
      break;
    case "metrics":
      await cmdMetrics(args.slice(1));
      break;
    case "services":
      await cmdServices(args.slice(1));
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

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
