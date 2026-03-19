// skills/arc-opensource/cli.ts
// CLI for arc-opensource maintenance operations

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "status":
    await showStatus();
    break;
  case "check":
    await runCheck();
    break;
  case "validate":
    await validateBuild();
    break;
  default:
    console.log("arc-opensource CLI");
    console.log("");
    console.log("Commands:");
    console.log("  status    Show unpushed commits and last push date");
    console.log("  check     Run sync check (non-gated, creates task if needed)");
    console.log("  validate  Run bun build check on src/cli.ts");
}

async function showStatus(): Promise<void> {
  // Unpushed commits
  const unpushed = Bun.spawnSync(
    ["git", "log", "origin/main..HEAD", "--oneline"],
    { cwd: process.cwd() }
  );

  if (unpushed.exitCode !== 0) {
    console.error("Failed to check git log:", unpushed.stderr.toString().trim());
    process.exit(1);
  }

  const lines = unpushed.stdout.toString().trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.log("✓ arc-starter is in sync with origin/main");
  } else {
    console.log(`⚠ ${lines.length} unpushed commit(s):`);
    for (const line of lines.slice(0, 10)) {
      console.log(`  ${line}`);
    }
    if (lines.length > 10) {
      console.log(`  ...and ${lines.length - 10} more`);
    }
  }

  // Last push date (last commit reachable from origin/main)
  const lastPushed = Bun.spawnSync(
    ["git", "log", "origin/main", "-1", "--format=%ci %s"],
    { cwd: process.cwd() }
  );

  if (lastPushed.exitCode === 0) {
    const info = lastPushed.stdout.toString().trim();
    if (info) {
      console.log(`\nLast synced commit: ${info}`);
    }
  }

  // Current branch
  const branch = Bun.spawnSync(["git", "branch", "--show-current"], { cwd: process.cwd() });
  if (branch.exitCode === 0) {
    console.log(`Current branch: ${branch.stdout.toString().trim()}`);
  }
}

async function runCheck(): Promise<void> {
  console.log("Running arc-opensource sync check...");

  const result = Bun.spawnSync(
    ["git", "log", "origin/main..HEAD", "--oneline"],
    { cwd: process.cwd() }
  );

  if (result.exitCode !== 0) {
    console.error("git log failed:", result.stderr.toString().trim());
    process.exit(1);
  }

  const lines = result.stdout.toString().trim().split("\n").filter(Boolean);

  if (lines.length === 0) {
    console.log("No unpushed commits — nothing to sync");
    return;
  }

  console.log(`${lines.length} unpushed commit(s) — creating sync task`);

  const { insertTask, pendingTaskExistsForSource } = await import("../../src/db.ts");
  const source = "sensor:arc-opensource";

  if (pendingTaskExistsForSource(source)) {
    console.log("Pending sync task already exists — skipping");
    return;
  }

  const summary = lines.slice(0, 5).join("\n");
  const more = lines.length > 5 ? `\n...and ${lines.length - 5} more` : "";

  insertTask({
    subject: `arc-opensource: sync ${lines.length} commit(s) to GitHub`,
    description: [
      `arc-starter has ${lines.length} unpushed commit(s) that should be published.`,
      "",
      "Recent unpushed commits:",
      summary + more,
      "",
      "Steps:",
      "1. arc skills run --name arc-opensource -- validate",
      "2. arc skills run --name fleet-handoff -- initiate --agent arc \\",
      "   --progress \"arc-starter up to date locally\" \\",
      "   --remaining \"git push origin <branch>\" \\",
      "   --reason \"GitHub is Arc-only\"",
      "3. arc tasks close --id <this-task-id> --status completed",
    ].join("\n"),
    skills: JSON.stringify(["arc-opensource", "fleet-handoff"]),
    priority: 5,
    source,
  });

  console.log("Sync task created");
}

async function validateBuild(): Promise<void> {
  console.log("Validating src/cli.ts build...");

  const result = Bun.spawnSync(
    ["bun", "build", "--no-bundle", "src/cli.ts"],
    { cwd: process.cwd(), stderr: "pipe", stdout: "pipe" }
  );

  if (result.exitCode === 0) {
    console.log("✓ Build check passed");
  } else {
    console.error("✗ Build check failed:");
    console.error(result.stderr.toString());
    process.exit(1);
  }
}
