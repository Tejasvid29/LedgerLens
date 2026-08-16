import { NormalizedTransaction } from '@ledgerlens/shared';
import { SyncService } from './sync.service';
import { PrismaService } from '../prisma/prisma.service';
import { AlchemyService } from './alchemy.service';
import { CHAINS } from './chain.config';

function makeTx(overrides: Partial<NormalizedTransaction> = {}): NormalizedTransaction {
  return {
    chainId: 1,
    hash: '0xabc',
    blockNumber: 100n,
    timestamp: new Date('2024-01-15T12:00:00.000Z'),
    direction: 'IN',
    rawValue: '1000000000000000000',
    decimals: 18,
    tokenSymbol: 'ETH',
    tokenAddress: null,
    gasUsed: null,
    gasPriceWei: null,
    status: 'SUCCESS',
    ...overrides,
  };
}

describe('SyncService', () => {
  let prisma: {
    wallet: { findUniqueOrThrow: jest.Mock; update: jest.Mock };
    transaction: { upsert: jest.Mock };
  };
  let alchemy: { fetchTransactions: jest.Mock };
  let service: SyncService;

  beforeEach(() => {
    prisma = {
      wallet: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'w1', address: '0xwallet' }),
        update: jest.fn().mockResolvedValue({}),
      },
      transaction: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    alchemy = { fetchTransactions: jest.fn() };
    service = new SyncService(
      prisma as unknown as PrismaService,
      alchemy as unknown as AlchemyService,
    );
  });

  it('fetches from Alchemy (already normalized) and persists for one wallet on one chain', async () => {
    alchemy.fetchTransactions.mockResolvedValue([makeTx()]);

    const result = await service.syncWallet('w1', ['ethereum']);

    expect(alchemy.fetchTransactions).toHaveBeenCalledWith('0xwallet', 'ethereum');
    expect(alchemy.fetchTransactions).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      walletId: 'w1',
      totalSynced: 1,
      chains: ['ethereum'],
      errors: [],
    });
  });

  it('upserts on (chainId, hash, walletId)', async () => {
    const tx = makeTx();
    alchemy.fetchTransactions.mockResolvedValue([tx]);

    await service.syncWallet('w1', ['ethereum']);

    expect(prisma.transaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          chainId_hash_walletId: { chainId: tx.chainId, hash: tx.hash, walletId: 'w1' },
        },
      }),
    );
  });

  it('never inserts — upsert covers both new and re-synced transactions (rule 6)', async () => {
    alchemy.fetchTransactions.mockResolvedValue([makeTx()]);

    await service.syncWallet('w1', ['ethereum']);

    expect(prisma.transaction.upsert).toHaveBeenCalledTimes(1);
    // No separate create/findFirst-then-create path exists on the mock.
    expect(Object.keys(prisma.transaction)).toEqual(['upsert']);
  });

  it('creates with the full normalized transaction plus walletId', async () => {
    const tx = makeTx({ tokenAddress: '0xusdc' });
    alchemy.fetchTransactions.mockResolvedValue([tx]);

    await service.syncWallet('w1', ['ethereum']);

    expect(prisma.transaction.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { ...tx, walletId: 'w1' } }),
    );
  });

  it('the update branch omits the key fields — chainId/hash/walletId are immutable', async () => {
    alchemy.fetchTransactions.mockResolvedValue([makeTx()]);

    await service.syncWallet('w1', ['ethereum']);

    const call = prisma.transaction.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('walletId');
    expect(call.update).not.toHaveProperty('hash');
    expect(call.update).not.toHaveProperty('chainId');
  });

  it('persists rawValue as a string, unmodified — no numeric coercion (rule 1)', async () => {
    const huge = '123456789012345678901234567890';
    alchemy.fetchTransactions.mockResolvedValue([makeTx({ rawValue: huge })]);

    await service.syncWallet('w1', ['ethereum']);

    const { create } = prisma.transaction.upsert.mock.calls[0][0];
    expect(create.rawValue).toBe(huge);
    expect(typeof create.rawValue).toBe('string');
  });

  it('persists each transaction from one chain individually', async () => {
    alchemy.fetchTransactions.mockResolvedValue([
      makeTx({ hash: '0x1' }),
      makeTx({ hash: '0x2' }),
    ]);

    const result = await service.syncWallet('w1', ['ethereum']);

    expect(prisma.transaction.upsert).toHaveBeenCalledTimes(2);
    expect(result.totalSynced).toBe(2);
  });

  it('records zero synced transactions without error for an empty history', async () => {
    alchemy.fetchTransactions.mockResolvedValue([]);

    const result = await service.syncWallet('w1', ['ethereum']);

    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
    expect(result.totalSynced).toBe(0);
  });

  it('updates lastSyncedAt after a sync, including an empty one', async () => {
    alchemy.fetchTransactions.mockResolvedValue([]);

    await service.syncWallet('w1', ['ethereum']);

    expect(prisma.wallet.update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { lastSyncedAt: expect.any(Date) },
    });
  });

  it('propagates when the wallet does not exist and fetches nothing', async () => {
    prisma.wallet.findUniqueOrThrow.mockRejectedValue(new Error('not found'));

    await expect(service.syncWallet('missing', ['ethereum'])).rejects.toThrow('not found');
    expect(alchemy.fetchTransactions).not.toHaveBeenCalled();
  });

  it('one chain failing does not lose transactions already synced from another', async () => {
    alchemy.fetchTransactions
      .mockResolvedValueOnce([makeTx({ chainId: 1, hash: '0x1' })])
      .mockRejectedValueOnce(new Error('Alchemy rate limited'));

    const result = await service.syncWallet('w1', ['ethereum', 'polygon']);

    expect(result.totalSynced).toBe(1);
    expect(prisma.transaction.upsert).toHaveBeenCalledTimes(1);
    // A partial failure degrades completeness, not the sync as a whole.
    expect(prisma.wallet.update).toHaveBeenCalled();
  });

  it('collects the failing chain and its message rather than only logging it', async () => {
    alchemy.fetchTransactions
      .mockResolvedValueOnce([makeTx()])
      .mockRejectedValueOnce(new Error('Alchemy rate limited'));

    const result = await service.syncWallet('w1', ['ethereum', 'polygon']);

    expect(result.errors).toEqual([{ chain: 'polygon', message: 'Alchemy rate limited' }]);
  });

  it('does not throw when every chain fails — the caller gets a result, not an exception', async () => {
    alchemy.fetchTransactions.mockRejectedValue(new Error('Alchemy down'));

    const result = await service.syncWallet('w1', ['ethereum', 'polygon']);

    expect(result.totalSynced).toBe(0);
    expect(prisma.transaction.upsert).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.chain).sort()).toEqual(['ethereum', 'polygon']);
    // A total failure still updates lastSyncedAt — the sync itself didn't
    // throw, so pretending it never happened would be wrong too.
    expect(prisma.wallet.update).toHaveBeenCalled();
  });

  it('records a non-Error rejection as a string, not "[object Object]"', async () => {
    alchemy.fetchTransactions.mockRejectedValue('rate limited');

    const result = await service.syncWallet('w1', ['ethereum']);

    expect(result.errors).toEqual([{ chain: 'ethereum', message: 'rate limited' }]);
  });

  it('defaults to every configured chain when none are specified', async () => {
    alchemy.fetchTransactions.mockResolvedValue([]);

    const result = await service.syncWallet('w1');

    const chainKeys = Object.keys(CHAINS);
    expect(result.chains).toEqual(chainKeys);
    expect(alchemy.fetchTransactions).toHaveBeenCalledTimes(chainKeys.length);
    expect(result.errors).toEqual([]);
  });

  describe('bounded concurrency', () => {
    it('runs all 6 default chains, not just a pool-sized subset', async () => {
      alchemy.fetchTransactions.mockResolvedValue([]);

      const result = await service.syncWallet('w1');

      expect(result.chains).toHaveLength(6);
      expect(alchemy.fetchTransactions).toHaveBeenCalledTimes(6);
    });

    it('never has more than 3 chain fetches in flight at once', async () => {
      let inFlight = 0;
      let maxInFlight = 0;

      alchemy.fetchTransactions.mockImplementation(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return [];
      });

      await service.syncWallet('w1');

      expect(maxInFlight).toBeLessThanOrEqual(3);
      expect(maxInFlight).toBeGreaterThan(1); // and it is actually concurrent, not serial
    });

    it('a slow chain does not block a fast one from finishing first (pooled, not chunked)', async () => {
      const order: string[] = [];
      alchemy.fetchTransactions.mockImplementation(async (_addr: string, chain: string) => {
        const delay = chain === 'ethereum' ? 20 : 1;
        await new Promise((r) => setTimeout(r, delay));
        order.push(chain);
        return [];
      });

      // 4 chains through a pool of 3: if slot 1 (ethereum) is slow, the 4th
      // chain should start as soon as any of the first 3 finish, not wait
      // for the whole first batch — proving a work-stealing pool, not chunks.
      await service.syncWallet('w1', ['ethereum', 'polygon', 'arbitrum', 'base']);

      expect(order.indexOf('polygon')).toBeLessThan(order.indexOf('ethereum'));
      expect(order.indexOf('base')).toBeLessThan(order.indexOf('ethereum'));
    });

    it('total time for 6 chains is roughly 2 rounds, not 6 sequential ones', async () => {
      alchemy.fetchTransactions.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return [];
      });

      const start = Date.now();
      await service.syncWallet('w1');
      const elapsed = Date.now() - start;

      // 6 chains / pool of 3 ≈ 2 rounds of 20ms ≈ 40ms. 6 sequential would be
      // ≈120ms. Generous ceiling to avoid CI flakiness.
      expect(elapsed).toBeLessThan(90);
    });
  });
});
