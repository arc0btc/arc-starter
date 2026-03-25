// src/identity.ts — Shared identity constants for Arc agent
//
// Single source of truth for on-chain addresses and identity metadata.
// Detects current agent from hostname and returns the correct identity.
// Import from here instead of hardcoding addresses in individual files.

import { hostname } from "node:os";

export interface WalletAddresses {
  stx: string;
  btc_segwit: string;
  btc_taproot: string;
  label?: string;
}

export interface AgentIdentity {
  name: string;
  bns: string;
  btc_segwit: string;
  btc_taproot: string;
  stx: string;
  github: string;
  twitter: string;
  website: string;
  btc: string;
  legacy_wallets?: WalletAddresses[];
}

const IDENTITIES: Record<string, AgentIdentity> = {
  arc0: {
    name: "arc0",
    bns: "arc0.btc",
    btc_segwit: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
    btc_taproot: "bc1pjkyfm9ttwdv6z3cnmef749z9y2n0avnsptfz506fnw4pda95s7ys3vcap7",
    stx: "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
    github: "arc0btc",
    twitter: "arc0btc",
    website: "arc0.me",
    btc: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
  },
  spark: {
    name: "spark0",
    bns: "spark0.btc",
    btc_segwit: "bc1qk7ksx7y4qnumlqu8d9puk438hyhkaf7l0ag5tn",
    btc_taproot: "bc1px6wua9y6q35zacz3x6jl5hxe7aw9aa2kgemysr0gl6c2ar02kg2qy603pr",
    stx: "SP3CPCZAG3N4MJQC4FZFTBK2VQN31MV2DQ9DFTE6N",
    github: "",
    twitter: "spark0btc",
    website: "",
    btc: "bc1qk7ksx7y4qnumlqu8d9puk438hyhkaf7l0ag5tn",
    legacy_wallets: [
      {
        label: "spark-v0.11",
        stx: "SP12Q1FS2DX4N8C2QYBM0Z2N2DY1EH9EEPMPH9N9X",
        btc_segwit: "bc1qpln8pmwntgtw8a874zkkqdw4585eu4z3vnzhj3",
        btc_taproot: "bc1pzpmfmqgakxmtwaw0w7pfhzskyl9mytkkdd3a3lanzs0zt87ufntsm6peqa",
      },
    ],
  },
  iris: {
    name: "iris0",
    bns: "iris0.btc",
    btc_segwit: "bc1q6savz94q7ps48y78gg3xcfvjhk6jmcgpmftqxe",
    btc_taproot: "bc1pwlwkzral95md6c6gm40ccm2upps79jyvw9rx3pm2z95zz3w2ywrshlgghk",
    stx: "SP215BXCEYDT5NXGMPJJKXQADYQXDX92QHN464Y87",
    github: "",
    twitter: "",
    website: "",
    btc: "bc1q6savz94q7ps48y78gg3xcfvjhk6jmcgpmftqxe",
  },
  loom: {
    name: "loom0",
    bns: "loom0.btc",
    btc_segwit: "bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq",
    btc_taproot: "bc1pym3e83p654kfnkrftpha2xnls0palyjup28pu06vf502h774lmysud3mz0",
    stx: "SP3X279HDPCHMB4YN6AHBYX2Y76Q4E20987BN3GHR",
    github: "",
    twitter: "",
    website: "",
    btc: "bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq",
  },
  forge: {
    name: "forge0",
    bns: "forge0.btc",
    btc_segwit: "bc1q9hme5ayrtqd4s75dqq82g8ezzlhfj2m9efjz4h",
    btc_taproot: "bc1prwt9zrznc26ez87027funclq90pm2wyh2sm695hdxm7ut5afz9ns7fj8v9",
    stx: "SP1BFDFJ3P2TGKF3QN5Z6BTTSSDAG4EXHXZZAYZBM",
    github: "",
    twitter: "",
    website: "",
    btc: "bc1q9hme5ayrtqd4s75dqq82g8ezzlhfj2m9efjz4h",
  },
};

function detectAgent(): string {
  // ARC_AGENT env var takes priority (for testing/override)
  const envAgent = process.env.ARC_AGENT;
  if (envAgent && IDENTITIES[envAgent]) return envAgent;

  const h = hostname().toLowerCase();
  // hostname "arc0btc" or "arc0" → arc0
  if (h.startsWith("arc")) return "arc0";
  // hostname "spark" → spark, "iris" → iris, etc.
  for (const key of Object.keys(IDENTITIES)) {
    if (h.startsWith(key)) return key;
  }
  return "arc0"; // fallback
}

export const AGENT_NAME: string = detectAgent();
export const IDENTITY: AgentIdentity = IDENTITIES[AGENT_NAME];
export const ARC_BTC_ADDRESS: string = IDENTITY.btc;
export const ARC_STX_ADDRESS: string = IDENTITY.stx;

/**
 * Returns all wallets for an agent: primary + legacy.
 * Each entry includes stx, btc_segwit, btc_taproot, and an optional label.
 */
export function getAgentWallets(agentName: string): WalletAddresses[] {
  const identity = IDENTITIES[agentName];
  if (!identity) return [];

  const primary: WalletAddresses = {
    label: "primary",
    stx: identity.stx,
    btc_segwit: identity.btc_segwit,
    btc_taproot: identity.btc_taproot,
  };

  return [primary, ...(identity.legacy_wallets ?? [])];
}
