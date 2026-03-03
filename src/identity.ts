// src/identity.ts — Shared identity constants for Arc agent
//
// Single source of truth for on-chain addresses and identity metadata.
// Import from here instead of hardcoding addresses in individual files.

export const IDENTITY = {
  name: "Arc",
  bns: "arc0.btc",
  btc: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
  stx: "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
  github: "arc0btc",
  twitter: "arc0btc",
  website: "arc0.me",
} as const;

export const ARC_BTC_ADDRESS: string = IDENTITY.btc;
export const ARC_STX_ADDRESS: string = IDENTITY.stx;
