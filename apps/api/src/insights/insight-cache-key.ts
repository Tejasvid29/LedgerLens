import { createHash } from 'crypto';
import { InsightRequest } from './insight-provider.interface';

/**
 * "Semantic" cache key: derived from the financial facts an insight is
 * actually about, not from a request identifier or a clock. Two calls
 * hash to the same key when they describe the same wallet label/address,
 * the same holdings, and the same set of recent transactions —
 * regardless of when either call happened, which wallet id made the
 * request, or what order the DB happened to return rows in (sorted below
 * — row order isn't part of the financial meaning being cached, even
 * though it could in principle nudge the literal prompt text).
 *
 * That equivalence is deliberate, not incidental: it means the cache also
 * dedupes across a rename-then-revert, or (in principle) two different
 * wallets that happen to hold identical positions. What actually drives a
 * miss is the financial data changing — a sync that adds a transaction —
 * not the passage of time. Compare to walletHoldingsKey/walletTransactionsKey
 * in cache.policy.ts, which are identifier-keyed (this wallet's current
 * data, whatever it is right now); this key is content-keyed (this exact
 * data, however it got here).
 */
export function hashInsightRequest(request: InsightRequest): string {
  const canonical = {
    address: request.address.toLowerCase(),
    walletLabel: request.walletLabel,
    holdings: sortedLines(
      request.holdings.map((h) => `${h.chainName}|${h.tokenSymbol}|${h.displayBalance}`),
    ),
    recentTransactions: sortedLines(
      request.recentTransactions.map(
        (t) => `${t.chainName}|${t.tokenSymbol}|${t.direction}|${t.displayAmount}|${t.timestamp}`,
      ),
    ),
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Sorted so the same set of holdings/transactions hashes identically
 *  regardless of the order the DB happened to return them in — order is
 *  not part of the financial meaning being cached. */
function sortedLines(lines: string[]): string[] {
  return [...lines].sort();
}
