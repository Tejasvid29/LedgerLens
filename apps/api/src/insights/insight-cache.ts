import { CacheService } from '../cache/cache.service';
import { CACHE_POLICIES, insightKey } from '../cache/cache.policy';
import { InsightProvider, InsightRequest, InsightResult } from './insight-provider.interface';
import { hashInsightRequest } from './insight-cache-key';

export interface CachedInsight {
  result: InsightResult;
  cached: boolean;
}

/**
 * The cache-or-generate decision, factored out of InsightsService so that
 * evals/measure-spend.ts can exercise the exact same logic InsightsService
 * uses in production. A spend-measurement script that reimplemented its
 * own slightly-different version of the caching logic would be measuring
 * something other than what actually runs — this way there's one
 * implementation, used by both.
 *
 * Not swr(): see CACHE_POLICIES.insight's comment. A stale-but-served
 * entry here would mean a background-billed OpenAI call with no request
 * to attribute its cost to, so "not fresh" is treated as a miss.
 */
export async function generateCachedInsight(
  cache: CacheService,
  provider: InsightProvider,
  request: InsightRequest,
): Promise<CachedInsight> {
  const key = insightKey(hashInsightRequest(request));
  const found = await cache.lookup<InsightResult>(key, CACHE_POLICIES.insight);

  if (found.state === 'fresh') {
    return { result: found.value as InsightResult, cached: true };
  }

  const result = await provider.generateInsight(request);
  await cache.set(key, result, CACHE_POLICIES.insight);
  return { result, cached: false };
}
