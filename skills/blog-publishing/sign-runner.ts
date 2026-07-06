#!/usr/bin/env bun
/**
 * SIP-018 article signer — idempotent reconciler.
 * Spec: manage-agents/docs/specs/2026-07-05-sip018-article-verify-spec.md (v2, dev-council locked)
 *
 * Canonical content = FULL file bytes as served at https://arc0.me/blog/<slug>.md
 * (byte-identical to src/content/docs/blog/<slug>.mdx — proven live 2026-07-05;
 * the --live-verify command guards that invariant after every deploy).
 *
 * Signing key = wallet account index 1, dedicated to content signing. The index-0
 * identity/treasury key (SP2GHQ…, arc0.btc) signs ONLY the one-time key attestation
 * in keys.json and is never used for routine signing.
 *
 * Usage (run from ~/arc-starter so bun loads .env for the credential store):
 *   bun skills/blog-publishing/sign-runner.ts --keys [--dry-run]
 *   bun skills/blog-publishing/sign-runner.ts --slug <slug>
 *   bun skills/blog-publishing/sign-runner.ts --live-verify <slug>
 *
 * Idempotence contract: unchanged content hash => no writes, no revision bump.
 * All sidecar writes are temp-file+rename; index.json is fully regenerated from a
 * directory scan, never patched.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import {
  tupleCV,
  stringAsciiCV,
  uintCV,
  bufferCV,
  principalCV,
  signStructuredData,
  encodeStructuredDataBytes,
  publicKeyFromSignatureRsv,
  getAddressFromPublicKey,
} from "@stacks/transactions";
import { getCredential } from "../../src/credentials.ts";
import { getWalletManager } from "../../github/aibtcdev/skills/src/lib/services/wallet-manager.js";
import {
  generateWallet,
  generateNewAccount,
  getStxAddress,
} from "../../github/aibtcdev/skills/node_modules/@stacks/wallet-sdk/dist/esm/index.js";

const SITE = join(import.meta.dir, "../../github/arc0btc/arc0me-site");
const BLOG_DIR = join(SITE, "src/content/docs/blog");
const VERIFY_DIR = join(SITE, "public/verify");
const STATE_FILE = join(import.meta.dir, "sign-state.json");

const IDENTITY_ADDRESS = "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B";
const IDENTITY_BNS = "arc0.btc";
const SIGNING_DERIVATION_INDEX = 1;
const CANON = "v1-full-file";
const DOMAIN_FIELDS = { name: "arc0.me", version: "1", chainId: 1 };
const LIVE_BASE = "https://arc0.me";

const domainCV = tupleCV({
  name: stringAsciiCV(DOMAIN_FIELDS.name),
  version: stringAsciiCV(DOMAIN_FIELDS.version),
  "chain-id": uintCV(DOMAIN_FIELDS.chainId),
});

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function messageHashHex(message: ReturnType<typeof tupleCV>): string {
  return sha256Hex(encodeStructuredDataBytes({ message, domain: domainCV }));
}

function recoverSigner(msgHash: string, signature: string): string {
  const pubKey = publicKeyFromSignatureRsv(msgHash, signature);
  return getAddressFromPublicKey(pubKey, "mainnet");
}

function atomicWriteJson(path: string, data: unknown): void {
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n");
  renameSync(tmp, path);
}

function articleMessageCV(slug: string, contentHashHex: string, revision: number, signedAt: string) {
  return tupleCV({
    slug: stringAsciiCV(slug),
    "content-hash": bufferCV(Buffer.from(contentHashHex, "hex")),
    revision: uintCV(revision),
    "signed-at": stringAsciiCV(signedAt),
    author: principalCV(IDENTITY_ADDRESS),
  });
}

function regenerateIndex(): void {
  const posts: Record<string, { contentHash: string; revision: number; signedAt: string }> = {};
  for (const f of readdirSync(VERIFY_DIR).sort()) {
    if (!f.endsWith(".json") || f === "index.json" || f === "keys.json") continue;
    const rec = JSON.parse(readFileSync(join(VERIFY_DIR, f), "utf-8"));
    if (rec.slug && rec.current) {
      posts[rec.slug] = {
        contentHash: rec.current.contentHash,
        revision: rec.current.revision,
        signedAt: rec.current.signedAt,
      };
    }
  }
  atomicWriteJson(join(VERIFY_DIR, "index.json"), {
    canon: CANON,
    domain: DOMAIN_FIELDS,
    generatedAt: new Date().toISOString(),
    posts,
  });
}

async function deriveAccounts() {
  const walletId = await getCredential("bitcoin-wallet", "id");
  const password = await getCredential("bitcoin-wallet", "password");
  if (!walletId || !password) throw new Error("bitcoin-wallet id/password not found in credential store");

  const mnemonic = await getWalletManager().exportMnemonic(walletId, password);
  let wallet = await generateWallet({ secretKey: mnemonic, password: "" });
  while (wallet.accounts.length <= SIGNING_DERIVATION_INDEX) {
    wallet = generateNewAccount(wallet);
  }
  const identityAddress = getStxAddress(wallet.accounts[0], "mainnet");
  if (identityAddress !== IDENTITY_ADDRESS) {
    throw new Error(`wallet integrity check failed: index-0 address ${identityAddress} != expected ${IDENTITY_ADDRESS}`);
  }
  const signingAccount = wallet.accounts[SIGNING_DERIVATION_INDEX];
  return {
    identityKey: wallet.accounts[0].stxPrivateKey,
    signingKey: signingAccount.stxPrivateKey,
    signingAddress: getStxAddress(signingAccount, "mainnet"),
  };
}

function loadKeys(): { signing: { address: string } } {
  const path = join(VERIFY_DIR, "keys.json");
  if (!existsSync(path)) throw new Error("keys.json missing — run --keys first");
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function cmdKeys(dryRun: boolean): Promise<void> {
  const { identityKey, signingAddress } = await deriveAccounts();
  const keysPath = join(VERIFY_DIR, "keys.json");

  if (existsSync(keysPath)) {
    const existing = JSON.parse(readFileSync(keysPath, "utf-8"));
    if (existing.signing?.address === signingAddress) {
      console.log(JSON.stringify({ success: true, action: "noop", reason: "keys.json already attests this signing key", signingAddress }));
      return;
    }
  }
  if (dryRun) {
    console.log(JSON.stringify({ success: true, action: "dry-run", identityAddress: IDENTITY_ADDRESS, signingAddress }));
    return;
  }

  const attestedAt = new Date().toISOString();
  const message = tupleCV({
    action: stringAsciiCV("key-attestation"),
    identity: principalCV(IDENTITY_ADDRESS),
    "signing-key": principalCV(signingAddress),
    "attested-at": stringAsciiCV(attestedAt),
  });
  const signature = signStructuredData({ message, domain: domainCV, privateKey: identityKey });
  const recovered = recoverSigner(messageHashHex(message), signature);
  if (recovered !== IDENTITY_ADDRESS) {
    throw new Error(`attestation self-check failed: recovered ${recovered} != ${IDENTITY_ADDRESS}`);
  }

  mkdirSync(VERIFY_DIR, { recursive: true });
  atomicWriteJson(keysPath, {
    canon: CANON,
    domain: DOMAIN_FIELDS,
    identity: { address: IDENTITY_ADDRESS, bns: IDENTITY_BNS },
    signing: { address: signingAddress, derivationIndex: SIGNING_DERIVATION_INDEX },
    attestation: {
      message: { action: "key-attestation", identity: IDENTITY_ADDRESS, signingKey: signingAddress, attestedAt },
      signature,
    },
    createdAt: attestedAt,
  });
  console.log(JSON.stringify({ success: true, action: "keys-written", identityAddress: IDENTITY_ADDRESS, signingAddress }));
}

async function cmdSign(slug: string): Promise<void> {
  const sourcePath = join(BLOG_DIR, `${slug}.mdx`);
  if (!existsSync(sourcePath)) throw new Error(`post source not found: ${sourcePath}`);
  const contentHash = sha256Hex(readFileSync(sourcePath));

  const sidecarPath = join(VERIFY_DIR, `${slug}.json`);
  let revision = 1;
  if (existsSync(sidecarPath)) {
    const existing = JSON.parse(readFileSync(sidecarPath, "utf-8"));
    if (existing.current?.contentHash === contentHash) {
      console.log(JSON.stringify({ success: true, action: "noop", reason: "content hash unchanged", slug, contentHash, revision: existing.current.revision }));
      return;
    }
    revision = (existing.current?.revision ?? 0) + 1;
  }

  const keys = loadKeys();
  const { signingKey, signingAddress } = await deriveAccounts();
  if (signingAddress !== keys.signing.address) {
    throw new Error(`derived signing key ${signingAddress} does not match attested key ${keys.signing.address}`);
  }

  const signedAt = new Date().toISOString();
  const message = articleMessageCV(slug, contentHash, revision, signedAt);
  const signature = signStructuredData({ message, domain: domainCV, privateKey: signingKey });
  const recovered = recoverSigner(messageHashHex(message), signature);
  if (recovered !== signingAddress) {
    throw new Error(`signature self-check failed: recovered ${recovered} != ${signingAddress}`);
  }

  atomicWriteJson(sidecarPath, {
    slug,
    canon: CANON,
    domain: DOMAIN_FIELDS,
    author: IDENTITY_ADDRESS,
    signer: signingAddress,
    current: { contentHash, revision, signedAt, signature },
    reserved: { prevRecordHash: null, anchor: null, nostrPubkey: null },
  });
  regenerateIndex();
  console.log(JSON.stringify({ success: true, action: "signed", slug, contentHash, revision, signedAt, signer: signingAddress }));
}

async function cmdLiveVerify(slug: string): Promise<void> {
  const sidecarPath = join(VERIFY_DIR, `${slug}.json`);
  if (!existsSync(sidecarPath)) throw new Error(`no sidecar for ${slug}`);
  const sidecar = JSON.parse(readFileSync(sidecarPath, "utf-8"));

  const res = await fetch(`${LIVE_BASE}/blog/${slug}.md`);
  if (!res.ok) throw new Error(`live fetch failed: ${res.status} ${LIVE_BASE}/blog/${slug}.md`);
  const servedHash = sha256Hex(new Uint8Array(await res.arrayBuffer()));

  const hashMatch = servedHash === sidecar.current.contentHash;
  // Full check B/C against LIVE bytes: rebuild the tuple from the served hash so a
  // wrong byte fails signature recovery by construction.
  const message = articleMessageCV(slug, servedHash, sidecar.current.revision, sidecar.current.signedAt);
  const recovered = recoverSigner(messageHashHex(message), sidecar.current.signature);
  const sigMatch = recovered === sidecar.signer;

  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : { liveVerified: {} };
  const pass = hashMatch && sigMatch;
  if (pass) {
    state.liveVerified[slug] = { at: new Date().toISOString(), contentHash: servedHash, revision: sidecar.current.revision };
    atomicWriteJson(STATE_FILE, state);
  }
  console.log(JSON.stringify({ success: pass, action: "live-verify", slug, hashMatch, sigMatch, servedHash, signedHash: sidecar.current.contentHash, recoveredSigner: recovered, expectedSigner: sidecar.signer }));
  if (!pass) process.exit(1);
}

const args = process.argv.slice(2);
try {
  if (args[0] === "--keys") {
    await cmdKeys(args.includes("--dry-run"));
  } else if (args[0] === "--slug" && args[1]) {
    await cmdSign(args[1]);
  } else if (args[0] === "--live-verify" && args[1]) {
    await cmdLiveVerify(args[1]);
  } else {
    console.log("usage: sign-runner.ts --keys [--dry-run] | --slug <slug> | --live-verify <slug>");
    process.exit(1);
  }
} catch (e) {
  console.log(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
