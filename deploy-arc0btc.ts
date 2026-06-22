import { credentials } from "./skills/arc-credentials/store.ts";
import { $ } from "bun";

await credentials.unlock();
const token = await credentials.get("cloudflare", "api_token");
if (!token) throw new Error("No CF api_token");

console.log("Token acquired (len=" + token.length + ")");

const result = await $`node_modules/.bin/wrangler deploy --env ''`
  .env({ ...process.env, CLOUDFLARE_API_TOKEN: token })
  .cwd("/home/dev/arc-starter/github/arc0btc/arc0btc-worker")
  .text();

console.log(result);
