#!/usr/bin/env bun
// Generates an ephemeral bc1q keypair and signs a message with BIP-322.
// Used by smoke-x402-signal.ts step 2 (unregistered identity test).
// Usage: bun scripts/_ephemeral-sign.ts "<message>"

import { secp256k1 } from "../github/aibtcdev/skills/node_modules/@noble/curves/secp256k1.js";
import { sha256 } from "../github/aibtcdev/skills/node_modules/@noble/hashes/sha2.js";

const hashSha256Sync = (data: Uint8Array): Uint8Array => sha256(data);
import {
  Transaction,
  p2wpkh,
  Script,
  RawWitness,
  RawTx,
  NETWORK as BTC_MAINNET,
} from "../github/aibtcdev/skills/node_modules/@scure/btc-signer/index.js";
import { randomBytes } from "node:crypto";

function doubleSha256(data: Uint8Array): Uint8Array {
  return hashSha256Sync(hashSha256Sync(data));
}
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let i = 0; for (const a of arrays) { out.set(a, i); i += a.length; }
  return out;
}
function taggedHash(tag: string, data: Uint8Array): Uint8Array {
  const tagHash = hashSha256Sync(new TextEncoder().encode(tag));
  return hashSha256Sync(concatBytes(tagHash, tagHash, data));
}
function bip322TaggedHash(message: string): Uint8Array {
  return taggedHash("BIP0322-signed-message", new TextEncoder().encode(message));
}
function bip322BuildToSpendTxId(message: string, scriptPubKey: Uint8Array): Uint8Array {
  const msgHash = bip322TaggedHash(message);
  const scriptSig = concatBytes(new Uint8Array([0x00, 0x20]), msgHash);
  const rawTx = RawTx.encode({
    version: 0,
    segwitFlag: false,
    inputs: [{ txid: new Uint8Array(32), index: 0xffffffff, finalScriptSig: scriptSig, sequence: 0 }],
    outputs: [{ amount: 0n, script: scriptPubKey }],
    witnesses: [],
    lockTime: 0,
  });
  return doubleSha256(rawTx).reverse();
}
function bip322Sign(message: string, privateKey: Uint8Array, scriptPubKey: Uint8Array): string {
  const toSpendTxid = bip322BuildToSpendTxId(message, scriptPubKey);
  const toSignTx = new Transaction({ version: 0, lockTime: 0, allowUnknownOutputs: true });
  toSignTx.addInput({
    txid: toSpendTxid,
    index: 0,
    sequence: 0,
    witnessUtxo: { amount: 0n, script: scriptPubKey },
  });
  toSignTx.addOutput({ script: Script.encode(["RETURN"]), amount: 0n });
  toSignTx.signIdx(privateKey, 0);
  toSignTx.finalizeIdx(0);
  const input = toSignTx.getInput(0);
  if (!input.finalScriptWitness) throw new Error("BIP-322 signing failed: no witness produced");
  return Buffer.from(RawWitness.encode(input.finalScriptWitness)).toString("base64");
}

const message = process.argv[2];
if (!message) { console.error("usage: _ephemeral-sign.ts <message>"); process.exit(1); }

const priv: Uint8Array = new Uint8Array(randomBytes(32));
const pub = secp256k1.getPublicKey(priv, true);
const pay = p2wpkh(pub, BTC_MAINNET);
const signature = bip322Sign(message, priv, pay.script);

console.log(JSON.stringify({ address: pay.address, signature, message }));
