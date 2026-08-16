/**
 * Measures OpenAI spend with the semantic cache off vs on, over the same
 * request set, and reports the delta.
 *
 *   npm run measure:insight-spend -w @ledgerlens/api
 *   npm run measure:insight-spend -w @ledgerlens/api -- --provider=openai
 *
 * "Same request set, twice" is the realistic case this cache exists for:
 * a user reloads the dashboard, or asks for an insight on a wallet whose
 * data hasn't changed since last time. The request set is the 15 eval
 * fixtures (evals/fixtures.ts) run for two passes each:
 *
 *   cache OFF — calls the provider on every request, both passes. No
 *               caching layer at all, so 2x the cases = 2x the spend.
 *   cache ON  — routed through the exact same generateCachedInsight()
 *               InsightsService uses in production. Pass 1 is all misses
 *               (identical to cache-off's first pass); pass 2 hits the
 *               semantic cache for every case, since each fixture is
 *               deterministic — same request in, same content hash, same
 *               key. Zero provider calls on pass 2.
 *
 * Runs against an in-memory Redis stand-in, same reasoning as
 * run-evals.ts: no docker-compose, no live services, for the default
 * (free) stub provider. --provider=openai still needs a funded API
 * account — see resolve-provider.ts and note that a ChatGPT Plus/Pro
 * subscription does not cover this (separate billing).
 */
import { ConfigService } from '@nestjs/config';
import { CacheService, RedisLike } from '../../cache/cache.service';
import { generateCachedInsight } from '../insight-cache';
import { EVAL_CASES } from './fixtures';
import { resolveProviderFromArgv } from './resolve-provider';
import { InsightProvider } from '../insight-provider.interface';

const PASSES = 2;

/** Minimal in-memory stand-in for Redis — just enough of RedisLike's
 *  contract for CacheService to use as its backing store, so this script
 *  needs no external service to demonstrate the cache's effect. */
class InMemoryRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, _mode: 'EX', ttl: number): Promise<unknown> {
    this.store.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    return 'OK';
  }

  async del(...keys: string[]): Promise<unknown> {
    let count = 0;
    for (const k of keys) if (this.store.delete(k)) count++;
    return count;
  }

  async quit(): Promise<unknown> {
    return undefined;
  }
}

interface PassResult {
  totalTokens: number;
  providerCalls: number;
  cacheHits: number;
}

async function measure(cache: CacheService | null, provider: InsightProvider): Promise<PassResult> {
  let totalTokens = 0;
  let providerCalls = 0;
  let cacheHits = 0;

  for (let pass = 0; pass < PASSES; pass++) {
    for (const evalCase of EVAL_CASES) {
      if (!cache) {
        const result = await provider.generateInsight(evalCase.request);
        providerCalls++;
        totalTokens += result.usage.totalTokens;
        continue;
      }

      const { result, cached } = await generateCachedInsight(cache, provider, evalCase.request);
      if (cached) {
        cacheHits++;
      } else {
        providerCalls++;
        totalTokens += result.usage.totalTokens;
      }
    }
  }

  return { totalTokens, providerCalls, cacheHits };
}

function makeCache(): CacheService {
  // Never touched: the InMemoryRedis client short-circuits CacheService's
  // constructor before it reads REDIS_URL from config.
  const config = { get: () => 'redis://localhost:6379' } as unknown as ConfigService;
  return new CacheService(config, new InMemoryRedis());
}

async function main() {
  const { provider, name } = resolveProviderFromArgv();
  const estimated = name.startsWith('stub');
  const unit = estimated ? 'tokens (estimated)' : 'tokens (billed)';

  console.log(`\nInsight cache spend measurement — provider: ${name}`);
  console.log(
    `Request set: ${EVAL_CASES.length} cases x ${PASSES} passes = ${EVAL_CASES.length * PASSES} requests per mode\n`,
  );

  const off = await measure(null, provider);
  const on = await measure(makeCache(), provider);

  console.log('  Cache OFF');
  console.log(`    provider calls : ${off.providerCalls}`);
  console.log(`    total ${unit} : ${off.totalTokens}`);

  console.log('\n  Cache ON');
  console.log(`    provider calls : ${on.providerCalls}  (cache hits: ${on.cacheHits})`);
  console.log(`    total ${unit} : ${on.totalTokens}`);

  const savedTokens = off.totalTokens - on.totalTokens;
  const savedPct = off.totalTokens === 0 ? 0 : (savedTokens / off.totalTokens) * 100;
  const savedCalls = off.providerCalls - on.providerCalls;

  console.log('\n  Delta (cache off → cache on)');
  console.log(`    provider calls avoided : ${savedCalls}`);
  console.log(`    ${unit} saved : ${savedTokens} (${savedPct.toFixed(1)}%)`);

  if (estimated) {
    console.log(
      '\n  Figures above are estimated (StubInsightProvider, ~4 chars/token) — the stub never calls a real\n' +
        '  model. Re-run with --provider=openai against a funded API account for real billed token counts.\n' +
        '  This script doesn\'t convert tokens to dollars — check platform.openai.com/pricing for current\n' +
        '  per-model rates rather than trust a number hardcoded here to stay accurate over time.\n',
    );
  } else {
    console.log(
      '\n  Figures above are real, billed OpenAI usage. Check platform.openai.com/pricing for current\n' +
        '  per-token rates for this model to convert the token delta above into a dollar figure.\n',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
