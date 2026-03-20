/** Wallet balance for a single asset */
export interface AssetBalance {
  asset: "btc" | "stx" | "sbtc";
  balance: number;
  /** Human-readable denomination (e.g. "BTC", "STX", "sBTC") */
  denomination: string;
  /** Balance in smallest unit (sats, micro-STX, sats for sBTC) */
  rawBalance: bigint;
}

/** Complete treasury snapshot at a point in time */
export interface TreasurySnapshot {
  timestamp: string;
  btcAddress: string;
  stxAddress: string;
  balances: AssetBalance[];
}

/** Row stored in balance_snapshots table */
export interface BalanceSnapshotRow {
  id: number;
  timestamp: string;
  btc_sats: number;
  stx_micro: number;
  sbtc_sats: number;
  btc_address: string;
  stx_address: string;
}

/** Alert thresholds — balances below these trigger alerts */
export interface AlertThresholds {
  /** Minimum BTC in whole units (e.g. 0.0005) */
  btcMin: number;
  /** Minimum STX in whole units (e.g. 10) */
  stxMin: number;
  /** Minimum sBTC in whole units (e.g. 0.0001) */
  sbtcMin: number;
}

/** Result of a balance check */
export interface CheckResult {
  snapshot: TreasurySnapshot;
  thresholds: AlertThresholds;
  belowThreshold: AssetBalance[];
  healthy: boolean;
}

/** Default thresholds */
export const DEFAULT_THRESHOLDS: AlertThresholds = {
  btcMin: 0.0005,
  stxMin: 10,
  sbtcMin: 0.0001,
} satisfies AlertThresholds;

/** Known wallet addresses */
export const WALLET_ADDRESSES = {
  btc: "bc1qktaz6rg5k4smre0wfde2tjs2eupvggpmdz39ku",
  stx: "SP1KGHF33817ZXW27CG50JXWC0Y6BNXAQ4E7YGAHM",
} as const;
