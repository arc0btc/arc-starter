#!/usr/bin/env bun
// skills/arc-starter-publish/cli.ts
// Merge v2 into main (fast-forward only) and push to origin.

const REPO_DIR = import.meta.dir.replace(/\/skills\/arc-starter-publish$/, "");

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [arc-starter-publish/cli] ${message}`);
}

function git(args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["git", ...args], { cwd: REPO_DIR });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString().trim(),
    stderr: result.stderr.toString().trim(),
  };
}

function currentBranch(): string {
  const result = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.ok ? result.stdout : "";
}

function cmdStatus(): void {
  // Fetch latest
  git(["fetch", "origin", "main", "v2", "--quiet"]);

  const ahead = git(["rev-list", "--count", "main..v2"]);
  const behind = git(["rev-list", "--count", "v2..main"]);
  const v2Sha = git(["rev-parse", "--short=12", "v2"]);
  const mainSha = git(["rev-parse", "--short=12", "main"]);

  console.log(JSON.stringify({
    v2_sha: v2Sha.ok ? v2Sha.stdout : "unknown",
    main_sha: mainSha.ok ? mainSha.stdout : "unknown",
    v2_ahead_of_main: ahead.ok ? parseInt(ahead.stdout, 10) : -1,
    main_ahead_of_v2: behind.ok ? parseInt(behind.stdout, 10) : -1,
    fast_forward_possible: behind.ok && parseInt(behind.stdout, 10) === 0,
  }, null, 2));
}

function cmdPublish(): void {
  const branch = currentBranch();

  // Fetch latest refs
  log("fetching origin...");
  const fetch = git(["fetch", "origin", "main", "v2"]);
  if (!fetch.ok) {
    process.stderr.write(`fetch failed: ${fetch.stderr}\n`);
    process.exit(1);
  }

  // Check if v2 is actually ahead
  const aheadResult = git(["rev-list", "--count", "main..v2"]);
  if (!aheadResult.ok) {
    process.stderr.write(`could not compare branches: ${aheadResult.stderr}\n`);
    process.exit(1);
  }
  const ahead = parseInt(aheadResult.stdout, 10);
  if (ahead === 0) {
    log("v2 and main are already in sync — nothing to publish");
    return;
  }

  // Check fast-forward is possible (main has no commits not in v2)
  const behindResult = git(["rev-list", "--count", "v2..main"]);
  if (!behindResult.ok || parseInt(behindResult.stdout, 10) > 0) {
    process.stderr.write(
      `Cannot fast-forward: main has ${behindResult.stdout} commit(s) not in v2.\n` +
      `Resolve divergence manually before publishing.\n`
    );
    process.exit(1);
  }

  log(`v2 is ${ahead} commit(s) ahead of main — merging...`);

  // Checkout main
  const checkout = git(["checkout", "main"]);
  if (!checkout.ok) {
    process.stderr.write(`checkout main failed: ${checkout.stderr}\n`);
    process.exit(1);
  }

  // Fast-forward merge
  const merge = git(["merge", "--ff-only", "v2"]);
  if (!merge.ok) {
    process.stderr.write(`merge failed: ${merge.stderr}\n`);
    // Return to original branch
    git(["checkout", branch]);
    process.exit(1);
  }

  log(`merged v2 into main (ff-only): ${merge.stdout}`);

  // Push main to origin
  log("pushing main to origin...");
  const push = git(["push", "origin", "main"]);
  if (!push.ok) {
    process.stderr.write(`push failed: ${push.stderr}\n`);
    // Return to original branch
    git(["checkout", branch]);
    process.exit(1);
  }

  log("push succeeded");

  // Return to original branch
  if (branch && branch !== "main") {
    git(["checkout", branch]);
    log(`returned to branch ${branch}`);
  }

  console.log(JSON.stringify({
    success: true,
    commits_merged: ahead,
    main_sha: git(["rev-parse", "--short=12", "main"]).stdout,
  }, null, 2));
}

function printUsage(): void {
  process.stdout.write(`arc-starter-publish CLI

USAGE
  arc skills run --name arc-starter-publish -- <subcommand>

SUBCOMMANDS
  status
    Show v2 vs main commit difference and whether fast-forward is possible.

  publish
    Fast-forward merge v2 into main and push to origin.
    Fails if main has diverged from v2 (non-fast-forward).

EXAMPLES
  arc skills run --name arc-starter-publish -- status
  arc skills run --name arc-starter-publish -- publish
`);
}

function main(): void {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "status":
      cmdStatus();
      break;
    case "publish":
      cmdPublish();
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

main();
