import { InsightsService } from './insights.service';
import { WalletsService } from '../wallets/wallets.service';
import { InsightProvider, InsightRequest } from './insight-provider.interface';
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

describe('InsightsService.generateForWallet', () => {
  let wallets: { getHoldings: jest.Mock; getTransactions: jest.Mock };
  let provider: { generateInsight: jest.Mock };
  let service: InsightsService;

  beforeEach(() => {
    wallets = {
      getHoldings: jest.fn().mockResolvedValue({ holdings: [], issues: [] }),
      getTransactions: jest.fn().mockResolvedValue([]),
    };
    provider = {
      generateInsight: jest.fn().mockResolvedValue({
        summary: 'A summary.',
        model: 'test-model',
        generatedAt: '2024-01-01T00:00:00.000Z',
      }),
    };
    service = new InsightsService(
      wallets as unknown as WalletsService,
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

  it('returns exactly what the provider returns', async () => {
    const result = await service.generateForWallet('w1', { label: null, address: '0xabc' });

    expect(result).toEqual({
      summary: 'A summary.',
      model: 'test-model',
      generatedAt: '2024-01-01T00:00:00.000Z',
    });
  });
});
