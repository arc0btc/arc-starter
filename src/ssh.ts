/**
 * Shared SSH utilities for fleet operations.
 *
 * Extracted from arc-remote-setup to avoid duplication across skills.
 * Uses sshpass for password auth via SSHPASS env var.
 */

import { getCredential } from "./credentials.ts";

// ---- Fleet config ----

export interface AgentConfig {
  ip: string;
  gitUser: string;
  hostname: string;
}

export const AGENTS: Record<string, AgentConfig> = {
  spark: { ip: "192.168.1.12", gitUser: "spark0btc", hostname: "spark" },
  iris: { ip: "192.168.1.13", gitUser: "iris0btc", hostname: "iris" },
  loom: { ip: "192.168.1.14", gitUser: "loom0btc", hostname: "loom" },
  forge: { ip: "192.168.1.15", gitUser: "forge0btc", hostname: "forge" },
};

export const SSH_USER = "dev";
export const REMOTE_ARC_DIR = "/home/dev/arc-starter";

// ---- SSH types & helpers ----

export interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function getAgentIp(agent: string): Promise<string> {
  const override = await getCredential("vm-fleet", `${agent}-ip`);
  if (override) return override;
  const config = AGENTS[agent];
  if (!config) throw new Error(`Unknown agent: ${agent}`);
  return config.ip;
}

export async function getSshPassword(): Promise<string> {
  const password = await getCredential("vm-fleet", "ssh-password");
  if (!password)
    throw new Error(
      "SSH password not set. Run: arc creds set --service vm-fleet --key ssh-password --value <pw>"
    );
  return password;
}

export async function ssh(
  ip: string,
  password: string,
  command: string
): Promise<SshResult> {
  const proc = Bun.spawn(
    [
      "sshpass",
      "-e",
      "ssh",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "BatchMode=no",
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

export async function sshLog(
  ip: string,
  password: string,
  label: string,
  command: string
): Promise<SshResult> {
  process.stdout.write(
    `  [${label}] ${command.slice(0, 80)}${command.length > 80 ? "..." : ""}\n`
  );
  const result = await ssh(ip, password, command);
  if (!result.ok) {
    process.stderr.write(`  [${label}] FAILED (exit ${result.exitCode})\n`);
    if (result.stderr.trim())
      process.stderr.write(`  ${result.stderr.trim()}\n`);
  }
  return result;
}

/** Resolve agent list: "all" or comma-separated names. Returns validated agent names. */
export function resolveAgents(agentsArg: string | undefined): string[] {
  if (!agentsArg || agentsArg === "all") {
    return Object.keys(AGENTS);
  }
  const names = agentsArg.split(",").map((s) => s.trim());
  for (const name of names) {
    if (!AGENTS[name]) {
      throw new Error(
        `Unknown agent '${name}'. Known: ${Object.keys(AGENTS).join(", ")}`
      );
    }
  }
  return names;
}

// ---- Suspended agent sentinel ----

const SUSPENDED_SENTINEL = new URL("../db/fleet-suspended.json", import.meta.url).pathname;

/** Read suspended agent names from db/fleet-suspended.json. Returns empty set if missing. */
export function getSuspendedAgents(): Set<string> {
  try {
    const text = require("node:fs").readFileSync(SUSPENDED_SENTINEL, "utf-8");
    const data = JSON.parse(text) as { suspended?: string[] };
    return new Set(data.suspended ?? []);
  } catch {
    return new Set();
  }
}

/** Returns true if db/fleet-suspended.json exists with a non-empty suspended array. Use as a hard gate in fleet sensors. */
export function isFleetSuspended(): boolean {
  const suspended = getSuspendedAgents();
  return suspended.size > 0;
}

/** Get agent names excluding suspended ones. Use in sensors to avoid noisy tasks for down agents. */
export function getActiveAgentNames(): string[] {
  const suspended = getSuspendedAgents();
  return Object.keys(AGENTS).filter((a) => !suspended.has(a));
}
