import { ConfigService } from '@nestjs/config';
import { CacheService, RedisLike } from './cache.service';
import { CachePolicy } from './cache.policy';

const POLICY: CachePolicy = { ttlSeconds: 60, staleSeconds: 60 };

/** In-memory Redis stand-in. Expiry is manual so tests never sleep. */
class FakeRedis implements RedisLike {
  store = new Map<string, { value: string; expiresAt: number }>();
  failing = false;
  getCalls = 0;
  setCalls = 0;

  async get(key: string): Promise<string | null> {
    this.getCalls++;
    if (this.failing) throw new Error('ECONNREFUSED');
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'EX', ttl: number): Promise<unknown> {
    this.setCalls++;
    if (this.failing) throw new Error('ECONNREFUSED');
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<unknown> {
    if (this.failing) throw new Error('ECONNREFUSED');
    keys.forEach((k) => this.store.delete(k));
    return keys.length;
  }

  async quit(): Promise<unknown> {
    return 'OK';
  }

  /** Rewrites an entry's stored-at so it reads as `ageSeconds` old. */
  age(key: string, ageSeconds: number): void {
    const entry = this.store.get(key);
    if (!entry) throw new Error(`no entry for ${key}`);
    const parsed = JSON.parse(entry.value);
    parsed.s = Date.now() - ageSeconds * 1000;
    this.store.set(key, { ...entry, value: JSON.stringify(parsed) });
  }
}

function makeService(redis: FakeRedis) {
  return new CacheService(new ConfigService(), redis);
}

/** Lets background revalidation promises settle. */
const flush = () => new Promise((r) => setImmediate(r));

describe('CacheService — basic get/set', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('reports a miss for an absent key', async () => {
    const result = await cache.lookup('nope', POLICY);
    expect(result).toEqual({ value: null, state: 'miss', ageSeconds: null });
  });

  it('round-trips a value as fresh', async () => {
    await cache.set('k', { a: 1 }, POLICY);
    const result = await cache.lookup<{ a: number }>('k', POLICY);

    expect(result.state).toBe('fresh');
    expect(result.value).toEqual({ a: 1 });
  });

  it('caches an empty array rather than treating it as a miss', async () => {
    // A wallet with no transactions is a real answer worth caching — otherwise
    // every load re-queries Postgres to learn there is still nothing.
    await cache.set('k', [], POLICY);
    const result = await cache.lookup<unknown[]>('k', POLICY);

    expect(result.state).toBe('fresh');
    expect(result.value).toEqual([]);
  });

  it('sets a physical TTL of ttl + stale so Redis can still serve stale', async () => {
    await cache.set('k', 'v', POLICY);
    const entry = redis.store.get('k')!;
    const ttlMs = entry.expiresAt - Date.now();

    expect(ttlMs).toBeGreaterThan((POLICY.ttlSeconds + POLICY.staleSeconds - 2) * 1000);
    expect(ttlMs).toBeLessThanOrEqual((POLICY.ttlSeconds + POLICY.staleSeconds) * 1000);
  });

  it('treats a corrupt entry as a miss instead of serving it', async () => {
    redis.store.set('k', { value: 'not json', expiresAt: Date.now() + 60_000 });
    const result = await cache.lookup('k', POLICY);

    expect(result.state).toBe('miss');
  });

  it('deletes multiple keys in one call', async () => {
    await cache.set('a', 1, POLICY);
    await cache.set('b', 2, POLICY);

    await cache.del('a', 'b');

    expect((await cache.lookup('a', POLICY)).state).toBe('miss');
    expect((await cache.lookup('b', POLICY)).state).toBe('miss');
  });

  it('treats deleting nothing as a no-op', async () => {
    await expect(cache.del()).resolves.toBeUndefined();
  });
});

describe('CacheService — freshness states', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('is fresh just inside the TTL', async () => {
    await cache.set('k', 'v', POLICY);
    redis.age('k', POLICY.ttlSeconds - 1);

    expect((await cache.lookup('k', POLICY)).state).toBe('fresh');
  });

  it('is stale just past the TTL', async () => {
    await cache.set('k', 'v', POLICY);
    redis.age('k', POLICY.ttlSeconds + 1);

    const result = await cache.lookup('k', POLICY);
    expect(result.state).toBe('stale');
    expect(result.value).toBe('v'); // still servable
  });

  it('reports age in seconds', async () => {
    await cache.set('k', 'v', POLICY);
    redis.age('k', 90);

    expect((await cache.lookup('k', POLICY)).ageSeconds).toBe(90);
  });
});

describe('CacheService — stale-while-revalidate', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('calls the loader on a miss and caches the result', async () => {
    const loader = jest.fn().mockResolvedValue('loaded');

    const value = await cache.swr('k', POLICY, loader);

    expect(value).toBe('loaded');
    expect(loader).toHaveBeenCalledTimes(1);
    expect((await cache.lookup('k', POLICY)).value).toBe('loaded');
  });

  it('does not call the loader on a fresh hit', async () => {
    await cache.set('k', 'cached', POLICY);
    const loader = jest.fn().mockResolvedValue('loaded');

    const value = await cache.swr('k', POLICY, loader);

    expect(value).toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  it('returns the stale value immediately without awaiting the loader', async () => {
    await cache.set('k', 'stale-value', POLICY);
    redis.age('k', POLICY.ttlSeconds + 5);

    let loaderResolved = false;
    const loader = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      loaderResolved = true;
      return 'fresh-value';
    });

    const value = await cache.swr('k', POLICY, loader);

    // The point of SWR: the caller got an answer before the refresh finished.
    expect(value).toBe('stale-value');
    expect(loaderResolved).toBe(false);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('replaces the stale entry once the background refresh completes', async () => {
    await cache.set('k', 'stale-value', POLICY);
    redis.age('k', POLICY.ttlSeconds + 5);

    await cache.swr('k', POLICY, async () => 'fresh-value');
    await flush();

    const after = await cache.lookup('k', POLICY);
    expect(after.state).toBe('fresh');
    expect(after.value).toBe('fresh-value');
  });

  it('keeps serving the stale value when the background refresh fails', async () => {
    await cache.set('k', 'stale-value', POLICY);
    redis.age('k', POLICY.ttlSeconds + 5);

    const value = await cache.swr('k', POLICY, async () => {
      throw new Error('postgres down');
    });
    await flush();

    // A failed refresh must not surface as a failed request, nor evict the
    // usable value the caller just received.
    expect(value).toBe('stale-value');
    expect((await cache.lookup('k', POLICY)).value).toBe('stale-value');
  });

  it('collapses concurrent revalidations into one loader call (no stampede)', async () => {
    await cache.set('k', 'stale-value', POLICY);
    redis.age('k', POLICY.ttlSeconds + 5);

    const loader = jest.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return 'fresh-value';
    });

    const results = await Promise.all([
      cache.swr('k', POLICY, loader),
      cache.swr('k', POLICY, loader),
      cache.swr('k', POLICY, loader),
    ]);

    expect(results).toEqual(['stale-value', 'stale-value', 'stale-value']);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});

describe('CacheService — fails open (rule 3)', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('reports a miss rather than throwing when Redis is down', async () => {
    redis.failing = true;
    await expect(cache.lookup('k', POLICY)).resolves.toEqual({
      value: null,
      state: 'miss',
      ageSeconds: null,
    });
  });

  it('swallows a failed set — the caller already has the value', async () => {
    redis.failing = true;
    await expect(cache.set('k', 'v', POLICY)).resolves.toBeUndefined();
  });

  it('swallows a failed del', async () => {
    redis.failing = true;
    await expect(cache.del('k')).resolves.toBeUndefined();
  });

  it('still returns data via the loader with Redis down', async () => {
    redis.failing = true;

    const value = await cache.swr('k', POLICY, async () => 'from-postgres');

    // Availability is preserved; only latency degrades.
    expect(value).toBe('from-postgres');
  });

  it('counts Redis failures as errors, not as silent successes', async () => {
    redis.failing = true;
    await cache.lookup('k', POLICY);

    expect(cache.getMetrics().errors).toBeGreaterThan(0);
  });
});

describe('CacheService — circuit breaker', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('stops calling Redis after repeated failures', async () => {
    redis.failing = true;

    // Trip the breaker (threshold is 3).
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);

    const callsWhenTripped = redis.getCalls;
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);

    // Rule 3 says an outage degrades latency — not on every request for its
    // whole duration. Once open, requests skip Redis entirely.
    expect(redis.getCalls).toBe(callsWhenTripped);
    expect(cache.getMetrics().shortCircuited).toBeGreaterThan(0);
  });

  it('still serves data from the loader while the circuit is open', async () => {
    redis.failing = true;
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);

    await expect(cache.swr('k', POLICY, async () => 'from-postgres')).resolves.toBe(
      'from-postgres',
    );
  });

  it('does not trip on failures interrupted by a success', async () => {
    redis.failing = true;
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);

    redis.failing = false;
    await cache.lookup('k', POLICY); // success resets the streak

    redis.failing = true;
    await cache.lookup('k', POLICY);

    const before = redis.getCalls;
    await cache.lookup('k', POLICY);

    // Breaker is for a persistent outage, not two unlucky requests.
    expect(redis.getCalls).toBeGreaterThan(before);
  });
});

describe('CacheService — metrics', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('starts at a zero hit rate rather than dividing by zero', () => {
    expect(cache.getMetrics()).toEqual(
      expect.objectContaining({ hits: 0, misses: 0, hitRate: 0 }),
    );
  });

  it('counts hits, stale hits, and misses separately', async () => {
    await cache.lookup('k', POLICY); // miss
    await cache.set('k', 'v', POLICY);
    await cache.lookup('k', POLICY); // fresh hit
    redis.age('k', POLICY.ttlSeconds + 1);
    await cache.lookup('k', POLICY); // stale hit

    const metrics = cache.getMetrics();
    expect(metrics.misses).toBe(1);
    expect(metrics.hits).toBe(1);
    expect(metrics.staleHits).toBe(1);
  });

  it('counts a stale hit toward the hit rate — it was served from cache', async () => {
    await cache.set('k', 'v', POLICY);
    redis.age('k', POLICY.ttlSeconds + 1);
    await cache.lookup('k', POLICY);

    expect(cache.getMetrics().hitRate).toBe(1);
  });
});

describe('CacheService — per-layer latency', () => {
  let redis: FakeRedis;
  let cache: CacheService;

  beforeEach(() => {
    redis = new FakeRedis();
    cache = makeService(redis);
  });

  it('starts with empty latency for both layers', () => {
    expect(cache.getLatency()).toEqual({
      cache: { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
      origin: { count: 0, avgMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
    });
  });

  it('records a cache-layer sample per lookup, set, and del', async () => {
    await cache.lookup('k', POLICY);
    await cache.set('k', 'v', POLICY);
    await cache.del('k');

    expect(cache.getLatency().cache.count).toBe(3);
  });

  it('records an origin-layer sample only when the loader actually runs', async () => {
    await cache.swr('k', POLICY, async () => 'v'); // miss → loader runs

    expect(cache.getLatency().origin.count).toBe(1);

    await cache.swr('k', POLICY, async () => 'v'); // now fresh → loader skipped

    expect(cache.getLatency().origin.count).toBe(1);
  });

  it('records origin latency for a background revalidation, not just the initial miss', async () => {
    await cache.set('k', 'stale-value', POLICY);
    redis.age('k', POLICY.ttlSeconds + 5);

    await cache.swr('k', POLICY, async () => 'fresh-value');
    await flush();

    expect(cache.getLatency().origin.count).toBe(1);
  });

  it('does not count a short-circuited Redis call as cache latency', async () => {
    redis.failing = true;
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY);
    await cache.lookup('k', POLICY); // trips the breaker

    const countAtTrip = cache.getLatency().cache.count;
    await cache.lookup('k', POLICY); // short-circuited — no real Redis call

    expect(cache.getLatency().cache.count).toBe(countAtTrip);
  });

  it('reset clears latency alongside the counters', async () => {
    await cache.lookup('k', POLICY);
    cache.resetMetrics();

    expect(cache.getLatency().cache.count).toBe(0);
  });
});
