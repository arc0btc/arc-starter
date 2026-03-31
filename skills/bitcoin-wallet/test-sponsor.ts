#!/usr/bin/env bun
// Temporary test script to diagnose sponsored transaction issue
import { resolve } from "node:path";
const SKILLS = resolve(import.meta.dir, "../../github/aibtcdev/skills");

const walletId = process.env.WALLET_ID!;
const walletPassword = process.env.WALLET_PASSWORD!;
const sponsorApiKey = process.env.SPONSOR_API_KEY!;

process.stderr.write(`wallet_id: ${walletId?.slice(0, 8)}...\n`);
process.stderr.write(`sponsor_api_key: ${sponsorApiKey?.slice(0, 8)}...\n`);

const { getWalletManager } = await import(`${SKILLS}/src/lib/services/wallet-manager.js`);
const wm = getWalletManager();
await wm.unlock(walletId, walletPassword);
const account = wm.getActiveAccount();

process.stderr.write(`account address: ${account?.address}\n`);
process.stderr.write(`account.sponsorApiKey present: ${!!account?.sponsorApiKey}\n`);

const { getSponsorApiKey } = await import(`${SKILLS}/src/lib/config/sponsor.js`);
const resolvedKey = account?.sponsorApiKey || getSponsorApiKey();
process.stderr.write(`resolved api key present: ${!!resolvedKey}, prefix: ${resolvedKey?.slice(0, 8)}\n`);

// Now test makeContractCall to check serialized transaction
const { makeContractCall, PostConditionMode, uintCV, intCV, stringUtf8CV, bufferCV } = await import(`${SKILLS}/node_modules/@stacks/transactions/dist/index.js`);
const { getStacksNetwork } = await import(`${SKILLS}/src/lib/config/networks.js`);
const { getHiroApi } = await import(`${SKILLS}/src/lib/services/hiro-api.js`);

const network = getStacksNetwork('mainnet');
const hiro = getHiroApi('mainnet');
const accountInfo = await hiro.getAccountInfo(account!.address);
process.stderr.write(`nonce: ${accountInfo.nonce}\n`);

const tx = await makeContractCall({
  contractAddress: 'SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM',
  contractName: 'aibtc-reputation-registry-v1',
  functionName: 'give-feedback',
  functionArgs: [
    uintCV(86),
    intCV(-1),
    uintCV(0),
    stringUtf8CV('signal-review'),
    stringUtf8CV('rejected'),
    stringUtf8CV('aibtc.news/signals/fe6f2fc8-edc1-4680-a321-58c85c79daf2'),
    stringUtf8CV(''),
    bufferCV(Buffer.alloc(32)),
  ],
  senderKey: account!.privateKey,
  network,
  postConditionMode: PostConditionMode.Deny,
  sponsored: true,
  fee: 0n,
  nonce: BigInt(accountInfo.nonce),
});

const serialized = tx.serialize();
process.stderr.write(`serialized type: ${typeof serialized}\n`);
process.stderr.write(`serialized length: ${serialized.length}\n`);
process.stderr.write(`first 20 chars: ${serialized.slice(0, 20)}\n`);
process.stderr.write(`auth type byte (chars 10-12): ${serialized.slice(10, 12)}\n`);

const txValue = serialized.startsWith("0x") ? serialized : "0x" + serialized;
process.stderr.write(`txValue prefix (14 chars): ${txValue.slice(0, 14)}\n`);
process.stderr.write(`All looks correct!\n`);
