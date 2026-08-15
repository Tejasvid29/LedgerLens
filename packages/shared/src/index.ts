export type Direction = 'IN' | 'OUT' | 'SELF';
export type TxStatus = 'SUCCESS' | 'FAILED' | 'PENDING';

/** Internal shape after normalization (API ingest layer). */
export interface NormalizedTransaction {
  chainId: number;
  hash: string;
  blockNumber: bigint;
  timestamp: Date;
  direction: Direction;
  rawValue: string;
  decimals: number;
  tokenSymbol: string;
  tokenAddress: string | null;
  gasUsed: string | null;
  gasPriceWei: string | null;
  status: TxStatus;
}

/** JSON-safe transaction returned by the API to the web app. */
export interface SerializedTransaction {
  id: string;
  chainId: number;
  chainName: string;
  hash: string;
  blockNumber: string;
  timestamp: string;
  direction: Direction;
  rawValue: string;
  decimals: number;
  displayAmount: string;
  tokenSymbol: string;
  tokenAddress: string | null;
  status: TxStatus;
}

export interface WalletSummary {
  id: string;
  address: string;
  label: string | null;
  lastSyncedAt: string | null;
  _count?: { transactions: number };
}

export { formatAmount } from './amounts';
