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
