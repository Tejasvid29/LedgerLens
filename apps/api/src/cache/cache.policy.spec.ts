import {
  CACHE_POLICIES,
  CACHE_SCHEMA_VERSION,
  describeFreshness,
  FRESHNESS_WINDOW_SECONDS,
  insightKey,
  walletDerivedKeys,
  walletHoldingsKey,
  walletTransactionsKey,
} from './cache.policy';

describe('cache keys', () => {
  it('namespaces every key with the schema version', () => {
    // A shape change to SerializedTransaction/SerializedHolding is a version
    // bump; without the prefix, old entries would parse into the new type as
    // structurally wrong data and survive until TTL expiry.
    expect(walletTransactionsKey('w1').startsWith(`${CACHE_SCHEMA_VERSION}:`)).toBe(true);
    expect(walletHoldingsKey('w1').startsWith(`${CACHE_SCHEMA_VERSION}:`)).toBe(true);
  });

  it('scopes keys to a wallet', () => {
    expect(walletTransactionsKey('w1')).not.toBe(walletTransactionsKey('w2'));
  });

  it('keeps transactions and holdings in separate keys', () => {
    expect(walletTransactionsKey('w1')).not.toBe(walletHoldingsKey('w1'));
  });

  it('lists every derived key so invalidation cannot miss one', () => {
    const keys = walletDerivedKeys('w1');

    expect(keys).toContain(walletTransactionsKey('w1'));
    expect(keys).toContain(walletHoldingsKey('w1'));
  });

  it('namespaces insight keys with the schema version too, scoped to the content hash given', () => {
    expect(insightKey('abc').startsWith(`${CACHE_SCHEMA_VERSION}:`)).toBe(true);
    expect(insightKey('abc')).not.toBe(insightKey('def'));
  });
});

describe('cache policies', () => {
  it('gives holdings and transactions identical lifetimes', () => {
    // They are two views of the same rows. If holdings outlived transactions,
    // the UI could list a transfer the balance above it does not include.
    expect(CACHE_POLICIES.walletHoldings).toEqual(CACHE_POLICIES.walletTransactions);
  });

  it('allows a stale window, so SWR has something to serve', () => {
    expect(CACHE_POLICIES.walletTransactions.staleSeconds).toBeGreaterThan(0);
  });

  it('gives insight caching zero stale window — unlike the read-model policies above', () => {
    // Deliberate asymmetry: a stale-served insight would trigger a
    // background-billed OpenAI call with no request to attribute it to.
    // InsightsService treats "not fresh" as a miss for this exact reason —
    // see the comment on CACHE_POLICIES.insight.
    expect(CACHE_POLICIES.insight.staleSeconds).toBe(0);
  });

  it('gives insight caching a longer TTL than the read models — its key is content-addressed, not time-addressed', () => {
    expect(CACHE_POLICIES.insight.ttlSeconds).toBeGreaterThan(CACHE_POLICIES.walletTransactions.ttlSeconds);
  });
});

describe('describeFreshness', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('treats a never-synced wallet as stale', () => {
    expect(describeFreshness(null, now)).toEqual({
      lastSyncedAt: null,
      ageSeconds: null,
      isStale: true,
    });
  });

  it('reports a just-synced wallet as fresh', () => {
    const result = describeFreshness(new Date(now.getTime() - 5_000), now);

    expect(result.isStale).toBe(false);
    expect(result.ageSeconds).toBe(5);
  });

  it('is fresh at exactly the window boundary', () => {
    const at = new Date(now.getTime() - FRESHNESS_WINDOW_SECONDS * 1000);
    expect(describeFreshness(at, now).isStale).toBe(false);
  });

  it('is stale one second past the window', () => {
    const past = new Date(now.getTime() - (FRESHNESS_WINDOW_SECONDS + 1) * 1000);
    expect(describeFreshness(past, now).isStale).toBe(true);
  });

  it('reports age for long-stale data rather than capping it', () => {
    const old = new Date(now.getTime() - 3600 * 1000);
    const result = describeFreshness(old, now);

    expect(result.ageSeconds).toBe(3600);
    expect(result.isStale).toBe(true);
  });

  it('clamps a future lastSyncedAt to zero instead of reporting negative age', () => {
    // Clock skew between instances shouldn't produce "synced -4 seconds ago".
    const future = new Date(now.getTime() + 4000);
    expect(describeFreshness(future, now).ageSeconds).toBe(0);
  });

  it('serializes lastSyncedAt as an ISO string for JSON transport', () => {
    const at = new Date(now.getTime() - 1000);
    expect(describeFreshness(at, now).lastSyncedAt).toBe(at.toISOString());
  });
});
