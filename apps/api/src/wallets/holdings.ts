import { Direction, TxStatus } from '@ledgerlens/shared';

/** The subset of a stored Transaction that aggregation needs. */
export interface HoldingTransaction {
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string;
  rawValue: string;
  decimals: number;
  direction: Direction;
  status: TxStatus;
  timestamp: Date;
}

export interface AggregatedHolding {
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string;
  /** Base units. Can be negative — see AggregateHoldingsResult. */
  rawBalance: string;
  decimals: number;
}

export type HoldingIssueReason = 'decimals-mismatch' | 'unparseable-value';

export interface HoldingIssue {
  chainId: number;
  tokenAddress: string | null;
  reason: HoldingIssueReason;
  detail?: string;
}

export interface AggregateHoldingsResult {
  holdings: AggregatedHolding[];
  /** Non-fatal problems. Rule 4's spirit, applied at aggregation: collect, never throw. */
  issues: HoldingIssue[];
}

interface Group {
  chainId: number;
  tokenAddress: string | null;
  tokenSymbol: string;
  /** Decimals of the first transaction seen for this token. See groupKey below. */
  decimals: number;
  balance: bigint;
}

/**
 * Aggregates current per-token, per-chain balances from stored transactions.
 *
 * Balance = sum(IN) - sum(OUT), SUCCESS transactions only. FAILED transactions
 * never moved funds on-chain; PENDING hasn't been confirmed yet — including
 * either would misstate a "current" balance. SELF transfers are skipped
 * outright: money leaving and returning to the same wallet nets to zero by
 * construction, so summing them is wasted work, not wrong work.
 *
 * Grouping key is (chainId, tokenAddress), with tokenSymbol standing in only
 * when tokenAddress is null (native transfers, or NFTs with missing contract
 * metadata) — two different null-address tokens on one chain must not merge.
 * This mirrors the DB's `@@unique([walletId, chainId, tokenAddress])`, which
 * assumes one null-tokenAddress holding per chain; if that ever needs to
 * change, this grouping needs to change with it.
 *
 * Balances can come out negative. That means the stored history is missing
 * an inflow — sync started after the wallet already held the token, or a
 * chain failed partway through S4's sync — not that the math is wrong.
 * Clamping to zero would hide that data problem; returning the true sum
 * doesn't.
 *
 * Never throws: a malformed stored row (should not happen — the normalizer
 * only ever writes valid base-10 strings) costs that row and an entry in
 * `issues`, not the whole aggregation.
 */
export function aggregateHoldings(transactions: HoldingTransaction[]): AggregateHoldingsResult {
  const groups = new Map<string, Group>();
  const issues: HoldingIssue[] = [];

  // Ascending timestamp so "the first transaction sets the canonical decimals
  // for this token" and "the most recent transaction's symbol wins" are both
  // well-defined, not dependent on whatever order the DB happened to return.
  const sorted = [...transactions].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
  );

  for (const tx of sorted) {
    if (tx.status !== 'SUCCESS') continue;
    if (tx.direction === 'SELF') continue;

    try {
      applyTransaction(tx, groups, issues);
    } catch (err) {
      issues.push({
        chainId: tx.chainId,
        tokenAddress: tx.tokenAddress,
        reason: 'unparseable-value',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const holdings: AggregatedHolding[] = Array.from(groups.values()).map((g) => ({
    chainId: g.chainId,
    tokenAddress: g.tokenAddress,
    tokenSymbol: g.tokenSymbol,
    rawBalance: g.balance.toString(),
    decimals: g.decimals,
  }));

  return { holdings, issues };
}

function applyTransaction(
  tx: HoldingTransaction,
  groups: Map<string, Group>,
  issues: HoldingIssue[],
): void {
  const key = groupKey(tx.chainId, tx.tokenAddress, tx.tokenSymbol);
  const group = groups.get(key);

  if (group && tx.decimals !== group.decimals) {
    // A token's decimals is a contract-level constant — it should not change
    // transfer to transfer. When Alchemy's metadata disagrees with what we
    // already summed, mixing base units would silently misstate the balance
    // (an 18-orders-of-magnitude class of error, per rule 5). Keep the
    // earlier value canonical for this run and drop the disagreeing row,
    // visibly, rather than guess which reading was right.
    issues.push({
      chainId: tx.chainId,
      tokenAddress: tx.tokenAddress,
      reason: 'decimals-mismatch',
      detail: `expected ${group.decimals} decimals (set by an earlier transaction), got ${tx.decimals}`,
    });
    return;
  }

  // BigInt() throws on a non-numeric string. The normalizer guarantees valid
  // base-10 strings on write, so this should never fire — it exists so a
  // corrupt row degrades to one skipped holding, not a 500.
  const amount = BigInt(tx.rawValue);

  if (!group) {
    groups.set(key, {
      chainId: tx.chainId,
      tokenAddress: tx.tokenAddress,
      tokenSymbol: tx.tokenSymbol,
      decimals: tx.decimals,
      balance: tx.direction === 'IN' ? amount : -amount,
    });
    return;
  }

  group.tokenSymbol = tx.tokenSymbol; // freshest metadata wins (rebrand, casing fix)
  group.balance += tx.direction === 'IN' ? amount : -amount;
}

function groupKey(chainId: number, tokenAddress: string | null, tokenSymbol: string): string {
  return `${chainId}:${tokenAddress ?? `symbol:${tokenSymbol}`}`;
}
