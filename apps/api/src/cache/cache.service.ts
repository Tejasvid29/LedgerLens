import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CachePolicy } from './cache.policy';
import { LatencyStats, LatencyTracker } from '../metrics/latency-tracker';

export interface CacheMetrics {
  /** Served from cache within its fresh window. */
  hits: number;
  /** Served from cache past TTL, with a background refresh kicked off. */
  staleHits: number;
  misses: number;
  /** Redis operations that failed. A cache outage shows up here, not as a 500. */
  errors: number;
  /** Requests that skipped Redis entirely because the circuit was open. */
  shortCircuited: number;
  /** hits / (hits + staleHits + misses) — stale counts as a hit, it was served from cache. */
  hitRate: number;
}

export type CacheState = 'fresh' | 'stale' | 'miss';

export interface CacheLookup<T> {
  value: T | null;
  state: CacheState;
  ageSeconds: number | null;
}

/** Minimal surface this service needs — lets tests substitute a fake. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', ttl: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  quit(): Promise<unknown>;
}

/** What actually goes into Redis. `s` is the store time, for age math. */
interface Envelope<T> {
  s: number;
  value: T;
}

/**
 * Consecutive Redis failures before the circuit opens. Low, because the
 * failure we're protecting against (Redis down) is persistent, not flaky —
 * there is no value in retrying it dozens of times per second.
 */
const FAILURE_THRESHOLD = 3;

/** How long the circuit stays open before probing Redis again. */
const CIRCUIT_RESET_MS = 5_000;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: RedisLike;

  private hits = 0;
  private staleHits = 0;
  private misses = 0;
  private errors = 0;
  private shortCircuited = 0;

  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  /** Redis round-trip latency (lookup/set/del). */
  private readonly cacheLatency = new LatencyTracker();
  /** loader() latency — the origin (Postgres) side of a miss or a revalidation. */
  private readonly originLatency = new LatencyTracker();

  /**
   * Keys with a background revalidation already running. Without this, N
   * concurrent requests arriving on a stale key would each start their own
   * refresh — a stampede against Postgres at exactly the moment the cache
   * stopped absorbing load.
   */
  private readonly revalidating = new Set<string>();

  constructor(
    private readonly config: ConfigService,
    @Optional() client?: RedisLike,
  ) {
    if (client) {
      this.redis = client;
      return;
    }

    const url = this.config.get<string>('REDIS_URL', 'redis://localhost:6379');
    const redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true });
    redis.on('error', () => {
      // ioredis emits 'error' on every reconnect attempt. Unhandled, these
      // crash the process — the opposite of rule 3. Failures are counted at
      // the call site instead, where we know which operation was affected.
    });
    redis.connect().catch(() => {
      // Redis is optional in local dev without docker. Rule 3: fail open.
    });
    this.redis = redis as unknown as RedisLike;
  }

  /**
   * Reads a key and reports whether it is fresh, stale, or absent.
   *
   * Stale means past `policy.ttlSeconds` but still inside `staleSeconds` —
   * servable now, refresh in the background. Redis holds the entry for
   * ttl + stale, so anything it returns is at worst `stale`.
   */
  async lookup<T>(key: string, policy: CachePolicy): Promise<CacheLookup<T>> {
    if (this.isCircuitOpen()) {
      this.shortCircuited++;
      this.misses++;
      return { value: null, state: 'miss', ageSeconds: null };
    }

    let raw: string | null;
    const start = Date.now();
    try {
      raw = await this.redis.get(key);
      this.cacheLatency.record(Date.now() - start);
      this.recordSuccess();
    } catch {
      this.cacheLatency.record(Date.now() - start);
      this.recordFailure();
      this.misses++;
      return { value: null, state: 'miss', ageSeconds: null };
    }

    if (raw == null) {
      this.misses++;
      return { value: null, state: 'miss', ageSeconds: null };
    }

    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(raw) as Envelope<T>;
    } catch {
      // Corrupt or pre-envelope entry. Treat as a miss rather than serving
      // something we can't reason about.
      this.misses++;
      return { value: null, state: 'miss', ageSeconds: null };
    }

    const ageSeconds = Math.max(0, Math.floor((Date.now() - envelope.s) / 1000));

    if (ageSeconds <= policy.ttlSeconds) {
      this.hits++;
      return { value: envelope.value, state: 'fresh', ageSeconds };
    }

    this.staleHits++;
    return { value: envelope.value, state: 'stale', ageSeconds };
  }

  /**
   * Stale-while-revalidate around a loader.
   *
   * fresh → return cached.
   * stale → return cached immediately, refresh in the background.
   * miss  → await the loader, cache it, return it.
   *
   * Never throws on cache trouble; a Redis failure degrades this to calling
   * the loader directly (rule 3).
   */
  async swr<T>(key: string, policy: CachePolicy, loader: () => Promise<T>): Promise<T> {
    const found = await this.lookup<T>(key, policy);

    if (found.state === 'fresh') {
      return found.value as T;
    }

    if (found.state === 'stale') {
      this.revalidateInBackground(key, policy, loader);
      return found.value as T;
    }

    const value = await this.timedLoad(loader);
    await this.set(key, value, policy);
    return value;
  }

  /** Times a call to the origin (Postgres, via the caller's loader). */
  private async timedLoad<T>(loader: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await loader();
    } finally {
      this.originLatency.record(Date.now() - start);
    }
  }

  private revalidateInBackground<T>(
    key: string,
    policy: CachePolicy,
    loader: () => Promise<T>,
  ): void {
    if (this.revalidating.has(key)) return;
    this.revalidating.add(key);

    void this.timedLoad(loader)
      .then((value) => this.set(key, value, policy))
      .catch((err) => {
        // The caller already has a usable stale value; a failed refresh means
        // the next request retries, not that this one fails.
        this.logger.warn(`Background revalidation failed for ${key}: ${err}`);
      })
      .finally(() => {
        this.revalidating.delete(key);
      });
  }

  /** Stores a value with a physical expiry of ttl + stale. */
  async set(key: string, value: unknown, policy: CachePolicy): Promise<void> {
    if (this.isCircuitOpen()) {
      this.shortCircuited++;
      return;
    }

    const envelope: Envelope<unknown> = { s: Date.now(), value };
    const physicalTtl = policy.ttlSeconds + policy.staleSeconds;
    const start = Date.now();

    try {
      await this.redis.set(key, JSON.stringify(envelope), 'EX', physicalTtl);
      this.cacheLatency.record(Date.now() - start);
      this.recordSuccess();
    } catch {
      // Fail open — the caller already has the value it tried to cache.
      this.cacheLatency.record(Date.now() - start);
      this.recordFailure();
    }
  }

  /** Deletes one or more keys. Invalidating nothing is a no-op, not an error. */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    if (this.isCircuitOpen()) {
      this.shortCircuited++;
      return;
    }

    const start = Date.now();
    try {
      await this.redis.del(...keys);
      this.cacheLatency.record(Date.now() - start);
      this.recordSuccess();
    } catch {
      this.cacheLatency.record(Date.now() - start);
      this.recordFailure();
    }
  }

  getMetrics(): CacheMetrics {
    const total = this.hits + this.staleHits + this.misses;
    return {
      hits: this.hits,
      staleHits: this.staleHits,
      misses: this.misses,
      errors: this.errors,
      shortCircuited: this.shortCircuited,
      hitRate: total === 0 ? 0 : (this.hits + this.staleHits) / total,
    };
  }

  /** Per-layer latency: the Redis round-trip vs. the origin (Postgres) query. */
  getLatency(): { cache: LatencyStats; origin: LatencyStats } {
    return { cache: this.cacheLatency.stats(), origin: this.originLatency.stats() };
  }

  /** Test seam. Metrics are process-lifetime counters otherwise. */
  resetMetrics(): void {
    this.hits = 0;
    this.staleHits = 0;
    this.misses = 0;
    this.errors = 0;
    this.shortCircuited = 0;
    this.cacheLatency.reset();
    this.originLatency.reset();
  }

  /**
   * With Redis down, every call would otherwise pay ioredis's retry budget
   * before failing open. Rule 3 says an outage degrades latency — it should
   * not degrade it on every single request for the duration of the outage.
   */
  private isCircuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private recordFailure(): void {
    this.errors++;
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.circuitOpenUntil = Date.now() + CIRCUIT_RESET_MS;
      this.consecutiveFailures = 0;
      this.logger.warn(`Redis unreachable — bypassing cache for ${CIRCUIT_RESET_MS}ms`);
    }
  }

  private recordSuccess(): void {
    this.consecutiveFailures = 0;
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      // Already disconnected, or never connected.
    }
  }
}
