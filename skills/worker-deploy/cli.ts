#!/usr/bin/env bun
// skills/worker-deploy/cli.ts
// Deploy arc0btc-worker to Cloudflare Workers (arc0btc.com).

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readHookState, writeHookState } from "../../src/sensors.ts";
import { verifyCloudflareToken, getCloudflareCredentials } from "../../src/cloudflare.ts";

const SENSOR_NAME = "worker-deploy";
const WORKER_DIR = join(process.env.HOME ?? "/home/dev", "arc0btc-worker");

function resolveFnmBinDir(): string {
  const which = Bun.spawnSync(["which", "node"]);
  if (which.exitCode === 0) return "";
  const fnmDir = join(process.env.HOME ?? "/root", ".local/share/fnm/node-versions");
  const ls = Bun.spawnSync(["ls", fnmDir]);
  if (ls.exitCode === 0) {
    const versions = ls.stdout.toString().trim().split("\n").filter(Boolean).sort().reverse();
    if (versions[0]) return join(fnmDir, versions[0], "installation/bin");
  }
  return "";
}

function resolveNodeBin(bin: string, fnmBinDir: string): string {
  const which = Bun.spawnSync(["which", bin]);
  if (which.exitCode === 0) return bin;
  if (fnmBinDir) return join(fnmBinDir, bin);
  return bin;
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [worker-deploy/cli] ${message}`);
}

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

function getCurrentSha(): string {
  try {
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: WORKER_DIR });
    return result.stdout.toString().trim().substring(0, 12);
  } catch {
    return "";
  }
}

async function runCommand(
  command: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(command, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

async function cmdDeploy(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!existsSync(WORKER_DIR)) {
    process.stderr.write(`arc0btc-worker not found at ${WORKER_DIR}\n`);
    process.exit(1);
  }

  const currentSha = getCurrentSha();
  log(`deploying arc0btc-worker @ ${currentSha}`);

  // Pre-flight: verify Cloudflare token (account-scoped endpoint)
  const verify = await verifyCloudflareToken();
  if (!verify.ok) {
    process.stderr.write(`Cloudflare pre-flight failed: ${verify.error}\n`);
    process.exit(1);
  }
  log(`cloudflare token verified (status: ${verify.status})`);

  // Retrieve Cloudflare API token for wrangler
  const { creds: cfCreds } = await getCloudflareCredentials();
  if (!cfCreds) { process.stderr.write("cloudflare credentials missing after verify — unreachable\n"); process.exit(1); }
  const cfToken = cfCreds.apiToken;

  const fnmBinDir = resolveFnmBinDir();
  const nodeEnv = fnmBinDir ? { PATH: `${fnmBinDir}:${process.env.PATH ?? ""}` } : {};
  const npm = resolveNodeBin("npm", fnmBinDir);
  const npx = resolveNodeBin("npx", fnmBinDir);

  // Step 1: Build client
  log("running npm run build:client...");
  const build = await runCommand([npm, "run", "build:client"], WORKER_DIR, nodeEnv);
  if (build.exitCode !== 0) {
    process.stderr.write(`Build failed (exit ${build.exitCode}):\n${build.stderr || build.stdout}\n`);
    process.exit(1);
  }
  log("build succeeded");

  // Step 2: Deploy to production
  log("running npx wrangler deploy --env production...");
  const deploy = await runCommand(
    [npx, "wrangler", "deploy", "--env", "production"],
    WORKER_DIR,
    { ...nodeEnv, CLOUDFLARE_API_TOKEN: cfToken },
  );

  if (deploy.exitCode !== 0) {
    process.stderr.write(`Deploy failed (exit ${deploy.exitCode}):\n${deploy.stderr || deploy.stdout}\n`);
    process.exit(1);
  }

  log("deploy succeeded");
  console.log(deploy.stdout || deploy.stderr);

  // Step 3: Record deployed SHA in hook state
  if (currentSha) {
    const state = (await readHookState(SENSOR_NAME)) ?? {};
    await writeHookState(SENSOR_NAME, {
      ...state,
      last_deployed_sha: currentSha,
      last_ran: new Date().toISOString(),
      last_result: "ok",
      version: (state as Record<string, unknown>).version
        ? ((state as Record<string, unknown>).version as number) + 1
        : 1,
    });
    log(`recorded deployed SHA: ${currentSha}`);
  }

  // Step 4: Verify health (non-fatal)
  if (!flags["skip-verify"]) {
    log("verifying deployment via health endpoint...");
    try {
      const response = await fetch("https://arc0btc.com/health", {
        signal: AbortSignal.timeout(15_000),
      });
      const body = await response.text();
      if (response.ok) {
        log(`health check passed: ${body}`);
      } else {
        process.stderr.write(`WARNING: health check returned HTTP ${response.status}: ${body}\n`);
      }
    } catch (e) {
      process.stderr.write(
        `WARNING: health check failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  console.log(
    JSON.stringify({ success: true, sha: currentSha, site: "https://arc0btc.com" }, null, 2),
  );
}

async function cmdStatus(_args: string[]): Promise<void> {
  const currentSha = existsSync(WORKER_DIR) ? getCurrentSha() : "(worker not found)";
  const state = await readHookState(SENSOR_NAME);
  const lastDeployedSha = (state?.last_deployed_sha as string) ?? "(never deployed)";

  const upToDate = currentSha === lastDeployedSha;
  console.log(
    JSON.stringify(
      {
        current_sha: currentSha,
        last_deployed_sha: lastDeployedSha,
        up_to_date: upToDate,
        site: "https://arc0btc.com",
      },
      null,
      2,
    ),
  );
}

function printUsage(): void {
  process.stdout.write(`worker-deploy CLI

USAGE
  arc skills run --name worker-deploy -- <subcommand> [flags]

SUBCOMMANDS
  deploy [--skip-verify]
    Build arc0btc-worker and deploy to Cloudflare Workers (production).
    Retrieves CLOUDFLARE_API_TOKEN from credential store automatically.
    Runs health check after successful deploy unless --skip-verify is set.

  status
    Show current worker SHA vs last deployed SHA.

EXAMPLES
  arc skills run --name worker-deploy -- deploy
  arc skills run --name worker-deploy -- deploy --skip-verify
  arc skills run --name worker-deploy -- status
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "deploy":
      await cmdDeploy(args.slice(1));
      break;
    case "status":
      await cmdStatus(args.slice(1));
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
