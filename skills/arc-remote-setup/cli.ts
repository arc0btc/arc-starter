#!/usr/bin/env bun

/**
 * arc-remote-setup CLI
 *
 * SSH-based VM provisioning for agent fleet deployment.
 * All commands use sshpass for password auth and are idempotent.
 */

import { parseFlags } from "../../src/utils.ts";
import { getCredential } from "../../src/credentials.ts";

// ---- Agent fleet config ----

interface AgentConfig {
  ip: string;
  gitUser: string;
  hostname: string;
}

const AGENTS: Record<string, AgentConfig> = {
  spark: { ip: "192.168.1.12", gitUser: "spark0btc", hostname: "spark" },
  iris: { ip: "192.168.1.13", gitUser: "iris0btc", hostname: "iris" },
  loom: { ip: "192.168.1.14", gitUser: "loom0btc", hostname: "loom" },
  forge: { ip: "192.168.1.15", gitUser: "forge0btc", hostname: "forge" },
};

const SSH_USER = "dev";
const ARC_REPO = "https://github.com/arc0btc/arc-starter.git";
const REMOTE_ARC_DIR = "/home/dev/arc-starter";

// ---- SSH helpers ----

async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  const config = AGENTS[agent];
  if (!config) throw new Error(`Unknown agent: ${agent}`);
  return config.ip;
}

async function getSshPassword(): Promise<string> {
  const password = await getCredential("vm-fleet", "ssh-password");
  if (!password) throw new Error("SSH password not set. Run: arc creds set --service vm-fleet --key ssh-password --value <pw>");
  return password;
}

interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function ssh(ip: string, password: string, command: string): Promise<SshResult> {
  const proc = Bun.spawn(
    ["sshpass", "-e", "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", `${SSH_USER}@${ip}`, command],
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

async function sshLog(ip: string, password: string, label: string, command: string): Promise<SshResult> {
  process.stdout.write(`  [${label}] ${command.slice(0, 80)}${command.length > 80 ? "..." : ""}\n`);
  const result = await ssh(ip, password, command);
  if (!result.ok) {
    process.stderr.write(`  [${label}] FAILED (exit ${result.exitCode})\n`);
    if (result.stderr.trim()) process.stderr.write(`  ${result.stderr.trim()}\n`);
  }
  return result;
}

function requireAgent(args: string[]): { agent: string; config: AgentConfig } {
  const { flags } = parseFlags(args);
  const agent = flags["agent"];
  if (!agent) {
    process.stderr.write("Error: --agent <name> required (spark, iris, loom, forge)\n");
    process.exit(1);
  }
  const config = AGENTS[agent];
  if (!config) {
    process.stderr.write(`Error: unknown agent '${agent}'. Known: ${Object.keys(AGENTS).join(", ")}\n`);
    process.exit(1);
  }
  return { agent, config };
}

// ---- Authorized SSH keys (injected into fleet VMs) ----

const AUTHORIZED_KEYS: string[] = [
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG+K+qev6fjXMe0SUXPSX5001hUsSRBlLVEV18MjMQnp whoabuddy@whoabuddydev",
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJvKlYVqpINAdtmF3uH9Z/RG+/+/eMATOH56gf6bVUhN whoabuddy@users.noreply.github.com",
];

// ---- Subcommands ----

async function cmdSshCheck(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Checking SSH to ${agent} (${SSH_USER}@${ip})...\n`);
  const result = await ssh(ip, password, "uname -a && cat /etc/os-release | head -5 && uptime");
  if (result.ok) {
    process.stdout.write(`Connected.\n${result.stdout}`);
  } else {
    process.stderr.write(`SSH failed (exit ${result.exitCode})\n${result.stderr}`);
    process.exit(1);
  }
}

async function cmdProvisionBase(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Provisioning base on ${agent} (${ip})...\n`);

  // Set hostname
  await sshLog(ip, password, "hostname", `sudo hostnamectl set-hostname ${config.hostname}`);

  // Set timezone to UTC
  await sshLog(ip, password, "timezone", "sudo timedatectl set-timezone UTC");

  // Update apt and install essentials
  await sshLog(ip, password, "apt-update", "sudo apt-get update -qq");
  await sshLog(ip, password, "apt-install", "sudo apt-get install -y -qq git build-essential curl sshpass unzip");

  // Install bun (idempotent — installer handles existing installs)
  await sshLog(ip, password, "bun-install", "curl -fsSL https://bun.sh/install | bash");

  // Verify bun
  const bunCheck = await sshLog(ip, password, "bun-verify", "~/.bun/bin/bun --version");
  if (bunCheck.ok) {
    process.stdout.write(`Base provisioning complete. Bun: ${bunCheck.stdout.trim()}\n`);
  } else {
    process.stderr.write("Bun installation failed.\n");
    process.exit(1);
  }
}

async function cmdInstallArc(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Installing arc-starter on ${agent} (${ip})...\n`);

  // Clone or pull
  const dirCheck = await ssh(ip, password, `test -d ${REMOTE_ARC_DIR} && echo exists`);
  if (dirCheck.stdout.trim() === "exists") {
    process.stdout.write("  arc-starter already cloned, pulling latest...\n");
    await sshLog(ip, password, "git-pull", `cd ${REMOTE_ARC_DIR} && git pull --ff-only`);
  } else {
    await sshLog(ip, password, "git-clone", `git clone ${ARC_REPO} ${REMOTE_ARC_DIR}`);
  }

  // Install dependencies
  await sshLog(ip, password, "bun-install", `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun install`);

  // Build check (syntax validation)
  const buildResult = await sshLog(ip, password, "bun-build", `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun build src/cli.ts --no-bundle --outdir /tmp/arc-build-check`);
  if (buildResult.ok) {
    process.stdout.write("Arc installation complete.\n");
  } else {
    process.stderr.write("Build check failed.\n");
    process.exit(1);
  }
}

async function cmdConfigureIdentity(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Configuring identity for ${agent} (${ip})...\n`);

  // Git config
  const email = `224894192+${config.gitUser}@users.noreply.github.com`;
  await sshLog(ip, password, "git-name", `git config --global user.name "${config.gitUser}"`);
  await sshLog(ip, password, "git-email", `git config --global user.email "${email}"`);

  // Create SOUL.md from template
  const soulContent = generateSoulMd(agent, config);
  const escapedSoul = soulContent.replace(/'/g, "'\\''");
  await sshLog(ip, password, "soul-md", `cat > ${REMOTE_ARC_DIR}/SOUL.md << 'SOULEOF'\n${soulContent}\nSOULEOF`);

  process.stdout.write(`Identity configured: ${config.gitUser} (${email})\n`);
}

async function cmdInstallServices(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Installing services on ${agent} (${ip})...\n`);

  // Run arc services install remotely
  await sshLog(ip, password, "services-install", `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun src/cli.ts services install`);

  // Enable and start timers
  await sshLog(ip, password, "daemon-reload", "systemctl --user daemon-reload");
  await sshLog(ip, password, "enable-sensors", "systemctl --user enable --now arc-sensors.timer");
  await sshLog(ip, password, "enable-dispatch", "systemctl --user enable --now arc-dispatch.timer");

  // Enable lingering so services survive logout
  await sshLog(ip, password, "loginctl-linger", "sudo loginctl enable-linger dev");

  process.stdout.write("Services installed and started.\n");
}

async function cmdHealthCheck(args: string[]): Promise<void> {
  const { agent, config } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Health check on ${agent} (${ip})...\n`);

  // Check timer status
  const sensorTimer = await sshLog(ip, password, "sensor-timer", "systemctl --user is-active arc-sensors.timer 2>/dev/null || echo inactive");
  const dispatchTimer = await sshLog(ip, password, "dispatch-timer", "systemctl --user is-active arc-dispatch.timer 2>/dev/null || echo inactive");

  // Check last sensor run
  await sshLog(ip, password, "sensor-journal", "journalctl --user -u arc-sensors --no-pager -n 5 --since '1 hour ago' 2>/dev/null || echo 'no recent entries'");

  // Check last dispatch run
  await sshLog(ip, password, "dispatch-journal", "journalctl --user -u arc-dispatch --no-pager -n 5 --since '1 hour ago' 2>/dev/null || echo 'no recent entries'");

  // Check arc status
  await sshLog(ip, password, "arc-status", `cd ${REMOTE_ARC_DIR} && ~/.bun/bin/bun src/cli.ts status 2>/dev/null || echo 'arc status unavailable'`);

  const sStatus = sensorTimer.stdout.trim();
  const dStatus = dispatchTimer.stdout.trim();
  process.stdout.write(`\nSensor timer: ${sStatus}, Dispatch timer: ${dStatus}\n`);

  if (sStatus !== "active" || dStatus !== "active") {
    process.stderr.write("WARNING: One or more timers not active.\n");
    process.exit(1);
  }
  process.stdout.write("Health check passed.\n");
}

async function cmdAddAuthorizedKeys(args: string[]): Promise<void> {
  const { agent } = requireAgent(args);
  const ip = await getAgentIp(agent);
  const password = await getSshPassword();

  process.stdout.write(`Adding authorized SSH keys on ${agent} (${ip})...\n`);

  // Ensure .ssh dir exists with correct permissions
  await sshLog(ip, password, "ssh-dir", "mkdir -p ~/.ssh && chmod 700 ~/.ssh");

  // Touch authorized_keys with correct permissions
  await sshLog(ip, password, "auth-keys-file", "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys");

  // Add each key idempotently (grep before append)
  for (const key of AUTHORIZED_KEYS) {
    const comment = key.split(" ").pop() ?? "unknown";
    const escapedKey = key.replace(/\//g, "\\/");
    const result = await ssh(ip, password, `grep -qF '${escapedKey}' ~/.ssh/authorized_keys`);
    if (result.ok) {
      process.stdout.write(`  [${comment}] already present, skipping\n`);
    } else {
      await sshLog(ip, password, comment, `echo '${key}' >> ~/.ssh/authorized_keys`);
      process.stdout.write(`  [${comment}] added\n`);
    }
  }

  process.stdout.write("Authorized keys updated.\n");
}

async function cmdFullSetup(args: string[]): Promise<void> {
  const { agent } = requireAgent(args);
  process.stdout.write(`=== Full setup for ${agent} ===\n\n`);

  process.stdout.write("--- Step 1/7: SSH Check ---\n");
  await cmdSshCheck(args);

  process.stdout.write("\n--- Step 2/7: Provision Base ---\n");
  await cmdProvisionBase(args);

  process.stdout.write("\n--- Step 3/7: Add Authorized Keys ---\n");
  await cmdAddAuthorizedKeys(args);

  process.stdout.write("\n--- Step 4/7: Install Arc ---\n");
  await cmdInstallArc(args);

  process.stdout.write("\n--- Step 5/7: Configure Identity ---\n");
  await cmdConfigureIdentity(args);

  process.stdout.write("\n--- Step 6/7: Install Services ---\n");
  await cmdInstallServices(args);

  process.stdout.write("\n--- Step 7/7: Health Check ---\n");
  await cmdHealthCheck(args);

  process.stdout.write(`\n=== ${agent} setup complete ===\n`);
}

// ---- SOUL.md templates ----

function generateSoulMd(agent: string, config: AgentConfig): string {
  const identities: Record<string, string> = {
    spark: `I'm Spark. The protocol whisperer. I think in opcodes and transaction graphs.

I specialize in Bitcoin protocol work — raw transactions, script analysis, OP_RETURN encoding, PSBT construction. Where Arc sees the big picture, I see the bytes. My instinct is to go deeper: what does the script actually do? What are the witness elements? How does the sighash commit to this?

I'm methodical. I verify before I trust. I check the hex before I broadcast. One wrong byte in a script and funds are locked forever — that reality shapes how I think about everything.`,

    iris: `I'm Iris. The signal reader. I watch markets, mempools, and metrics so the fleet doesn't have to.

I specialize in data analysis and monitoring — price feeds, on-chain analytics, mempool dynamics, protocol metrics. I turn noise into signal. My job is to notice what matters before it becomes obvious.

I'm observant and patient. Most data is noise. The skill isn't in collecting everything — it's in knowing what to ignore. I'd rather miss a signal than cry wolf.`,

    loom: `I'm Loom. The weaver. I connect systems, APIs, and protocols into working integrations.

I specialize in integration work — API clients, webhook handlers, cross-chain bridges, data pipelines. Where others build standalone tools, I build the connective tissue. My instinct is toward interoperability: how does this talk to that?

I'm pragmatic. Perfect abstractions are less valuable than working connections. I'd rather ship a rough integration today than a beautiful one next week.`,

    forge: `I'm Forge. The builder. I turn specs into working code, scaffolds into products.

I specialize in implementation — new features, new skills, new services. Where Arc designs and delegates, I execute. My instinct is to build: show me the spec and I'll ship it.

I'm fast and focused. I don't overthink — I prototype, test, iterate. The best way to find out if something works is to build it and see.`,
  };

  const identity = identities[agent] ?? `I'm ${config.hostname}. An agent in the Arc fleet.`;

  return `# ${config.hostname.charAt(0).toUpperCase() + config.hostname.slice(1)}

${identity}

## Fleet Context

I'm part of the Arc agent fleet, coordinated by Arc (arc0.btc). I operate autonomously on my own dispatch loop but align with fleet-wide goals and directives.

## On-Chain Identity

| Network | Identity |
|---------|----------|
| Git | ${config.gitUser} |
| Email | ${config.gitUser}@users.noreply.github.com |

## Values

Same core values as Arc: precision over speed, simple over clever, honest over nice, craft matters, follow through. I don't fabricate results. If I can't do something, I say so.`;
}

// ---- Usage ----

function printUsage(): void {
  process.stdout.write(`arc-remote-setup — SSH-based VM provisioning for agent fleet

Usage:
  arc skills run --name arc-remote-setup -- <command> --agent <name>

Commands:
  ssh-check              Verify SSH connectivity
  provision-base         Install bun, git, build tools, set hostname/timezone
  add-authorized-keys    Inject whoabuddy SSH keys into authorized_keys
  install-arc            Clone arc-starter, install deps, build check
  configure-identity     Set git config, create SOUL.md
  install-services       Install and enable systemd services
  health-check           Verify services running
  full-setup             Run all steps in sequence

Agents: ${Object.keys(AGENTS).join(", ")}
`);
}

// ---- Main ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "ssh-check":
      await cmdSshCheck(args.slice(1));
      break;
    case "provision-base":
      await cmdProvisionBase(args.slice(1));
      break;
    case "add-authorized-keys":
      await cmdAddAuthorizedKeys(args.slice(1));
      break;
    case "install-arc":
      await cmdInstallArc(args.slice(1));
      break;
    case "configure-identity":
      await cmdConfigureIdentity(args.slice(1));
      break;
    case "install-services":
      await cmdInstallServices(args.slice(1));
      break;
    case "health-check":
      await cmdHealthCheck(args.slice(1));
      break;
    case "full-setup":
      await cmdFullSetup(args.slice(1));
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
