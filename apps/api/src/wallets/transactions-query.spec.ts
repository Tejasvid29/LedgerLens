import { queryTransactions } from './transactions-query';
import { SerializedTransaction } from '@ledgerlens/shared';

let seq = 0;

/** A serialized transaction with sane defaults, overridable per test. */
function tx(overrides: Partial<SerializedTransaction> = {}): SerializedTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    chainId: 1,
    chainName: 'Ethereum',
    hash: `0xhash${seq}`,
    blockNumber: String(seq),
    timestamp: new Date(2024, 0, seq).toISOString(),
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

describe('queryTransactions — filtering', () => {
  it('filters by chainId', () => {
    const all = [tx({ chainId: 1 }), tx({ chainId: 137, chainName: 'Polygon' }), tx({ chainId: 1 })];

    const { transactions, total } = queryTransactions(all, { chainId: 137 });

    expect(total).toBe(1);
    expect(transactions.every((t) => t.chainId === 137)).toBe(true);
  });

  it('filters by tokenSymbol', () => {
    const all = [tx({ tokenSymbol: 'ETH' }), tx({ tokenSymbol: 'USDC' }), tx({ tokenSymbol: 'ETH' })];

    const { transactions, total } = queryTransactions(all, { tokenSymbol: 'USDC' });

    expect(total).toBe(1);
    expect(transactions[0].tokenSymbol).toBe('USDC');
  });

  it('combines chain and token filters', () => {
    const all = [
      tx({ chainId: 1, tokenSymbol: 'ETH' }),
      tx({ chainId: 1, tokenSymbol: 'USDC' }),
      tx({ chainId: 137, tokenSymbol: 'USDC', chainName: 'Polygon' }),
    ];

    const { total } = queryTransactions(all, { chainId: 1, tokenSymbol: 'USDC' });

    expect(total).toBe(1);
  });

  it('derives filter dropdown options from the full unfiltered list, not the filtered result', () => {
    const all = [
      tx({ chainId: 1, chainName: 'Ethereum', tokenSymbol: 'ETH' }),
      tx({ chainId: 137, chainName: 'Polygon', tokenSymbol: 'USDC' }),
    ];

    const { filters } = queryTransactions(all, { chainId: 1 });

    expect(filters.chains).toEqual([
      { chainId: 1, chainName: 'Ethereum' },
      { chainId: 137, chainName: 'Polygon' },
    ]);
    expect(filters.tokens).toEqual(['ETH', 'USDC']);
  });
});

describe('queryTransactions — sorting', () => {
  it('defaults to timestamp descending', () => {
    const all = [
      tx({ timestamp: new Date(2024, 0, 1).toISOString() }),
      tx({ timestamp: new Date(2024, 0, 3).toISOString() }),
      tx({ timestamp: new Date(2024, 0, 2).toISOString() }),
    ];

    const { transactions } = queryTransactions(all, {});

    expect(transactions.map((t) => t.timestamp)).toEqual([
      new Date(2024, 0, 3).toISOString(),
      new Date(2024, 0, 2).toISOString(),
      new Date(2024, 0, 1).toISOString(),
    ]);
  });

  it('sorts by chainName ascending when requested', () => {
    const all = [
      tx({ chainName: 'Optimism' }),
      tx({ chainName: 'Arbitrum' }),
      tx({ chainName: 'Base' }),
    ];

    const { transactions } = queryTransactions(all, { sort: 'chainName', dir: 'asc' });

    expect(transactions.map((t) => t.chainName)).toEqual(['Arbitrum', 'Base', 'Optimism']);
  });

  it('sorts by amount using BigInt magnitude, not Number() — never loses precision across differing decimals', () => {
    const all = [
      // 1 ETH, 18 decimals — larger magnitude than either token below.
      tx({ tokenSymbol: 'ETH', decimals: 18, rawValue: '1000000000000000000' }),
      // 5 USDC, 6 decimals — raw digit count is tiny, but 5 > 1 in real terms.
      tx({ tokenSymbol: 'USDC', decimals: 6, rawValue: '5000000' }),
      // 0.5 ETH, 18 decimals.
      tx({ tokenSymbol: 'ETH', decimals: 18, rawValue: '500000000000000000' }),
    ];

    const { transactions } = queryTransactions(all, { sort: 'amount', dir: 'asc' });

    // 0.5 ETH < 1.0 ETH < 5.0 USDC in real terms — the raw digit strings
    // alone say otherwise, which is exactly what scaling to a common
    // precision is for.
    expect(transactions.map((t) => `${t.tokenSymbol}:${t.rawValue}`)).toEqual([
      'ETH:500000000000000000',
      'ETH:1000000000000000000',
      'USDC:5000000',
    ]);
  });

  it('sorts a >18-decimal token correctly (scaling divides rather than throws)', () => {
    const all = [
      tx({ decimals: 24, rawValue: '2000000000000000000000000' }), // 2.0
      tx({ decimals: 24, rawValue: '1000000000000000000000000' }), // 1.0
    ];

    const { transactions } = queryTransactions(all, { sort: 'amount', dir: 'asc' });

    expect(transactions[0].rawValue).toBe('1000000000000000000000000');
  });
});

describe('queryTransactions — pagination', () => {
  it('paginates and reports total against the filtered/sorted set, not the page size', () => {
    const all = Array.from({ length: 12 }, (_, i) =>
      tx({ timestamp: new Date(2024, 0, i + 1).toISOString() }),
    );

    const page1 = queryTransactions(all, { page: 1, pageSize: 5, sort: 'timestamp', dir: 'asc' });
    const page3 = queryTransactions(all, { page: 3, pageSize: 5, sort: 'timestamp', dir: 'asc' });

    expect(page1.transactions).toHaveLength(5);
    expect(page1.total).toBe(12);
    expect(page1.transactions[0].timestamp).toBe(new Date(2024, 0, 1).toISOString());

    expect(page3.transactions).toHaveLength(2); // remainder
    expect(page3.transactions[0].timestamp).toBe(new Date(2024, 0, 11).toISOString());
  });

  it('defaults to page 1 of 500 when no pagination params are given', () => {
    const all = [tx(), tx()];

    const { page, pageSize, transactions } = queryTransactions(all, {});

    expect(page).toBe(1);
    expect(pageSize).toBe(500);
    expect(transactions).toHaveLength(2);
  });

  it('returns an empty page (not an error) past the end of the results', () => {
    const all = [tx()];

    const { transactions, total } = queryTransactions(all, { page: 5, pageSize: 10 });

    expect(transactions).toEqual([]);
    expect(total).toBe(1);
  });
});
