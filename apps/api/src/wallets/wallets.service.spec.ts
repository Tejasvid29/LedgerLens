import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { CACHE_POLICIES, walletHoldingsKey, walletTransactionsKey } from '../cache/cache.policy';

function makeFakeCache() {
  // Pass-through: always calls the loader, as a permanent cache miss would.
  // Tests that care about caching itself belong in cache.service.spec.ts;
  // these assert WalletsService asks the cache for the right thing.
  return {
    swr: jest.fn((_key: string, _policy: unknown, loader: () => Promise<unknown>) => loader()),
    del: jest.fn().mockResolvedValue(undefined),
  };
}

describe('WalletsService.getHoldings', () => {
  let prisma: { transaction: { findMany: jest.Mock } };
  let cache: ReturnType<typeof makeFakeCache>;
  let service: WalletsService;

  beforeEach(() => {
    prisma = { transaction: { findMany: jest.fn().mockResolvedValue([]) } };
    cache = makeFakeCache();
    service = new WalletsService(prisma as unknown as PrismaService, cache as unknown as CacheService);
  });

  it('queries only this wallet’s transactions', async () => {
    await service.getHoldings('w1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId: 'w1' } }),
    );
  });

  it('reads through the holdings cache key and policy', async () => {
    await service.getHoldings('w1');

    expect(cache.swr).toHaveBeenCalledWith(
      walletHoldingsKey('w1'),
      CACHE_POLICIES.walletHoldings,
      expect.any(Function),
    );
  });

  it('delegates the math to aggregateHoldings and serializes the result', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        chainId: 1,
        tokenAddress: '0xusdc',
        tokenSymbol: 'USDC',
        rawValue: '1000000',
        decimals: 6,
        direction: 'IN',
        status: 'SUCCESS',
        timestamp: new Date('2024-01-01'),
      },
    ]);

    const { holdings, issues } = await service.getHoldings('w1');

    expect(issues).toEqual([]);
    expect(holdings).toEqual([
      {
        chainId: 1,
        chainName: 'Ethereum',
        tokenAddress: '0xusdc',
        tokenSymbol: 'USDC',
        rawBalance: '1000000',
        decimals: 6,
        displayBalance: '1',
      },
    ]);
  });

  it('names an unrecognized chainId rather than dropping the holding', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        chainId: 999999,
        tokenAddress: null,
        tokenSymbol: 'MYSTERY',
        rawValue: '1',
        decimals: 0,
        direction: 'IN',
        status: 'SUCCESS',
        timestamp: new Date('2024-01-01'),
      },
    ]);

    const { holdings } = await service.getHoldings('w1');

    expect(holdings[0].chainName).toBe('Chain 999999');
  });

  it('surfaces aggregation issues to the caller instead of swallowing them', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        chainId: 1,
        tokenAddress: '0xusdc',
        tokenSymbol: 'USDC',
        rawValue: '1000000',
        decimals: 6,
        direction: 'IN',
        status: 'SUCCESS',
        timestamp: new Date('2024-01-01'),
      },
      {
        chainId: 1,
        tokenAddress: '0xusdc',
        tokenSymbol: 'USDC',
        rawValue: '999',
        decimals: 18, // disagrees with the first transaction's decimals
        direction: 'IN',
        status: 'SUCCESS',
        timestamp: new Date('2024-01-02'),
      },
    ]);

    const { issues } = await service.getHoldings('w1');

    expect(issues).toContainEqual(expect.objectContaining({ reason: 'decimals-mismatch' }));
  });

  it('returns no holdings for a wallet with no transactions', async () => {
    const { holdings, issues } = await service.getHoldings('w1');
    expect(holdings).toEqual([]);
    expect(issues).toEqual([]);
  });
});

describe('WalletsService.getTransactions', () => {
  let prisma: { transaction: { findMany: jest.Mock } };
  let cache: ReturnType<typeof makeFakeCache>;
  let service: WalletsService;

  beforeEach(() => {
    prisma = { transaction: { findMany: jest.fn().mockResolvedValue([]) } };
    cache = makeFakeCache();
    service = new WalletsService(prisma as unknown as PrismaService, cache as unknown as CacheService);
  });

  it('reads through the transactions cache key and policy', async () => {
    await service.getTransactions('w1');

    expect(cache.swr).toHaveBeenCalledWith(
      walletTransactionsKey('w1'),
      CACHE_POLICIES.walletTransactions,
      expect.any(Function),
    );
  });

  it('serializes what the loader returns', async () => {
    prisma.transaction.findMany.mockResolvedValue([
      {
        id: 't1',
        chainId: 1,
        hash: '0xabc',
        blockNumber: 100n,
        timestamp: new Date('2024-01-01T00:00:00.000Z'),
        direction: 'IN',
        rawValue: '1000000000000000000',
        decimals: 18,
        tokenSymbol: 'ETH',
        tokenAddress: null,
        status: 'SUCCESS',
      },
    ]);

    const txs = await service.getTransactions('w1');

    expect(txs).toEqual([
      expect.objectContaining({
        id: 't1',
        chainName: 'Ethereum',
        displayAmount: '1',
      }),
    ]);
  });

  it('bypasses the cache entirely when skipCache is set — no read, no write', async () => {
    // The baseline measurement path (docs/benchmarks) must not warm the very
    // cache it exists to measure without.
    await service.getTransactions('w1', { skipCache: true });

    expect(cache.swr).not.toHaveBeenCalled();
    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId: 'w1' } }),
    );
  });
});

describe('WalletsService.invalidateCache', () => {
  it('clears both the transactions and holdings keys for the wallet', async () => {
    const cache = makeFakeCache();
    const service = new WalletsService({} as PrismaService, cache as unknown as CacheService);

    await service.invalidateCache('w1');

    expect(cache.del).toHaveBeenCalledWith(walletTransactionsKey('w1'), walletHoldingsKey('w1'));
  });
});

describe('WalletsService.create', () => {
  let prisma: {
    user: { findFirst: jest.Mock; create: jest.Mock };
    wallet: { upsert: jest.Mock };
  };
  let cache: ReturnType<typeof makeFakeCache>;
  let service: WalletsService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'u1' }),
        create: jest.fn(),
      },
      wallet: { upsert: jest.fn().mockResolvedValue({ id: 'w1' }) },
    };
    cache = makeFakeCache();
    service = new WalletsService(prisma as unknown as PrismaService, cache as unknown as CacheService);
  });

  it('rejects a malformed address with a message stating the expected format', async () => {
    await expect(service.create('not-an-address')).rejects.toThrow(BadRequestException);
    await expect(service.create('0x123')).rejects.toThrow(/0x-prefixed, 40-character hex/);
    // Never touches the DB for input that fails validation.
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.wallet.upsert).not.toHaveBeenCalled();
  });

  it('lowercases a valid address before storing it', async () => {
    const mixedCase = `0x${'A1b2'.repeat(10)}`;

    await service.create(mixedCase, 'Main');

    expect(prisma.wallet.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ address: mixedCase.toLowerCase() }),
      }),
    );
  });
});

describe('WalletsService.remove', () => {
  let prisma: {
    wallet: { findUnique: jest.Mock; delete: jest.Mock };
    transaction: { deleteMany: jest.Mock };
    holding: { deleteMany: jest.Mock };
    $transaction: jest.Mock;
  };
  let cache: ReturnType<typeof makeFakeCache>;
  let service: WalletsService;

  beforeEach(() => {
    prisma = {
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ id: 'w1' }),
        delete: jest.fn().mockResolvedValue({ id: 'w1' }),
      },
      transaction: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      holding: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    cache = makeFakeCache();
    service = new WalletsService(prisma as unknown as PrismaService, cache as unknown as CacheService);
  });

  it('throws NotFoundException for a wallet that does not exist, without touching anything else', async () => {
    prisma.wallet.findUnique.mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it('deletes transactions and holdings before the wallet, in one transaction, then invalidates the cache', async () => {
    await service.remove('w1');

    expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({ where: { walletId: 'w1' } });
    expect(prisma.holding.deleteMany).toHaveBeenCalledWith({ where: { walletId: 'w1' } });
    expect(prisma.wallet.delete).toHaveBeenCalledWith({ where: { id: 'w1' } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith(walletTransactionsKey('w1'), walletHoldingsKey('w1'));
  });
});
