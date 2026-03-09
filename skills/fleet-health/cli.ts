#!/usr/bin/env bun

/**
 * fleet-health CLI
 *
 * Print current health status of all fleet VMs.
 */

import { getCredential } from "../../src/credentials.ts";

// ---- Fleet config (mirrors arc-remote-setup) ----

interface AgentConfig {
  ip: string;
  hostname: string;
}

const AGENTS: Record<string, AgentConfig> = {
  spark: { ip: "192.168.1.12", hostname: "spark" },
  iris: { ip: "192.168.1.13", hostname: "iris" },
  loom: { ip: "192.168.1.14", hostname: "loom" },
  forge: { ip: "192.168.1.15", hostname: "forge" },
};

const SSH_USER = "dev";
const REMOTE_ARC_DIR = "/home/dev/arc-starter";

// ---- SSH helper ----

interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  return AGENTS[agent].ip;
}

async function ssh(ip: string, password: string, command: string): Promise<SshResult> {
  const proc = Bun.spawn(
    [
      "sshpass", "-e", "ssh",
      "-o", "StrictHostKeyChecking=no",
      "-o", "ConnectTimeout=10",
      "-o", "BatchMode=no",
      `${SSH_USER}@${ip}`,
      command,
    ],
    {
      env: { ...process.env, SSHPASS: password },
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { ok: exitCode === 0, stdout, stderr, exitCode };
}

// ---- Status command ----

async function cmdStatus(): Promise<void> {
  const password = await getCredential("vm-fleet", "ssh-password");
  if (!password) {
    process.stderr.write("Error: SSH password not set. Run: arc creds set --service vm-fleet --key ssh-password --value <pw>\n");
    process.exit(1);
  }

  process.stdout.write("Fleet Health Status\n");
  process.stdout.write("=".repeat(70) + "\n\n");

  for (const [agent, config] of Object.entries(AGENTS)) {
    const ip = await getAgentIp(agent);
    process.stdout.write(`${agent} (${ip})\n`);
    process.stdout.write("-".repeat(40) + "\n");

    // Connectivity
    const ping = await ssh(ip, password, "echo ok");
    if (!ping.ok) {
      process.stdout.write("  Status: UNREACHABLE\n\n");
      continue;
    }

    // Service timers
    const sensorResult = await ssh(ip, password, "systemctl --user is-active arc-sensors.timer 2>/dev/null || echo inactive");
    const dispatchResult = await ssh(ip, password, "systemctl --user is-active arc-dispatch.timer 2>/dev/null || echo inactive");
    const sensorStatus = sensorResult.stdout.trim();
    const dispatchStatus = dispatchResult.stdout.trim();

    process.stdout.write(`  Sensor timer:   ${sensorStatus}\n`);
    process.stdout.write(`  Dispatch timer: ${dispatchStatus}\n`);

    // Last dispatch
    const cycleResult = await ssh(
      ip, password,
      `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun -e "
        const { Database } = require('bun:sqlite');
        const db = new Database('db/arc.sqlite', { readonly: true });
        const row = db.query('SELECT completed_at, started_at FROM cycle_log ORDER BY id DESC LIMIT 1').get();
        if (!row) {
          console.log('no cycles');
        } else if (!row.completed_at) {
          const age = Date.now() - new Date(row.started_at).getTime();
          const mins = Math.round(age / 60000);
          console.log('active ' + mins + 'm (running)');
        } else {
          const age = Date.now() - new Date(row.completed_at).getTime();
          const mins = Math.round(age / 60000);
          console.log(mins + 'm ago (' + row.completed_at + ')');
        }
        db.close();
      " 2>/dev/null || echo "query failed"`
    );
    process.stdout.write(`  Last dispatch:  ${cycleResult.stdout.trim()}\n`);

    // Disk usage
    const diskResult = await ssh(ip, password, "df -h / | awk 'NR==2 {print $5 \" used (\" $3 \"/\" $2 \")\"}'");
    process.stdout.write(`  Disk:           ${diskResult.stdout.trim()}\n`);

    // Uptime
    const uptimeResult = await ssh(ip, password, "uptime -p");
    process.stdout.write(`  Uptime:         ${uptimeResult.stdout.trim()}\n`);

    // Auth method: check for API key in .env first, then fall back to OAuth
    const apiKeyCheck = await ssh(ip, password, `grep -q '^ANTHROPIC_API_KEY=' ${REMOTE_ARC_DIR}/.env 2>/dev/null && echo "present" || echo "absent"`);
    if (apiKeyCheck.stdout.trim() === "present") {
      process.stdout.write(`  Auth:           API key (in .env)\n`);
    } else {
      const oauthResult = await ssh(ip, password, `cat ~/.claude/.credentials.json 2>/dev/null || echo "{}"`);
      try {
        const creds = JSON.parse(oauthResult.stdout);
        const expiresAt = creds?.claudeAiOauth?.expiresAt;
        if (typeof expiresAt === "number") {
          const remaining = expiresAt - Date.now();
          if (remaining <= 0) {
            process.stdout.write(`  Auth:           OAuth EXPIRED — migrate to API key\n`);
          } else {
            const hours = Math.round(remaining / 3600000 * 10) / 10;
            process.stdout.write(`  Auth:           OAuth (expires in ${hours}h) — migrate to API key\n`);
          }
        } else if (creds?.claudeAiOauth?.accessToken) {
          process.stdout.write(`  Auth:           OAuth (no expiry) — migrate to API key\n`);
        } else {
          process.stdout.write(`  Auth:           NONE — set ANTHROPIC_API_KEY in .env\n`);
        }
      } catch {
        process.stdout.write(`  Auth:           NONE — set ANTHROPIC_API_KEY in .env\n`);
      }
    }

    // Peer self-reported status (fleet-status.json)
    const statusResult = await ssh(ip, password, `cat ${REMOTE_ARC_DIR}/memory/fleet-status.json 2>/dev/null`);
    if (statusResult.ok && statusResult.stdout.trim()) {
      try {
        const ps = JSON.parse(statusResult.stdout);
        const ageMs = ps.updated_at ? Date.now() - new Date(ps.updated_at).getTime() : 0;
        const ageMins = Math.round(ageMs / 60000);
        const stale = ageMins > 30 ? " **STALE**" : "";
        process.stdout.write(`  Self-report:    updated ${ageMins}m ago${stale}\n`);
        if (ps.last_task) {
          process.stdout.write(`  Current task:   #${ps.last_task.id} (P${ps.last_task.priority}) ${ps.last_task.subject}\n`);
        }
        if (ps.last_cycle) {
          process.stdout.write(`  Last cycle:     $${ps.last_cycle.cost_usd.toFixed(3)} / ${Math.round(ps.last_cycle.duration_ms / 1000)}s\n`);
        }
      } catch {
        process.stdout.write(`  Self-report:    (parse error)\n`);
      }
    } else {
      process.stdout.write(`  Self-report:    not available\n`);
    }

    process.stdout.write("\n");
  }
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`fleet-health — Monitor agent fleet VMs

Usage:
  arc skills run --name fleet-health -- <command>

Commands:
  status    Print current health status of all fleet VMs

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "status":
      await cmdStatus();
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
