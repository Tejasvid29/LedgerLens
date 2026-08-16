import { generateCachedInsight } from './insight-cache';
import { CacheService } from '../cache/cache.service';
import { InsightProvider, InsightRequest, InsightResult } from './insight-provider.interface';

function request(overrides: Partial<InsightRequest> = {}): InsightRequest {
  return { walletLabel: 'Main', address: '0xabc', holdings: [], recentTransactions: [], ...overrides };
}

const RESULT: InsightResult = {
  summary: 'Summary.',
  model: 'test',
  generatedAt: '2024-01-01T00:00:00.000Z',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

function makeFakeCache() {
  return {
    lookup: jest.fn().mockResolvedValue({ value: null, state: 'miss', ageSeconds: null }),
    set: jest.fn().mockResolvedValue(undefined),
  };
}

describe('generateCachedInsight', () => {
  it('calls the provider and caches the result on a miss', async () => {
    const cache = makeFakeCache();
    const provider = { generateInsight: jest.fn().mockResolvedValue(RESULT) };

    const outcome = await generateCachedInsight(
      cache as unknown as CacheService,
      provider as unknown as InsightProvider,
      request(),
    );

    expect(provider.generateInsight).toHaveBeenCalledWith(request());
    expect(cache.set).toHaveBeenCalledWith(expect.any(String), RESULT, expect.any(Object));
    expect(outcome).toEqual({ result: RESULT, cached: false });
  });

  it('returns the cached value without calling the provider on a fresh hit', async () => {
    const cache = {
      lookup: jest.fn().mockResolvedValue({ value: RESULT, state: 'fresh', ageSeconds: 5 }),
      set: jest.fn(),
    };
    const provider = { generateInsight: jest.fn() };

    const outcome = await generateCachedInsight(
      cache as unknown as CacheService,
      provider as unknown as InsightProvider,
      request(),
    );

    expect(provider.generateInsight).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(outcome).toEqual({ result: RESULT, cached: true });
  });

  it('treats a stale entry as a miss — calls the provider rather than serving it', async () => {
    // Deliberate: unlike swr(), a stale insight is not served. See
    // CACHE_POLICIES.insight's comment on why a billed call shouldn't run
    // in the background, detached from any specific request.
    const cache = {
      lookup: jest.fn().mockResolvedValue({ value: RESULT, state: 'stale', ageSeconds: 9999 }),
      set: jest.fn().mockResolvedValue(undefined),
    };
    const freshResult = { ...RESULT, summary: 'Freshly generated.' };
    const provider = { generateInsight: jest.fn().mockResolvedValue(freshResult) };

    const outcome = await generateCachedInsight(
      cache as unknown as CacheService,
      provider as unknown as InsightProvider,
      request(),
    );

    expect(provider.generateInsight).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ result: freshResult, cached: false });
  });

  it('looks up and stores under the same key for the same request', async () => {
    const cache = makeFakeCache();
    const provider = { generateInsight: jest.fn().mockResolvedValue(RESULT) };

    await generateCachedInsight(cache as unknown as CacheService, provider as unknown as InsightProvider, request());

    const lookupKey = cache.lookup.mock.calls[0][0];
    const setKey = cache.set.mock.calls[0][0];
    expect(lookupKey).toBe(setKey);
  });
});
