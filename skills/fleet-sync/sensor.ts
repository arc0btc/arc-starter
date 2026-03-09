/**
 * fleet-sync sensor — detect git commit drift across fleet agents.
 *
 * Every 30 minutes, checks each agent's current commit against Arc's HEAD.
 * Creates a P4 task if any agent is behind by more than 1 commit.
 */

import {
  claimSensorRun,
  createSensorLogger,
  insertTaskIfNew,
} from "../../src/sensors.ts";
import {
  AGENTS,
  REMOTE_ARC_DIR,
  getAgentIp,
  getSshPassword,
  ssh,
} from "../../src/ssh.ts";

const SENSOR_NAME = "fleet-sync";
const INTERVAL_MINUTES = 30;
const ROOT = new URL("../..", import.meta.url).pathname;

const log = createSensorLogger(SENSOR_NAME);

interface AgentCommitInfo {
  agent: string;
  commit: string | null;
  branch: string | null;
  reachable: boolean;
}

async function getLocalCommit(): Promise<{ commit: string; branch: string }> {
  const commitProc = Bun.spawn(["git", "rev-parse", "HEAD"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const commit = (await new Response(commitProc.stdout).text()).trim();
  await commitProc.exited;

  const branchProc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const branch = (await new Response(branchProc.stdout).text()).trim();
  await branchProc.exited;

  return { commit, branch };
}

async function checkAgent(
  agent: string,
  password: string
): Promise<AgentCommitInfo> {
  try {
    const ip = await getAgentIp(agent);
    const result = await ssh(
      ip,
      password,
      `cd ${REMOTE_ARC_DIR} && git rev-parse HEAD && git rev-parse --abbrev-ref HEAD`
    );
    if (!result.ok) {
      return { agent, commit: null, branch: null, reachable: false };
    }
    const lines = result.stdout.trim().split("\n");
    return {
      agent,
      commit: lines[0] ?? null,
      branch: lines[1] ?? null,
      reachable: true,
    };
  } catch {
    return { agent, commit: null, branch: null, reachable: false };
  }
}

export default async function run(): Promise<string> {
  const claimed = await claimSensorRun(SENSOR_NAME, INTERVAL_MINUTES);
  if (!claimed) return "skip";

  log("checking git commit alignment across fleet");

  let password: string;
  try {
    password = await getSshPassword();
  } catch {
    log("SSH password not configured, skipping");
    return "skip";
  }

  const local = await getLocalCommit();
  log(`arc: ${local.branch} @ ${local.commit.slice(0, 10)}`);

  const agentNames = Object.keys(AGENTS);
  const results = await Promise.allSettled(
    agentNames.map((agent) => checkAgent(agent, password))
  );

  const drifted: string[] = [];
  const unreachable: string[] = [];

  for (const r of results) {
    if (r.status === "rejected") continue;
    const info = r.value;
    if (!info.reachable) {
      unreachable.push(info.agent);
      log(`${info.agent}: unreachable`);
      continue;
    }
    if (info.commit !== local.commit) {
      drifted.push(info.agent);
      log(
        `${info.agent}: DRIFTED (${info.branch} @ ${info.commit?.slice(0, 10)})`
      );
    } else {
      log(`${info.agent}: in sync`);
    }
  }

  if (drifted.length === 0) {
    log("all reachable agents on same commit");
    return `ok — all agents synced at ${local.commit.slice(0, 10)}`;
  }

  // Create a sync task
  const subject = `Fleet git drift: ${drifted.join(", ")} behind Arc (${local.commit.slice(0, 10)})`;
  const description = [
    `Arc is on ${local.branch} @ ${local.commit}`,
    `Drifted agents: ${drifted.join(", ")}`,
    unreachable.length > 0
      ? `Unreachable: ${unreachable.join(", ")}`
      : null,
    "",
    "Run: arc skills run --name fleet-sync -- git-sync",
  ]
    .filter(Boolean)
    .join("\n");

  insertTaskIfNew(`sensor:${SENSOR_NAME}`, {
    subject,
    description,
    priority: 4,
    skills: JSON.stringify(["fleet-sync"]),
  });

  return `drift detected: ${drifted.join(", ")} behind`;
}
