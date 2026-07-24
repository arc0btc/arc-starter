/**
 * scripts/send-article-package.ts
 *
 * VM-resident sender for the article-pipeline auto-packager (arc-operator-loop P4,
 * ops/article-covers/auto-package.ts on the manage-agents control plane). Reads a JSON request
 * file (written by the control-plane script, scp'd up alongside the cover PNG) and POSTs to
 * arc-email-worker's /api/send with the cover attached, using the VM's OWN admin-key credential
 * (skills/arc-credentials/cli.ts) — never a control-plane-held key. Mirrors P3's dev-council
 * decision (send-brief.ts) that every sender in this codebase runs on the VM with VM-local
 * credentials.
 *
 * Request file shape: { to, subject, body, attachmentPath, attachmentName }
 *
 * Usage:
 *   bun scripts/send-article-package.ts --request-file /path/to/request.json
 */

import { getCredential } from "../src/credentials.ts";
import { readFileSync } from "node:fs";

interface SendRequest {
  to: string;
  subject: string;
  body: string;
  attachmentPath: string;
  attachmentName: string;
}

async function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--request-file");
  if (idx === -1 || !args[idx + 1]) {
    console.error("usage: bun scripts/send-article-package.ts --request-file <path>");
    process.exit(2);
  }
  const requestPath = args[idx + 1];
  const req = JSON.parse(readFileSync(requestPath, "utf8")) as SendRequest;

  if (!req.to || !req.subject || !req.body || !req.attachmentPath) {
    console.error(`malformed request file: ${JSON.stringify(req)}`);
    process.exit(2);
  }

  // Binding operator constraint: whoabuddy@gmail.com is the ONLY permitted operator email —
  // jason@joinfreehold.com is retired and must never receive an outbound send. Enforced here,
  // not just at the caller, since this is the last hop before the real send happens.
  if (req.to !== "whoabuddy@gmail.com") {
    console.error(`refusing to send: "to" must be whoabuddy@gmail.com, got "${req.to}"`);
    process.exit(3);
  }

  const adminKey = await getCredential("email", "admin_api_key");
  const apiBaseUrl = await getCredential("email", "api_base_url");
  if (!adminKey || !apiBaseUrl) {
    console.error("missing email/admin_api_key or email/api_base_url credential");
    process.exit(4);
  }

  const attachmentBytes = readFileSync(req.attachmentPath);
  const attachmentB64 = attachmentBytes.toString("base64");

  const res = await fetch(`${apiBaseUrl}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Admin-Key": adminKey },
    body: JSON.stringify({
      to: req.to,
      subject: req.subject,
      body: req.body,
      attachments: [{ filename: req.attachmentName, content: attachmentB64, contentType: "image/png" }],
    }),
  });

  const json = await res.json();
  if (!res.ok || !(json as { ok?: boolean }).ok) {
    console.error(`SEND_FAILED status=${res.status} body=${JSON.stringify(json)}`);
    process.exit(1);
  }
  console.log(`SENT ${JSON.stringify(json)}`);
}

main().catch((err) => {
  console.error(`send-article-package: unhandled error: ${err}`);
  process.exit(1);
});
