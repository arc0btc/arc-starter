// src/identity.ts — Shared identity constants for Loom agent
//
// Single source of truth for on-chain addresses and identity metadata.
// Import from here instead of hardcoding addresses in individual files.

export const IDENTITY = {
  name: "loom0",
  bns: "loom0.btc",
  // BTC/STX addresses retained from Arc until Loom has its own wallets
  btc_segwit: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
  btc_taproot: "bc1pjkyfm9ttwdv6z3cnmef749z9y2n0avnsptfz506fnw4pda95s7ys3vcap7",
  stx: "SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B",
  github: "loom0btc",
  twitter: "loom0btc",
  website: "",
  // btc kept as alias for backwards compat
  btc: "bc1qlezz2cgktx0t680ymrytef92wxksywx0jaw933",
} as const;

export const ARC_BTC_ADDRESS: string = IDENTITY.btc;
export const ARC_STX_ADDRESS: string = IDENTITY.stx;
