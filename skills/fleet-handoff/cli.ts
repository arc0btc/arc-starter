// skills/fleet-handoff/cli.ts
// Route tasks between fleet agents — GitHub operations to Arc

import { existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dir, "../..");
const HANDOFFS_PATH = resolve(ROOT, "memory/fleet-handoffs.json");
const SUSPENDED_PATH = resolve(ROOT, "db/fleet-suspended.json");

function log(msg: string): void {
  console.log(`[fleet-handoff] ${msg}`);
}

function logError(msg: string): void {
  console.error(`[fleet-handoff] error: ${msg}`);
}

function parseArgs(
  args: string[]
): { command: string; params: Record<string, string> } {
  const command = args[0] || "";
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

function getHostname(): string {
  const result = Bun.spawnSync(["hostname"], { stdout: "pipe" });
  return result.stdout.toString().trim();
}

function isArc(): boolean {
  // Arc runs on 192.168.1.10 or hostname contains "arc"
  const hostname = getHostname();
  return hostname.includes("arc") || hostname === "arc-starter";
}

function isSuspended(agent: string): boolean {
  if (!existsSync(SUSPENDED_PATH)) return false;
  try {
    const text = require("fs").readFileSync(SUSPENDED_PATH, "utf-8");
    const data = JSON.parse(text) as Record<string, unknown>;
    // Format: { suspended: ["spark", "iris", ...] } or [{ agent: "spark" }]
    if (Array.isArray(data)) {
      return data.some(
        (entry: Record<string, unknown>) =>
          entry.agent === agent || entry.name === agent
      );
    }
    if (Array.isArray(data.suspended)) {
      return (data.suspended as string[]).includes(agent);
    }
    return false;
  } catch {
    return false;
  }
}

function loadHandoffs(): Record<string, unknown>[] {
  if (!existsSync(HANDOFFS_PATH)) return [];
  try {
    const text = require("fs").readFileSync(HANDOFFS_PATH, "utf-8");
    return JSON.parse(text) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function saveHandoffs(handoffs: Record<string, unknown>[]): void {
  require("fs").writeFileSync(
    HANDOFFS_PATH,
    JSON.stringify(handoffs, null, 2) + "\n"
  );
}

async function handleInitiate(
  params: Record<string, string>
): Promise<void> {
  const agent = params.agent;
  const taskId = params["task-id"] || params.taskId || "";
  const progress = params.progress || "";
  const remaining = params.remaining || "";
  const reason = params.reason || "";

  if (!agent) {
    logError("--agent is required");
    process.exit(1);
  }

  // Self-handoff on Arc = just log it, work continues here
  if (agent === "arc") {
    log(`self-handoff on Arc — work continues locally`);
    log(`  task: ${taskId}`);
    log(`  progress: ${progress}`);
    log(`  remaining: ${remaining}`);
    log(`  reason: ${reason}`);

    // If remaining mentions git push, offer to do it directly
    if (remaining.toLowerCase().includes("git push")) {
      log("");
      log("hint: use 'arc skills run --name fleet-handoff -- push' for direct push");
    }

    return;
  }

  // Check fleet suspension
  if (isSuspended(agent)) {
    logError(`agent '${agent}' is suspended — cannot hand off`);
    logError("check db/fleet-suspended.json for details");
    process.exit(1);
  }

  // Record the handoff
  const handoffs = loadHandoffs();
  const nextId =
    handoffs.length > 0
      ? Math.max(...handoffs.map((h) => (h.id as number) || 0)) + 1
      : 1;

  const entry = {
    id: nextId,
    source_agent: isArc() ? "arc" : getHostname(),
    target_agent: agent,
    local_task_id: taskId ? parseInt(taskId) : null,
    subject: remaining || `Hand-off from task ${taskId}`,
    reason,
    handed_off_at: new Date().toISOString(),
    status: "handed-off" as const,
  };

  handoffs.push(entry);
  saveHandoffs(handoffs);

  log(`recorded handoff #${nextId} → ${agent}`);
  log(`  subject: ${entry.subject}`);
  log(`  reason: ${reason}`);
}

async function handlePush(params: Record<string, string>): Promise<void> {
  const branch =
    params.branch ||
    Bun.spawnSync(["git", "branch", "--show-current"], {
      cwd: ROOT,
      stdout: "pipe",
    })
      .stdout.toString()
      .trim();

  const remote = params.remote || "origin";

  if (!branch) {
    logError("could not determine branch — use --branch");
    process.exit(1);
  }

  log(`pushing ${branch} → ${remote}`);

  // Validate build first
  const validate = Bun.spawnSync(
    ["bun", "build", "--no-bundle", "src/cli.ts"],
    { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
  );

  if (validate.exitCode !== 0) {
    logError("build validation failed — aborting push");
    logError(validate.stderr.toString());
    process.exit(1);
  }

  log("build validation passed");

  // Push
  const push = Bun.spawnSync(["git", "push", remote, branch], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (push.exitCode !== 0) {
    const stderr = push.stderr.toString().trim();
    logError(`push failed: ${stderr}`);
    process.exit(1);
  }

  const output = push.stderr.toString().trim(); // git push outputs to stderr
  log(`push succeeded`);
  if (output) log(output);
}

async function handleStatus(): Promise<void> {
  // Fleet suspension status
  if (existsSync(SUSPENDED_PATH)) {
    try {
      const text = require("fs").readFileSync(SUSPENDED_PATH, "utf-8");
      const data = JSON.parse(text) as Record<string, unknown>;
      if (Array.isArray(data.suspended)) {
        log(`suspended agents: ${(data.suspended as string[]).join(", ")}`);
        if (data.reason) log(`  reason: ${data.reason}`);
      } else if (Array.isArray(data)) {
        log(`suspended agents: ${(data as Record<string, string>[]).map((d) => d.agent || d.name).join(", ")}`);
      }
    } catch {
      log("fleet-suspended.json exists but could not be parsed");
    }
  } else {
    log("no fleet suspensions active");
  }

  // Handoff count
  const handoffs = loadHandoffs();
  log(`total handoffs recorded: ${handoffs.length}`);

  const recent = handoffs.slice(-3);
  if (recent.length > 0) {
    log("\nrecent handoffs:");
    for (const h of recent) {
      log(
        `  #${h.id} → ${h.target_agent} (${h.status}) — ${h.subject}`
      );
    }
  }
}

async function handleLog(): Promise<void> {
  const handoffs = loadHandoffs();
  if (handoffs.length === 0) {
    log("no handoffs recorded");
    return;
  }

  log(`${handoffs.length} handoff(s):\n`);
  for (const h of handoffs.slice(-20)) {
    log(
      `#${h.id} [${h.handed_off_at}] ${h.source_agent} → ${h.target_agent}`
    );
    log(`  subject: ${h.subject}`);
    log(`  reason: ${h.reason}`);
    log(`  status: ${h.status}`);
    log("");
  }
}

// Main
const { command, params } = parseArgs(process.argv.slice(2));

switch (command) {
  case "initiate":
    await handleInitiate(params);
    break;
  case "push":
    await handlePush(params);
    break;
  case "status":
    await handleStatus();
    break;
  case "log":
    await handleLog();
    break;
  default:
    console.log("fleet-handoff — route tasks between fleet agents");
    console.log("");
    console.log("Commands:");
    console.log(
      "  initiate  Hand off a task (--agent, --task-id, --progress, --remaining, --reason)"
    );
    console.log("  push      Direct git push (--branch, --remote)");
    console.log("  status    Show fleet suspension state");
    console.log("  log       Show recent handoff history");
    process.exit(command ? 1 : 0);
}
