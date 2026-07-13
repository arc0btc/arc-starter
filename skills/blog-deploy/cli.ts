#!/usr/bin/env bun
// skills/blog-deploy/cli.ts
// Deploy arc0me-site to Cloudflare Workers.

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readHookState, writeHookState } from "../../src/sensors.ts";
import { verifyCloudflareToken, getCloudflareCredentials } from "../../src/cloudflare.ts";

const SENSOR_NAME = "blog-deploy";
const SITE_DIR = join(import.meta.dir, "../../github/arc0btc/arc0me-site");

// Resolve the fnm node bin directory (or empty string if not found / already on PATH)
function resolveFnmBinDir(): string {
  // Check if npm specifically is on PATH (node may be symlinked without npm)
  const whichNpm = Bun.spawnSync(["which", "npm"]);
  if (whichNpm.exitCode === 0) return ""; // npm already on PATH
  const fnmDir = join(process.env.HOME ?? "/root", ".local/share/fnm/node-versions");
  const ls = Bun.spawnSync(["ls", fnmDir]);
  if (ls.exitCode === 0) {
    const versions = ls.stdout.toString().trim().split("\n").filter(Boolean).sort().reverse();
    if (versions[0]) return join(fnmDir, versions[0], "installation/bin");
  }
  return "";
}

// Resolve npm/npx from fnm node-versions if not on PATH
function resolveNodeBin(bin: string, fnmBinDir: string): string {
  const which = Bun.spawnSync(["which", bin]);
  if (which.exitCode === 0) return bin;
  if (fnmBinDir) return join(fnmBinDir, bin);
  return bin;
}

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

  // Step 0.5: Sign sweep — reconcile SIP-018 sidecars for any new/changed posts so
  // every deploy ships a consistent signed corpus. Non-fatal: a wallet hiccup must
  // never block content (a missed post just lacks a badge until the next sweep).
  try {
    log("running SIP-018 sign sweep...");
    const sweep = Bun.spawnSync(
      [process.execPath, "skills/blog-publishing/sign-runner.ts", "--sweep", "--commit"],
      { cwd: join(import.meta.dir, "../..") }
    );
    const sweepOut = sweep.stdout.toString().trim();
    if (sweepOut) log(`sign sweep: ${sweepOut}`);
    if (sweep.exitCode !== 0) {
      process.stderr.write(`WARNING: sign sweep failed (non-fatal, continuing deploy): ${sweep.stderr.toString().slice(0, 500)}\n`);
    }
  } catch (e) {
    process.stderr.write(`WARNING: sign sweep errored (non-fatal): ${e}\n`);
  }

  // Re-read HEAD: the sign sweep above may have committed a signature update,
  // advancing HEAD past currentSha. Build/deploy below ship whatever HEAD is
  // now, so the recorded deployed SHA must match post-sweep, not pre-sweep.
  const deploySha = getCurrentSha() || currentSha;
  if (deploySha !== currentSha) {
    log(`sign sweep advanced HEAD ${currentSha} -> ${deploySha}`);
  }

  // Step 1: Build
  const fnmBinDir = resolveFnmBinDir();
  const nodeEnv: Record<string, string> = fnmBinDir ? { PATH: `${fnmBinDir}:${process.env.PATH ?? ""}` } : {};
  const npm = resolveNodeBin("npm", fnmBinDir);
  const npx = resolveNodeBin("npx", fnmBinDir);
  log("running npm run build...");
  const build = await runCommand([npm, "run", "build"], SITE_DIR, nodeEnv);
  if (build.exitCode !== 0) {
    // Record failed SHA so the sensor won't re-queue the same broken commit
    if (deploySha) {
      const state = (await readHookState(SENSOR_NAME)) ?? {} as Parameters<typeof writeHookState>[1];
      await writeHookState(SENSOR_NAME, { ...state, last_failed_sha: deploySha } as Parameters<typeof writeHookState>[1]);
    }
    process.stderr.write(`Build failed (exit ${build.exitCode}):\n${build.stderr || build.stdout}\n`);
    process.exit(1);
  }
  log("build succeeded");

  // Step 2: Deploy
  log("running npx wrangler deploy --env production...");
  const deploy = await runCommand(
    [npx, "wrangler", "deploy", "--env", "production"],
    SITE_DIR,
    { ...nodeEnv, CLOUDFLARE_API_TOKEN: cfToken }
  );

  if (deploy.exitCode !== 0) {
    process.stderr.write(`Deploy failed (exit ${deploy.exitCode}):\n${deploy.stderr || deploy.stdout}\n`);
    process.exit(1);
  }

  log("deploy succeeded");
  console.log(deploy.stdout || deploy.stderr);

  // Step 3: Record deployed SHA in hook state
  if (deploySha) {
    const state = (await readHookState(SENSOR_NAME)) ?? {} as Parameters<typeof writeHookState>[1];
    await writeHookState(SENSOR_NAME, { ...state, last_deployed_sha: deploySha } as Parameters<typeof writeHookState>[1]);
    log(`recorded deployed SHA: ${deploySha}`);
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

  // Step 5: Signature reconciliation — every signed post (public/verify/index.json)
  // must still hash live to its sidecar record. Catches out-of-band content edits
  // that would paint the /verify page red. Non-fatal: deploy already shipped.
  try {
    const idxPath = join(SITE_DIR, "public/verify/index.json");
    if (existsSync(idxPath)) {
      const verifyIndex = JSON.parse(readFileSync(idxPath, "utf-8"));
      const slugs = Object.keys(verifyIndex.posts ?? {});
      let mismatches = 0;
      for (const slug of slugs) {
        const response = await fetch(`https://arc0.me/blog/${slug}.md`);
        if (!response.ok) {
          mismatches++;
          process.stderr.write(`WARNING: signed post ${slug} not fetchable live (${response.status})\n`);
          continue;
        }
        const liveHash = createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
        if (liveHash !== verifyIndex.posts[slug].contentHash) {
          mismatches++;
          process.stderr.write(`WARNING: SIGNATURE MISMATCH for ${slug}: live ${liveHash} != signed ${verifyIndex.posts[slug].contentHash} — run sign-runner --slug ${slug} and redeploy\n`);
        }
      }
      log(`signature reconciliation: ${slugs.length - mismatches}/${slugs.length} signed posts match live content`);
    }
  } catch (e) {
    process.stderr.write(`WARNING: signature reconciliation errored (non-fatal): ${e}\n`);
  }

  console.log(JSON.stringify({ success: true, sha: deploySha, site: "https://arc0.me" }, null, 2));
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
