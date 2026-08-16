import { WalletsService } from './wallets.service';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';

describe('WalletsService.getHoldings', () => {
  let prisma: { transaction: { findMany: jest.Mock } };
  let cache: CacheService;
  let service: WalletsService;

  beforeEach(() => {
    prisma = { transaction: { findMany: jest.fn().mockResolvedValue([]) } };
    cache = {} as CacheService; // unused by getHoldings — no cache layer yet (that's S7)
    service = new WalletsService(prisma as unknown as PrismaService, cache);
  });

  it('queries only this wallet’s transactions', async () => {
    await service.getHoldings('w1');

    expect(prisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { walletId: 'w1' } }),
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
