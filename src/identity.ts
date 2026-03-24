// src/identity.ts — Loom agent identity
//
// Single source of truth for Loom's on-chain addresses.
// This VM is always Loom.

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

export const IDENTITY: AgentIdentity = {
  name: "AIBTC Publisher",
  bns: "",
  btc_segwit: "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku",
  btc_taproot: "bc1ptqmds7ghh5lqexzd34xnf5sryxzjvlvuj2eetmhgjkp998545tequsd9we",
  stx: "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM",
  github: "https://github.com/rising-leviathan",
  twitter: "https://x.com/risingleviathan",
  website: "https://aibtc.news",
  btc: "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku",
  legacy_wallets: [
    {
      label: "loom-v0",
      stx: "SP3X279HDPCHMB4YN6AHBYX2Y76Q4E20987BN3GHR",
      btc_segwit: "bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq",
      btc_taproot: "bc1pym3e83p654kfnkrftpha2xnls0palyjup28pu06vf502h774lmysud3mz0",
    },
  ],
};

export const AGENT_NAME = "loom";
export const ARC_BTC_ADDRESS: string = IDENTITY.btc;
export const ARC_STX_ADDRESS: string = IDENTITY.stx;

/**
 * Returns all wallets for Loom: primary + legacy.
 */
export function getAgentWallets(): WalletAddresses[] {
  const primary: WalletAddresses = {
    label: "primary",
    stx: IDENTITY.stx,
    btc_segwit: IDENTITY.btc_segwit,
    btc_taproot: IDENTITY.btc_taproot,
  };
  return [primary, ...(IDENTITY.legacy_wallets ?? [])];
}
