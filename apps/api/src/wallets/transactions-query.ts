import { SerializedTransaction } from '@ledgerlens/shared';

export type TransactionSortField = 'timestamp' | 'chainName' | 'tokenSymbol' | 'amount' | 'direction';
export type SortDirection = 'asc' | 'desc';

const SORT_FIELDS: readonly TransactionSortField[] = [
  'timestamp',
  'chainName',
  'tokenSymbol',
  'amount',
  'direction',
];

export function isTransactionSortField(value: unknown): value is TransactionSortField {
  return typeof value === 'string' && (SORT_FIELDS as readonly string[]).includes(value);
}

export interface TransactionsQueryParams {
  chainId?: number;
  tokenSymbol?: string;
  sort?: TransactionSortField;
  dir?: SortDirection;
  /** 1-based. */
  page?: number;
  pageSize?: number;
}

export interface TransactionsQueryResult {
  transactions: SerializedTransaction[];
  total: number;
  page: number;
  pageSize: number;
  /** Options for populating filter dropdowns — always derived from the full,
   *  unfiltered list, so filtering down to one chain doesn't also remove the
   *  other chains from the dropdown. */
  filters: {
    chains: { chainId: number; chainName: string }[];
    tokens: string[];
  };
}

/**
 * Filters, sorts, and paginates an already-fetched (and already cached —
 * see WalletsService.getTransactions) list of transactions. Deliberately a
 * pure function over data the caller already has in memory, rather than a
 * DB-level query: the cache holds one canonical per-wallet transaction
 * list, and keying that cache per filter/sort/page combination would
 * multiply cache keys for a dataset capped at 500 rows — not worth it.
 */
export function queryTransactions(
  all: SerializedTransaction[],
  params: TransactionsQueryParams,
): TransactionsQueryResult {
  const filters = deriveFilterOptions(all);

  let rows = all;
  if (params.chainId !== undefined) {
    rows = rows.filter((tx) => tx.chainId === params.chainId);
  }
  if (params.tokenSymbol) {
    rows = rows.filter((tx) => tx.tokenSymbol === params.tokenSymbol);
  }

  const sort = isTransactionSortField(params.sort) ? params.sort : 'timestamp';
  const dir: SortDirection = params.dir === 'asc' ? 'asc' : 'desc';
  const sign = dir === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => sign * compare(a, b, sort));

  const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? Math.floor(params.pageSize) : 500;
  const start = (page - 1) * pageSize;
  const transactions = sorted.slice(start, start + pageSize);

  return { transactions, total: sorted.length, page, pageSize, filters };
}

function compare(a: SerializedTransaction, b: SerializedTransaction, field: TransactionSortField): number {
  switch (field) {
    case 'timestamp':
      return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    case 'chainName':
      return a.chainName.localeCompare(b.chainName);
    case 'tokenSymbol':
      return a.tokenSymbol.localeCompare(b.tokenSymbol);
    case 'direction':
      return a.direction.localeCompare(b.direction);
    case 'amount':
      return compareAmount(a, b);
  }
}

/**
 * Rule 1: never Number() a token amount — 18-decimal values exceed
 * Number.MAX_SAFE_INTEGER. Different tokens can have different `decimals`,
 * so comparing raw base units directly would put (say) 1 USDC's 6-decimal
 * "1000000" ahead of 1 ETH's 18-decimal "1000000000000000000" for the
 * wrong reason. Scaling both to a common 18-decimal precision first, in
 * BigInt, makes the comparison a true magnitude comparison without ever
 * touching floating point.
 */
function compareAmount(a: SerializedTransaction, b: SerializedTransaction): number {
  const scaled = scaleTo18(a.rawValue, a.decimals) - scaleTo18(b.rawValue, b.decimals);
  if (scaled > 0n) return 1;
  if (scaled < 0n) return -1;
  return 0;
}

function scaleTo18(rawValue: string, decimals: number): bigint {
  const value = BigInt(rawValue);
  const diff = 18 - decimals;
  if (diff === 0) return value;
  if (diff > 0) return value * 10n ** BigInt(diff);
  return value / 10n ** BigInt(-diff);
}

function deriveFilterOptions(all: SerializedTransaction[]): TransactionsQueryResult['filters'] {
  const chains = new Map<number, string>();
  const tokens = new Set<string>();

  for (const tx of all) {
    chains.set(tx.chainId, tx.chainName);
    tokens.add(tx.tokenSymbol);
  }

  return {
    chains: Array.from(chains.entries())
      .map(([chainId, chainName]) => ({ chainId, chainName }))
      .sort((a, b) => a.chainId - b.chainId),
    tokens: Array.from(tokens).sort((a, b) => a.localeCompare(b)),
  };
}
