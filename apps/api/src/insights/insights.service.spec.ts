import { Logger } from '@nestjs/common';
import { InsightsService } from './insights.service';
import { WalletsService } from '../wallets/wallets.service';
import { CacheService } from '../cache/cache.service';
import { InsightProvider, InsightRequest, InsightResult } from './insight-provider.interface';
import { SerializedHolding, SerializedTransaction } from '@ledgerlens/shared';

function makeHolding(overrides: Partial<SerializedHolding> = {}): SerializedHolding {
  return {
    chainId: 1,
    chainName: 'Ethereum',
    tokenAddress: null,
    tokenSymbol: 'ETH',
    rawBalance: '1000000000000000000',
    decimals: 18,
    displayBalance: '1',
    ...overrides,
  };
}

function makeTx(overrides: Partial<SerializedTransaction> = {}): SerializedTransaction {
  return {
    id: 't1',
    chainId: 1,
    chainName: 'Ethereum',
    hash: '0xhash',
    blockNumber: '1',
    timestamp: '2024-01-01T00:00:00.000Z',
    direction: 'IN',
    rawValue: '1000000000000000000',
    decimals: 18,
    displayAmount: '1',
    tokenSymbol: 'ETH',
    tokenAddress: null,
    status: 'SUCCESS',
    ...overrides,
  };
}

const USAGE = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };

/** Minimal in-memory stand-in for CacheService's lookup/set contract —
 *  real enough that these tests exercise InsightsService's actual cache
 *  key (hashInsightRequest + insightKey), not a mocked-away shortcut. */
function makeFakeCache() {
  const store = new Map<string, unknown>();
  return {
    lookup: jest.fn(async (key: string) => {
      if (store.has(key)) return { value: store.get(key), state: 'fresh' as const, ageSeconds: 0 };
      return { value: null, state: 'miss' as const, ageSeconds: null };
    }),
    set: jest.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
}

describe('InsightsService.generateForWallet', () => {
  let wallets: { getHoldings: jest.Mock; getTransactions: jest.Mock };
  let cache: ReturnType<typeof makeFakeCache>;
  let provider: { generateInsight: jest.Mock };
  let service: InsightsService;

  beforeEach(() => {
    wallets = {
      getHoldings: jest.fn().mockResolvedValue({ holdings: [], issues: [] }),
      getTransactions: jest.fn().mockResolvedValue([]),
    };
    cache = makeFakeCache();
    provider = {
      generateInsight: jest.fn().mockResolvedValue({
        summary: 'A summary.',
        model: 'test-model',
        generatedAt: '2024-01-01T00:00:00.000Z',
        usage: USAGE,
      } satisfies InsightResult),
    };
    service = new InsightsService(
      wallets as unknown as WalletsService,
      cache as unknown as CacheService,
      provider as unknown as InsightProvider,
    );
  });

  it('fetches holdings and transactions for the given wallet id', async () => {
    await service.generateForWallet('w1', { label: 'Main', address: '0xabc' });

    expect(wallets.getHoldings).toHaveBeenCalledWith('w1');
    expect(wallets.getTransactions).toHaveBeenCalledWith('w1');
  });

  it('passes only display-safe fields to the provider — never raw base units', async () => {
    wallets.getHoldings.mockResolvedValue({
      holdings: [makeHolding({ rawBalance: '999999999999999999999', displayBalance: '999.999999999999999999' })],
      issues: [],
    });

    await service.generateForWallet('w1', { label: 'Main', address: '0xabc' });

    const request: InsightRequest = provider.generateInsight.mock.calls[0][0];
    expect(request.holdings[0]).toEqual({
      chainName: 'Ethereum',
      tokenSymbol: 'ETH',
      displayBalance: '999.999999999999999999',
    });
    expect(request.holdings[0]).not.toHaveProperty('rawBalance');
  });

  it('caps recent transactions at 20, keeping the first 20 (already most-recent-first from the DB order)', async () => {
    const many = Array.from({ length: 30 }, (_, i) => makeTx({ id: `t${i}` }));
    wallets.getTransactions.mockResolvedValue(many);

    await service.generateForWallet('w1', { label: 'Main', address: '0xabc' });

    const request: InsightRequest = provider.generateInsight.mock.calls[0][0];
    expect(request.recentTransactions).toHaveLength(20);
  });

  it('passes the wallet label and address through unchanged', async () => {
    await service.generateForWallet('w1', { label: 'Cold storage', address: '0xdeadbeef' });

    const request: InsightRequest = provider.generateInsight.mock.calls[0][0];
    expect(request.walletLabel).toBe('Cold storage');
    expect(request.address).toBe('0xdeadbeef');
  });

  it('returns the provider result plus cached: false on a first (miss) call', async () => {
    const result = await service.generateForWallet('w1', { label: null, address: '0xabc' });

    expect(result).toEqual({
      summary: 'A summary.',
      model: 'test-model',
      generatedAt: '2024-01-01T00:00:00.000Z',
      usage: USAGE,
      cached: false,
    });
  });

  describe('caching', () => {
    it('calls the provider once, then serves the second identical request from cache without calling it again', async () => {
      const wallet = { label: 'Main', address: '0xabc' };

      const first = await service.generateForWallet('w1', wallet);
      const second = await service.generateForWallet('w1', wallet);

      expect(provider.generateInsight).toHaveBeenCalledTimes(1);
      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.summary).toBe(first.summary);
    });

    it('calls the provider again when the underlying holdings changed between requests', async () => {
      const wallet = { label: 'Main', address: '0xabc' };

      await service.generateForWallet('w1', wallet);

      wallets.getHoldings.mockResolvedValue({
        holdings: [makeHolding({ displayBalance: '2' })],
        issues: [],
      });
      await service.generateForWallet('w1', wallet);

      expect(provider.generateInsight).toHaveBeenCalledTimes(2);
    });

    it('shares a cache entry across two different wallet ids with identical financial data — the key is content-addressed, not id-addressed', async () => {
      const wallet = { label: 'Main', address: '0xabc' };

      await service.generateForWallet('wallet-one', wallet);
      const second = await service.generateForWallet('wallet-two', wallet);

      expect(provider.generateInsight).toHaveBeenCalledTimes(1);
      expect(second.cached).toBe(true);
    });

    it('stores the result under CACHE_POLICIES.insight', async () => {
      await service.generateForWallet('w1', { label: 'Main', address: '0xabc' });

      expect(cache.set).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ summary: 'A summary.' }),
        expect.objectContaining({ ttlSeconds: expect.any(Number) }),
      );
    });
  });

  describe('token usage logging', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
      logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    it('logs spent tokens on a cache miss', async () => {
      await service.generateForWallet('w1', { label: 'Main', address: '0xabc' });

      const message = logSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('wallet=w1'));
      expect(message).toMatch(/cache=MISS/);
      expect(message).toMatch(/spent=120 tokens/);
    });

    it('logs zero spend on a cache hit, while still showing what it would have cost', async () => {
      const wallet = { label: 'Main', address: '0xabc' };
      await service.generateForWallet('w1', wallet);
      logSpy.mockClear();

      await service.generateForWallet('w1', wallet);

      const message = logSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('wallet=w1'));
      expect(message).toMatch(/cache=HIT/);
      expect(message).toMatch(/spent=0/);
      expect(message).toMatch(/120/); // the figure it would have cost
    });
  });
});
