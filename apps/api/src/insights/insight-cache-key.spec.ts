import { hashInsightRequest } from './insight-cache-key';
import { InsightRequest } from './insight-provider.interface';

function request(overrides: Partial<InsightRequest> = {}): InsightRequest {
  return {
    walletLabel: 'Main',
    address: '0xD8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1.5' }],
    recentTransactions: [
      {
        chainName: 'Ethereum',
        tokenSymbol: 'ETH',
        direction: 'IN',
        displayAmount: '1.5',
        timestamp: '2024-01-01T00:00:00.000Z',
      },
    ],
    ...overrides,
  };
}

describe('hashInsightRequest', () => {
  it('is deterministic — same input, same key', () => {
    const req = request();
    expect(hashInsightRequest(req)).toBe(hashInsightRequest(req));
  });

  it('is case-insensitive on the address', () => {
    const lower = request({ address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045' });
    const upper = request({ address: '0xD8DA6BF26964AF9D7EED9E03E53415D37AA96045' });

    expect(hashInsightRequest(lower)).toBe(hashInsightRequest(upper));
  });

  it('is independent of holdings order', () => {
    const a = request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' },
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '2' },
      ],
    });
    const b = request({
      holdings: [
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '2' },
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' },
      ],
    });

    expect(hashInsightRequest(a)).toBe(hashInsightRequest(b));
  });

  it('is independent of recent-transaction order', () => {
    const tx1 = {
      chainName: 'Ethereum',
      tokenSymbol: 'ETH',
      direction: 'IN' as const,
      displayAmount: '1',
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    const tx2 = { ...tx1, displayAmount: '2', timestamp: '2024-01-02T00:00:00.000Z' };

    const a = request({ recentTransactions: [tx1, tx2] });
    const b = request({ recentTransactions: [tx2, tx1] });

    expect(hashInsightRequest(a)).toBe(hashInsightRequest(b));
  });

  it('changes when a holding balance changes', () => {
    const a = request({ holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' }] });
    const b = request({ holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '2' }] });

    expect(hashInsightRequest(a)).not.toBe(hashInsightRequest(b));
  });

  it('changes when a new transaction is added — the whole point: a sync invalidates the cache', () => {
    const before = request();
    const after = request({
      recentTransactions: [
        ...before.recentTransactions,
        {
          chainName: 'Ethereum',
          tokenSymbol: 'ETH',
          direction: 'OUT',
          displayAmount: '0.5',
          timestamp: '2024-01-02T00:00:00.000Z',
        },
      ],
    });

    expect(hashInsightRequest(before)).not.toBe(hashInsightRequest(after));
  });

  it('changes when the wallet label changes — the label is part of the actual prompt text', () => {
    const a = request({ walletLabel: 'Main' });
    const b = request({ walletLabel: 'Cold storage' });

    expect(hashInsightRequest(a)).not.toBe(hashInsightRequest(b));
  });

  it('produces the same key for two different wallets holding identical positions', () => {
    // Deliberate: this key is content-keyed, not identity-keyed. Two
    // wallets are not represented here at all (walletId isn't part of
    // InsightRequest) — this documents that equivalence explicitly rather
    // than leaving it as an implicit side effect.
    const a = request({ address: '0x1111111111111111111111111111111111111111' });
    const b = request({ address: '0x1111111111111111111111111111111111111111' });

    expect(hashInsightRequest(a)).toBe(hashInsightRequest(b));
  });

  it('produces a 64-character hex sha256 digest', () => {
    expect(hashInsightRequest(request())).toMatch(/^[0-9a-f]{64}$/);
  });
});
