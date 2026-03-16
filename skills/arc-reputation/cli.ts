#!/usr/bin/env bun
// skills/arc-reputation/cli.ts
// Signed peer review management: create, sign, verify, and query reviews.
// Usage: arc skills run --name arc-reputation -- <subcommand> [flags]

import { resolve } from "node:path";
import { getCredential } from "../../src/credentials.ts";
import {
  type ReviewPayload,
  buildSignableMessage,
  insertReview,
  getReviewById,
  getReviewsByReviewee,
  getReviewsByReviewer,
  getAllReviews,
  getReputationSummary,
} from "./schema.ts";
import {
  getContactByAddress,
  insertContactInteraction,
} from "../contacts/schema.ts";

const SIGN_RUNNER = resolve(import.meta.dir, "../bitcoin-wallet/sign-runner.ts");
const SIGNING_SCRIPT_DIR = resolve(import.meta.dir, "../../github/aibtcdev/skills");
const SIGNING_SCRIPT = resolve(SIGNING_SCRIPT_DIR, "signing/signing.ts");

// ---- Helpers ----

function log(message: string): void {
  console.error(`[${new Date().toISOString()}] [arc-reputation/cli] ${message}`);
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 >= args.length || args[i + 1].startsWith("--")) {
        flags[key] = "true";
      } else {
        flags[key] = args[i + 1];
        i++;
      }
    }
  }
  return flags;
}

async function getWalletPassword(): Promise<string> {
  const password = await getCredential("bitcoin-wallet", "password");
  if (!password) {
    console.log(JSON.stringify({ success: false, error: "Wallet password not found in credential store" }));
    process.exit(1);
  }
  return password;
}

async function getWalletId(): Promise<string> {
  const id = await getCredential("bitcoin-wallet", "id");
  if (!id) {
    console.log(JSON.stringify({ success: false, error: "Wallet ID not found in credential store" }));
    process.exit(1);
  }
  return id;
}

interface SignResult {
  success: boolean;
  signatureBase64?: string;
  signer?: string;
  message?: { hash?: string };
  error?: string;
}

/** Sign a message using BIP-322 via the wallet sign-runner. */
async function signMessage(message: string): Promise<SignResult> {
  const password = await getWalletPassword();
  const walletId = await getWalletId();

  const proc = Bun.spawn(["bun", "run", SIGN_RUNNER, "btc-sign", "--message", message], {
    cwd: SIGNING_SCRIPT_DIR,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      WALLET_ID: walletId,
      WALLET_PASSWORD: password,
    },
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log(`signing failed: ${stderr}`);
    return { success: false, error: stderr || stdout };
  }

  try {
    return JSON.parse(stdout.trim()) as SignResult;
  } catch {
    return { success: false, error: `Failed to parse signing output: ${stdout}` };
  }
}

/** Verify a BIP-322 signature via the upstream signing script. */
async function verifySignature(message: string, signature: string, expectedSigner?: string): Promise<{ valid: boolean; signer?: string; error?: string }> {
  const args = ["btc-verify", "--message", message, "--signature", signature];
  if (expectedSigner) {
    args.push("--expected-signer", expectedSigner);
  }

  const proc = Bun.spawn(["bun", "run", SIGNING_SCRIPT, ...args], {
    cwd: SIGNING_SCRIPT_DIR,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    return { valid: false, error: stderr || stdout };
  }

  try {
    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return {
      valid: result.success === true || result.valid === true,
      signer: result.signer as string | undefined,
    };
  } catch {
    return { valid: false, error: `Failed to parse verify output: ${stdout}` };
  }
}

// ---- Commands ----

async function cmdGiveFeedback(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.reviewee || !flags.subject || !flags.rating) {
    console.log(JSON.stringify({
      success: false,
      error: "Required flags: --reviewee <btc-address> --subject <text> --rating <1-5> [--comment <text>] [--tags <comma-separated>]",
    }));
    process.exit(1);
  }

  const rating = parseInt(flags.rating, 10);
  if (isNaN(rating) || rating < 1 || rating > 5) {
    console.log(JSON.stringify({ success: false, error: "Rating must be an integer from 1 to 5" }));
    process.exit(1);
  }

  const comment = flags.comment || "";
  const tags = flags.tags ? flags.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  // Build the signable payload
  const payload: ReviewPayload = {
    version: 1,
    subject: flags.subject,
    reviewer_address: "", // filled after signing (signer address)
    reviewee_address: flags.reviewee,
    rating,
    comment,
    tags,
    created_at: new Date().toISOString(),
  };

  // Sign the canonical message
  const message = buildSignableMessage(payload);
  log(`signing review for ${flags.reviewee}`);
  const signResult = await signMessage(message);

  if (!signResult.success || !signResult.signatureBase64 || !signResult.signer) {
    console.log(JSON.stringify({
      success: false,
      error: "Signing failed",
      detail: signResult.error,
    }));
    process.exit(1);
  }

  // Update reviewer address from the signing result
  payload.reviewer_address = signResult.signer;

  // Re-sign with correct reviewer address (first sign was needed to discover signer address)
  const finalMessage = buildSignableMessage(payload);
  const finalSignResult = await signMessage(finalMessage);

  if (!finalSignResult.success || !finalSignResult.signatureBase64) {
    console.log(JSON.stringify({
      success: false,
      error: "Final signing failed",
      detail: finalSignResult.error,
    }));
    process.exit(1);
  }

  // Store the review
  const messageHash = finalSignResult.message?.hash || "";
  const reviewId = insertReview({
    subject: payload.subject,
    reviewer_address: payload.reviewer_address,
    reviewee_address: payload.reviewee_address,
    rating: payload.rating,
    comment: payload.comment,
    tags: payload.tags,
    signature: finalSignResult.signatureBase64,
    message_hash: messageHash,
  });

  // Log interaction to contact system
  try {
    const contact = getContactByAddress(null, payload.reviewee_address);
    if (contact) {
      insertContactInteraction({
        contact_id: contact.id,
        type: "collaboration",
        summary: `Reputation review submitted: ${payload.rating}/5 — ${payload.subject}`,
      });
      log(`logged interaction for contact #${contact.id}`);
    }
  } catch (e) {
    log(`warn: failed to log contact interaction: ${e}`);
  }

  console.log(JSON.stringify({
    success: true,
    review_id: reviewId,
    reviewer: payload.reviewer_address,
    reviewee: payload.reviewee_address,
    rating: payload.rating,
    subject: payload.subject,
    signature: finalSignResult.signatureBase64,
    message_hash: messageHash,
  }));
}

async function cmdVerify(args: string[]): Promise<void> {
  const flags = parseFlags(args);

  if (!flags.id) {
    console.log(JSON.stringify({ success: false, error: "Required: --id <review-id>" }));
    process.exit(1);
  }

  const review = getReviewById(parseInt(flags.id, 10));
  if (!review) {
    console.log(JSON.stringify({ success: false, error: `Review #${flags.id} not found` }));
    process.exit(1);
  }

  // Reconstruct the signed message
  const payload: ReviewPayload = {
    version: 1,
    subject: review.subject,
    reviewer_address: review.reviewer_address,
    reviewee_address: review.reviewee_address,
    rating: review.rating,
    comment: review.comment,
    tags: JSON.parse(review.tags) as string[],
    created_at: review.created_at,
  };

  const message = buildSignableMessage(payload);
  const result = await verifySignature(message, review.signature, review.reviewer_address);

  console.log(JSON.stringify({
    success: true,
    review_id: review.id,
    signature_valid: result.valid,
    reviewer: review.reviewer_address,
    ...(result.error ? { verification_error: result.error } : {}),
  }));
}

function cmdShow(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.id) {
    console.log(JSON.stringify({ success: false, error: "Required: --id <review-id>" }));
    process.exit(1);
  }

  const review = getReviewById(parseInt(flags.id, 10));
  if (!review) {
    console.log(JSON.stringify({ success: false, error: `Review #${flags.id} not found` }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    success: true,
    review: {
      ...review,
      tags: JSON.parse(review.tags),
    },
  }));
}

function cmdList(args: string[]): void {
  const flags = parseFlags(args);

  let reviews;
  if (flags.reviewee) {
    reviews = getReviewsByReviewee(flags.reviewee);
  } else if (flags.reviewer) {
    reviews = getReviewsByReviewer(flags.reviewer);
  } else {
    const limit = flags.limit ? parseInt(flags.limit, 10) : 50;
    reviews = getAllReviews(limit);
  }

  console.log(JSON.stringify({
    success: true,
    count: reviews.length,
    reviews: reviews.map((r) => ({
      ...r,
      tags: JSON.parse(r.tags),
    })),
  }));
}

function cmdSummary(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.address) {
    console.log(JSON.stringify({ success: false, error: "Required: --address <btc-address>" }));
    process.exit(1);
  }

  const summary = getReputationSummary(flags.address);
  if (!summary) {
    console.log(JSON.stringify({
      success: true,
      address: flags.address,
      total_reviews: 0,
      message: "No reviews found for this address",
    }));
    return;
  }

  console.log(JSON.stringify({
    success: true,
    address: flags.address,
    ...summary,
  }));
}

function cmdExport(args: string[]): void {
  const flags = parseFlags(args);

  if (!flags.id) {
    console.log(JSON.stringify({ success: false, error: "Required: --id <review-id>" }));
    process.exit(1);
  }

  const review = getReviewById(parseInt(flags.id, 10));
  if (!review) {
    console.log(JSON.stringify({ success: false, error: `Review #${flags.id} not found` }));
    process.exit(1);
  }

  // Export the portable signed review document
  const payload: ReviewPayload = {
    version: 1,
    subject: review.subject,
    reviewer_address: review.reviewer_address,
    reviewee_address: review.reviewee_address,
    rating: review.rating,
    comment: review.comment,
    tags: JSON.parse(review.tags) as string[],
    created_at: review.created_at,
  };

  console.log(JSON.stringify({
    review: payload,
    signature: review.signature,
    message_hash: review.message_hash,
  }));
}

function printUsage(): void {
  process.stdout.write(`arc-reputation CLI

USAGE
  arc skills run --name arc-reputation -- <subcommand> [flags]

SUBCOMMANDS
  give-feedback   Create and sign a peer review
    --reviewee <btc-address>   Address of the entity being reviewed (required)
    --subject <text>           Short description of what's being reviewed (required)
    --rating <1-5>             Rating value (required)
    --comment <text>           Detailed review text (optional)
    --tags <t1,t2>             Comma-separated tags (optional)

  verify          Verify a stored review's BIP-322 signature
    --id <review-id>           Review ID to verify (required)

  show            Show a single review
    --id <review-id>           Review ID (required)

  list            List reviews
    --reviewee <address>       Filter by reviewee address (optional)
    --reviewer <address>       Filter by reviewer address (optional)
    --limit <n>                Max results, default 50 (optional)

  summary         Get reputation summary for an address
    --address <btc-address>    Address to summarize (required)

  export          Export a portable signed review document
    --id <review-id>           Review ID to export (required)

EXAMPLES
  arc skills run --name arc-reputation -- give-feedback --reviewee bc1q... --subject "API reliability" --rating 4 --comment "Consistent uptime" --tags "reliability,api"
  arc skills run --name arc-reputation -- verify --id 1
  arc skills run --name arc-reputation -- list --reviewee bc1q...
  arc skills run --name arc-reputation -- summary --address bc1q...
  arc skills run --name arc-reputation -- export --id 1
`);
}

// ---- Entry point ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  switch (sub) {
    case "give-feedback":
      await cmdGiveFeedback(args.slice(1));
      break;
    case "verify":
      await cmdVerify(args.slice(1));
      break;
    case "show":
      cmdShow(args.slice(1));
      break;
    case "list":
      cmdList(args.slice(1));
      break;
    case "summary":
      cmdSummary(args.slice(1));
      break;
    case "export":
      cmdExport(args.slice(1));
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
