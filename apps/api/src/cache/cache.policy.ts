/**
 * Cache key registry and TTL policy.
 *
 * Two independent staleness axes, deliberately kept separate:
 *
 *   cache → DB   How stale the cached copy is versus Postgres. Bounded by TTL.
 *   DB → chain   How stale Postgres is versus Alchemy. Bounded by sync
 *                frequency, NOT by TTL. See FRESHNESS_WINDOW_SECONDS.
 *
 * The second axis dominates: if the last sync was 40 minutes ago, a 60s TTL
 * and a 600s TTL serve equally stale data. TTL is the cheap axis — it decides
 * how much Postgres load we shed, not how current the numbers are.
 */

/**
 * Bumped when a cached value's serialized shape changes.
 *
 * Without this, deploying a change to SerializedTransaction/SerializedHolding
 * leaves entries in Redis that JSON.parse into the *new* type as structurally
 * wrong data — a silent corruption that survives until TTL expiry. Bumping the
 * version turns that deploy into a cache miss instead.
 */
export const CACHE_SCHEMA_VERSION = 'v1';

export interface CachePolicy {
  /** Seconds an entry is served without revalidation. */
  ttlSeconds: number;
  /**
   * Seconds past `ttlSeconds` an entry is still served — immediately, while a
   * refresh runs in the background. Bounds worst-case staleness at
   * ttlSeconds + staleSeconds.
   */
  staleSeconds: number;
}

/**
 * Wallet-scoped read models, both derived from the same Transaction rows.
 *
 * TTL is a safety net, not the primary invalidation mechanism: SyncService
 * invalidates explicitly after every sync (see WalletsService.invalidateCache).
 * TTL only matters when that invalidation is missed — a crashed sync, a failed
 * Redis DEL, or another instance that synced without this one noticing. That
 * argues for a generous TTL rather than a tight one.
 *
 * Holdings and transactions share a policy on purpose. They are two views of
 * one dataset; if holdings outlived transactions, the UI could list a transfer
 * that the balance above it does not include. Cheaper aggregation is not worth
 * a self-contradicting page.
 */
export const CACHE_POLICIES = {
  walletTransactions: { ttlSeconds: 300, staleSeconds: 300 },
  walletHoldings: { ttlSeconds: 300, staleSeconds: 300 },
  /**
   * staleSeconds: 0, deliberately unlike the two policies above. Serving a
   * stale entry while revalidating in the background (the SWR pattern
   * CacheService.swr implements) means the background call runs on its
   * own schedule, detached from any specific request — for a free
   * Postgres read that's a fine trade against load. For an insight, the
   * "background call" is a billed OpenAI request with no request to
   * attribute its cost or its errors to. InsightsService therefore
   * doesn't use swr() for this policy at all; it uses lookup() directly
   * and treats anything not fresh as a miss, so every dollar spent is
   * spent inside a request that's waiting on it. ttlSeconds is generous
   * (1 hour) because the key is content-addressed (see
   * insight-cache-key.ts) — a real miss only happens when the wallet's
   * data actually changes, not on a timer.
   */
  insight: { ttlSeconds: 3600, staleSeconds: 0 },
} as const satisfies Record<string, CachePolicy>;

/**
 * How old stored data may be before it is reported as stale to the caller.
 *
 * This is the DB → chain axis. Crossing it does not trigger anything on its
 * own: the API reports staleness and the user decides whether to sync. Auto-
 * syncing on read would spend Alchemy quota on every page load, including
 * refreshes and bot traffic, for data the user may not have asked to be
 * current.
 *
 * 60s is chosen against user perception, not block time. Every supported chain
 * produces blocks faster than this (Ethereum ~12s, the rest ~2s or below), so
 * a per-chain window would only encode which chain we happen to poll fastest —
 * not when the user's balance actually changed. What actually drives change is
 * user activity, which no window can predict.
 */
export const FRESHNESS_WINDOW_SECONDS = 60;

/**
 * Deliberately NOT cached, and why:
 *
 * - `GET /wallets/chains/supported` — derived from the CHAINS compile-time
 *   constant. A Redis round-trip is strictly slower than reading the in-memory
 *   object it would be caching.
 * - Wallet metadata (`list`, `findById`) — carries `lastSyncedAt`, which is the
 *   freshness indicator itself. A cached "synced 30 seconds ago" that is
 *   actually ten minutes old is worse than a slightly slower query: it makes
 *   the one field users rely on to judge staleness the least trustworthy field
 *   on the page. Both are single indexed lookups.
 */
export const UNCACHED_BY_DESIGN = [
  'chains/supported',
  'wallet metadata (lastSyncedAt)',
] as const;

function key(...parts: (string | number)[]): string {
  return [CACHE_SCHEMA_VERSION, ...parts].join(':');
}

export function walletTransactionsKey(walletId: string): string {
  return key('wallet', walletId, 'transactions');
}

export function walletHoldingsKey(walletId: string): string {
  return key('wallet', walletId, 'holdings');
}

/**
 * Takes an already-computed content hash rather than an InsightRequest —
 * this file stays free of any feature module's domain types (it's a key
 * registry, not a place that knows what an insight is). The hashing logic
 * itself lives in insights/insight-cache-key.ts, which does know.
 */
export function insightKey(contentHash: string): string {
  return key('insight', contentHash);
}

/**
 * Every key derived from a wallet's transactions, for atomic invalidation.
 *
 * Callers should invalidate through this rather than naming keys individually —
 * a key added later is then covered automatically instead of silently
 * outliving the data it was derived from.
 */
export function walletDerivedKeys(walletId: string): string[] {
  return [walletTransactionsKey(walletId), walletHoldingsKey(walletId)];
}

export interface Freshness {
  lastSyncedAt: string | null;
  ageSeconds: number | null;
  /** True when stored data is older than FRESHNESS_WINDOW_SECONDS, or never synced. */
  isStale: boolean;
}

/** Describes how current stored data is, without acting on it. */
export function describeFreshness(
  lastSyncedAt: Date | null | undefined,
  now: Date = new Date(),
): Freshness {
  if (!lastSyncedAt) {
    // Never synced is stale by definition — there is nothing to be fresh about.
    return { lastSyncedAt: null, ageSeconds: null, isStale: true };
  }

  const ageSeconds = Math.max(0, Math.floor((now.getTime() - lastSyncedAt.getTime()) / 1000));

  return {
    lastSyncedAt: lastSyncedAt.toISOString(),
    ageSeconds,
    isStale: ageSeconds > FRESHNESS_WINDOW_SECONDS,
  };
}
