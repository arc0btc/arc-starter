// scripts/arc0btc-worker-deploy.ts
// Manual deploy driver for the LIVE arc0btc-worker checkout: usage
//   bun scripts/arc0btc-worker-deploy.ts <checkout-dir> [--dry-run]
// checkout-dir is normally github/arc0btc/arc0btc-worker (the checkout confirmed live via CF
// Workers API deployment history -- see docs/specs/2026-07-08-arc0btc-worker-deployed-source.md,
// manage-agents repo). ~/arc0btc-worker is a stale, non-live checkout; its sensor is disabled
// (skills/worker-deploy/sensor.ts) specifically so it can't silently overwrite production.
//
// CAUTION (arc-storefront-revamp P7, C-P7-1 sibling gap): `wrangler deploy` bundles the ENTIRE
// on-disk source tree of checkout-dir for its dependency graph, not just files a given phase
// intentionally touched. If ANY other staged/uncommitted edits (yours or another phase's) are
// sitting in this checkout when you run this script, they ship as an undisclosed side effect --
// no commit will exist to point to, so `git log` will look unchanged even though production
// isn't. Before running: `git -C <checkout-dir> status` and confirm nothing unrelated is staged
// or uncommitted. This is how P3's catalog.ts/landing.ts fix went live during P5's unrelated x402
// manifest deploy in this quest's own history -- verify clean state, don't assume it.
import { getCloudflareCredentials, verifyCloudflareToken } from "../src/cloudflare.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dry = process.argv.includes("--dry-run");
const verify = await verifyCloudflareToken();
if (!verify.ok) { console.error("preflight failed:", verify.error); process.exit(1); }
console.log("token verified:", verify.status);

const { creds, error } = await getCloudflareCredentials();
if (!creds) { console.error("creds missing:", error); process.exit(1); }

// Mirror skills/worker-deploy/cli.ts's proven pattern: resolve a real Node npx via fnm,
// NOT `bun x` -- bun x wrangler has been observed to silently die mid-deploy (this session:
// hung after the settings GET, never issued the actual script-upload PUT, no error, exit 0).
function resolveFnmBinDir(): string {
  const which = Bun.spawnSync(["which", "npm"]);
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

const fnmBinDir = resolveFnmBinDir();
const npx = resolveNodeBin("npx", fnmBinDir);
console.log("using npx at:", npx, existsSync(npx) ? "(exists)" : "(MISSING)");

const args = [npx, "wrangler", "deploy", "--env", "production"];
if (dry) args.push("--dry-run");

const nodeEnv: Record<string, string> = fnmBinDir ? { PATH: `${fnmBinDir}:${process.env.PATH ?? ""}` } : {};

const proc = Bun.spawn(args, {
  cwd: process.argv[2],
  env: { ...process.env, ...nodeEnv, CLOUDFLARE_API_TOKEN: creds.apiToken, WRANGLER_LOG: "debug" },
  stdin: "ignore",
  stdout: "pipe",
  stderr: "pipe",
});
const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
const code = await proc.exited;
console.log("EXIT:", code);
console.log("STDOUT:\n", out);
console.log("STDERR:\n", err);
