#!/usr/bin/env bun
// skills/blog-deploy/cli.ts
// Deploy arc0me-site to Cloudflare Workers.

import { join } from "node:path";
import { existsSync } from "node:fs";
import { readHookState, writeHookState } from "../../src/sensors.ts";
import { getCredential } from "../../src/credentials.ts";

const SENSOR_NAME = "blog-deploy";
const SITE_DIR = join(process.cwd(), "github/arc0btc/arc0me-site");

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [blog-deploy/cli] ${message}`);
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
    const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: SITE_DIR });
    return result.stdout.toString().trim().substring(0, 12);
  } catch {
    return "";
  }
}

async function runCommand(
  command: string[],
  cwd: string,
  env?: Record<string, string>
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

  if (!existsSync(SITE_DIR)) {
    process.stderr.write(`arc0me-site not found at ${SITE_DIR}\n`);
    process.exit(1);
  }

  const currentSha = getCurrentSha();
  log(`deploying arc0me-site @ ${currentSha}`);

  // Retrieve Cloudflare API token
  let cfToken: string;
  try {
    const token = await getCredential("cloudflare", "api_token");
    if (!token) throw new Error("credential not found or empty");
    cfToken = token;
  } catch (e) {
    process.stderr.write(`Failed to retrieve cloudflare/api_token from credential store: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }

  // Step 1: Build
  log("running npm run build...");
  const build = await runCommand(["npm", "run", "build"], SITE_DIR);
  if (build.exitCode !== 0) {
    process.stderr.write(`Build failed (exit ${build.exitCode}):\n${build.stderr || build.stdout}\n`);
    process.exit(1);
  }
  log("build succeeded");

  // Step 2: Deploy
  log("running npx wrangler deploy --env production...");
  const deploy = await runCommand(
    ["npx", "wrangler", "deploy", "--env", "production"],
    SITE_DIR,
    { CLOUDFLARE_API_TOKEN: cfToken }
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
    await writeHookState(SENSOR_NAME, { ...state, last_deployed_sha: currentSha });
    log(`recorded deployed SHA: ${currentSha}`);
  }

  // Step 4: Verify (optional, non-fatal)
  if (!flags["skip-verify"]) {
    log("verifying deployment...");
    const verify = Bun.spawnSync(
      ["bash", "bin/arc", "skills", "run", "--name", "blog-publishing", "--", "verify-deploy"],
      { cwd: process.cwd() }
    );
    const verifyOut = verify.stdout.toString();
    if (verifyOut) console.log(verifyOut);
    if (verify.exitCode !== 0) {
      process.stderr.write("WARNING: verify-deploy reported issues (deploy itself succeeded)\n");
    }
  }

  console.log(JSON.stringify({ success: true, sha: currentSha, site: "https://arc0.me" }, null, 2));
}

async function cmdStatus(_args: string[]): Promise<void> {
  const currentSha = existsSync(SITE_DIR) ? getCurrentSha() : "(site not found)";
  const state = await readHookState(SENSOR_NAME);
  const lastDeployedSha = (state?.last_deployed_sha as string) ?? "(never deployed)";

  const upToDate = currentSha === lastDeployedSha;
  console.log(JSON.stringify({
    current_sha: currentSha,
    last_deployed_sha: lastDeployedSha,
    up_to_date: upToDate,
    site: "https://arc0.me",
  }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`blog-deploy CLI

USAGE
  arc skills run --name blog-deploy -- <subcommand> [flags]

SUBCOMMANDS
  deploy [--skip-verify]
    Build arc0me-site and deploy to Cloudflare Workers (production).
    Retrieves CLOUDFLARE_API_TOKEN from credential store automatically.
    Runs verify-deploy after successful deploy unless --skip-verify is set.

  status
    Show current site SHA vs last deployed SHA.

EXAMPLES
  arc skills run --name blog-deploy -- deploy
  arc skills run --name blog-deploy -- deploy --skip-verify
  arc skills run --name blog-deploy -- status
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
