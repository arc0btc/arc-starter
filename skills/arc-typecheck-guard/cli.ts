/**
 * arc-typecheck-guard CLI.
 *
 *   check      run one guard pass now (prints outcome JSON; does not file a task)
 *   status     print the current persisted baseline
 *   baseline   force-refresh the baseline to current HEAD + current tsc counts
 */

import { getHeadSha, loadBaseline, runGuard, runTsc, saveBaseline } from "./check.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "check";

  if (command === "check") {
    const outcome = await runGuard();
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }

  if (command === "status") {
    console.log(JSON.stringify(loadBaseline(), null, 2));
    return;
  }

  if (command === "baseline") {
    const head = await getHeadSha();
    const tsc = await runTsc();
    if (!tsc.ran) {
      console.error("tsc could not run — baseline unchanged");
      process.exit(1);
    }
    await saveBaseline({
      lastCheckedSha: head,
      errorCounts: tsc.counts,
      updatedAt: new Date().toISOString(),
    });
    const total = Object.values(tsc.counts).reduce((sum, count) => sum + count, 0);
    console.log(
      `baseline refreshed: ${Object.keys(tsc.counts).length} file(s), ${total} error(s) at ${head ?? "unknown HEAD"}`,
    );
    return;
  }

  console.error(`unknown command: ${command}\nusage: cli.ts [check|status|baseline]`);
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
