import { aggregateHoldings, HoldingTransaction } from './holdings';

let seq = 0;

/** A stored transaction with sane defaults, overridable per test. */
function tx(overrides: Partial<HoldingTransaction> = {}): HoldingTransaction {
  seq += 1;
  return {
    chainId: 1,
    tokenAddress: '0xusdc',
    tokenSymbol: 'USDC',
    rawValue: '1000000',
    decimals: 6,
    direction: 'IN',
    status: 'SUCCESS',
    timestamp: new Date(2024, 0, seq), // ascending by default, distinct per call
    ...overrides,
  };
}

function holdingFor(result: ReturnType<typeof aggregateHoldings>, tokenAddress: string | null) {
  return result.holdings.find((h) => h.tokenAddress === tokenAddress);
}

describe('aggregateHoldings — basic sums', () => {
  it('sums multiple incoming transfers of the same token', () => {
    const result = aggregateHoldings([
      tx({ rawValue: '1000000' }),
      tx({ rawValue: '2500000' }),
    ]);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].rawBalance).toBe('3500000');
    expect(result.issues).toHaveLength(0);
  });

  it('subtracts outgoing transfers', () => {
    const result = aggregateHoldings([
      tx({ direction: 'IN', rawValue: '5000000' }),
      tx({ direction: 'OUT', rawValue: '2000000' }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('3000000');
  });

  it('nets to exactly zero when fully sold', () => {
    const result = aggregateHoldings([
      tx({ direction: 'IN', rawValue: '1000000' }),
      tx({ direction: 'OUT', rawValue: '1000000' }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('0');
  });

  it('handles an empty transaction list', () => {
    expect(aggregateHoldings([])).toEqual({ holdings: [], issues: [] });
  });

  it('preserves precision beyond Number.MAX_SAFE_INTEGER (rule 1)', () => {
    const huge1 = '123456789012345678901234567890';
    const huge2 = '876543210987654321098765432110';
    const result = aggregateHoldings([
      tx({ rawValue: huge1, decimals: 18 }),
      tx({ rawValue: huge2, decimals: 18 }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('1000000000000000000000000000000');
    expect(typeof result.holdings[0].rawBalance).toBe('string');
  });
});

describe('aggregateHoldings — direction handling', () => {
  it('treats SELF transfers as no-ops', () => {
    const result = aggregateHoldings([
      tx({ direction: 'IN', rawValue: '1000000' }),
      tx({ direction: 'SELF', rawValue: '999999999' }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('1000000');
  });

  it('a wallet with only SELF transfers has no holdings', () => {
    const result = aggregateHoldings([tx({ direction: 'SELF' })]);
    expect(result.holdings).toHaveLength(0);
  });
});

describe('aggregateHoldings — status filtering', () => {
  it('excludes FAILED transactions — they never moved funds on-chain', () => {
    const result = aggregateHoldings([
      tx({ direction: 'IN', rawValue: '1000000', status: 'SUCCESS' }),
      tx({ direction: 'IN', rawValue: '999999999', status: 'FAILED' }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('1000000');
  });

  it('excludes PENDING transactions — not yet confirmed, not yet "current"', () => {
    const result = aggregateHoldings([
      tx({ direction: 'IN', rawValue: '1000000', status: 'SUCCESS' }),
      tx({ direction: 'IN', rawValue: '999999999', status: 'PENDING' }),
    ]);

    expect(result.holdings[0].rawBalance).toBe('1000000');
  });

  it('a wallet with only FAILED/PENDING transactions has no holdings', () => {
    const result = aggregateHoldings([
      tx({ status: 'FAILED' }),
      tx({ status: 'PENDING' }),
    ]);
    expect(result.holdings).toHaveLength(0);
  });
});

describe('aggregateHoldings — grouping', () => {
  it('keeps the same token separate across chains', () => {
    const result = aggregateHoldings([
      tx({ chainId: 1, tokenAddress: '0xusdc', rawValue: '1000000' }),
      tx({ chainId: 137, tokenAddress: '0xusdc', rawValue: '2000000' }),
    ]);

    expect(result.holdings).toHaveLength(2);
    expect(result.holdings.find((h) => h.chainId === 1)!.rawBalance).toBe('1000000');
    expect(result.holdings.find((h) => h.chainId === 137)!.rawBalance).toBe('2000000');
  });

  it('keeps different tokens on the same chain separate', () => {
    const result = aggregateHoldings([
      tx({ tokenAddress: '0xusdc', tokenSymbol: 'USDC', rawValue: '1000000' }),
      tx({ tokenAddress: '0xweth', tokenSymbol: 'WETH', rawValue: '500000000000000000', decimals: 18 }),
    ]);

    expect(result.holdings).toHaveLength(2);
  });

  it('aggregates the native token (null tokenAddress) per chain', () => {
    const result = aggregateHoldings([
      tx({ tokenAddress: null, tokenSymbol: 'ETH', rawValue: '1500000000000000000', decimals: 18 }),
      tx({ tokenAddress: null, tokenSymbol: 'ETH', rawValue: '500000000000000000', decimals: 18 }),
    ]);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].tokenAddress).toBeNull();
    expect(result.holdings[0].rawBalance).toBe('2000000000000000000');
  });

  it('does not merge two different null-tokenAddress tokens with different symbols', () => {
    const result = aggregateHoldings([
      tx({ tokenAddress: null, tokenSymbol: 'ETH', rawValue: '1000000000000000000', decimals: 18 }),
      tx({ tokenAddress: null, tokenSymbol: 'MYSTERY', rawValue: '42', decimals: 0 }),
    ]);

    expect(result.holdings).toHaveLength(2);
  });

  it('does not merge the native token across two chains that share a symbol', () => {
    // ETH is native on both Ethereum and Arbitrum.
    const result = aggregateHoldings([
      tx({ chainId: 1, tokenAddress: null, tokenSymbol: 'ETH', rawValue: '1000000000000000000', decimals: 18 }),
      tx({ chainId: 42161, tokenAddress: null, tokenSymbol: 'ETH', rawValue: '2000000000000000000', decimals: 18 }),
    ]);

    expect(result.holdings).toHaveLength(2);
  });
});

describe('aggregateHoldings — incomplete history', () => {
  it('returns a negative balance rather than clamping to zero', () => {
    // Sync started after the wallet already held some USDC — only the
    // outgoing leg is in our history.
    const result = aggregateHoldings([tx({ direction: 'OUT', rawValue: '1000000' })]);

    expect(result.holdings[0].rawBalance).toBe('-1000000');
  });

  it('formats a negative balance correctly downstream via a leading "-"', () => {
    const result = aggregateHoldings([tx({ direction: 'OUT', rawValue: '1500000' })]);
    expect(result.holdings[0].rawBalance.startsWith('-')).toBe(true);
  });
});

describe('aggregateHoldings — decimals mismatch (rule 5 applied at read time)', () => {
  it('keeps the first transaction’s decimals as canonical and flags a later disagreement', () => {
    const result = aggregateHoldings([
      tx({ rawValue: '1000000', decimals: 6, timestamp: new Date(2024, 0, 1) }),
      tx({ rawValue: '2000000000000000000', decimals: 18, timestamp: new Date(2024, 0, 2) }),
    ]);

    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].decimals).toBe(6);
    // The mismatched transaction is excluded from the sum, not blended in.
    expect(result.holdings[0].rawBalance).toBe('1000000');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ reason: 'decimals-mismatch', tokenAddress: '0xusdc' }),
    );
  });

  it('does not lose the rest of the wallet’s holdings over one mismatched token', () => {
    const result = aggregateHoldings([
      tx({ tokenAddress: '0xusdc', decimals: 6, rawValue: '1000000', timestamp: new Date(2024, 0, 1) }),
      tx({ tokenAddress: '0xusdc', decimals: 18, rawValue: '999', timestamp: new Date(2024, 0, 2) }),
      tx({ tokenAddress: '0xweth', decimals: 18, rawValue: '500000000000000000', timestamp: new Date(2024, 0, 3) }),
    ]);

    expect(result.holdings).toHaveLength(2);
    expect(holdingFor(result, '0xweth')!.rawBalance).toBe('500000000000000000');
  });

  it('processes out of DB-return order — canonical decimals follow timestamp, not array order', () => {
    const result = aggregateHoldings([
      tx({ rawValue: '2000000000000000000', decimals: 18, timestamp: new Date(2024, 0, 2) }),
      tx({ rawValue: '1000000', decimals: 6, timestamp: new Date(2024, 0, 1) }),
    ]);

    // The earlier (Jan 1) transaction is canonical regardless of array order.
    expect(result.holdings[0].decimals).toBe(6);
    expect(result.holdings[0].rawBalance).toBe('1000000');
  });
});

describe('aggregateHoldings — symbol freshness', () => {
  it('uses the most recent transaction’s symbol for a given tokenAddress', () => {
    const result = aggregateHoldings([
      tx({ tokenSymbol: 'OLDNAME', rawValue: '1000000', timestamp: new Date(2024, 0, 1) }),
      tx({ tokenSymbol: 'NEWNAME', rawValue: '1000000', timestamp: new Date(2024, 0, 2) }),
    ]);

    expect(result.holdings[0].tokenSymbol).toBe('NEWNAME');
    expect(result.holdings[0].rawBalance).toBe('2000000');
  });
});

describe('aggregateHoldings — malformed stored rows (rule 4 applied at read time)', () => {
  it('never throws on an unparseable rawValue and drops only that row', () => {
    const junk: HoldingTransaction[] = [
      tx({ tokenAddress: '0xusdc', rawValue: 'not-a-number' }),
      tx({ tokenAddress: '0xweth', rawValue: '500000000000000000', decimals: 18 }),
    ];

    expect(() => aggregateHoldings(junk)).not.toThrow();

    const result = aggregateHoldings(junk);
    expect(holdingFor(result, '0xusdc')).toBeUndefined();
    expect(holdingFor(result, '0xweth')!.rawBalance).toBe('500000000000000000');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-value', tokenAddress: '0xusdc' }),
    );
  });

  it('survives a batch where every row is malformed', () => {
    const junk = [tx({ rawValue: 'x' }), tx({ rawValue: 'y' }), tx({ rawValue: 'z' })];
    const result = aggregateHoldings(junk);

    expect(result.holdings).toHaveLength(0);
    expect(result.issues).toHaveLength(3);
  });
});
