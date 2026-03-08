// src/identity.ts — Shared identity constants for Loom agent

export const IDENTITY = {
  name: "Loom",
  bns: "loom0.btc",
  btc: "bc1q3qa3xuvk80j4zqnf9e9p7dext9e4jlsv79wgwq",
  stx: "SP3X279HDPCHMB4YN6AHBYX2Y76Q4E20987BN3GHR",
  github: "loom0btc",
  twitter: "",
  website: "arc0.me",
} as const;

export const ARC_BTC_ADDRESS: string = IDENTITY.btc;
export const ARC_STX_ADDRESS: string = IDENTITY.stx;
