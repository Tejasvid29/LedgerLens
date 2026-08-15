import {
  normalizeTransfer,
  formatAmount,
  NormalizerContext,
  RawAlchemyAssetTransfer,
} from './normalizer';

describe('normalizeTransfer', () => {
  const ctx: NormalizerContext = {
    chainId: 1,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
    walletAddress: '0xWallet',
  };

  const base: RawAlchemyAssetTransfer = {
    hash: '0xabc',
    blockNum: '0x64',
    from: '0xSender',
    to: '0xWallet',
    value: 1.5,
    asset: 'ETH',
    category: 'external',
    rawContract: { value: '1500000000000000000', address: null, decimal: null },
    metadata: { blockTimestamp: '2024-01-15T12:00:00.000Z' },
  };

  it('normalizes incoming native transfer', () => {
    const result = normalizeTransfer(base, ctx);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('IN');
    expect(result!.rawValue).toBe('1500000000000000000');
    expect(result!.decimals).toBe(18);
    expect(result!.tokenSymbol).toBe('ETH');
    expect(result!.tokenAddress).toBeNull();
    expect(result!.blockNumber).toBe(100n);
  });

  it('normalizes outgoing native transfer', () => {
    const result = normalizeTransfer(
      { ...base, from: '0xWallet', to: '0xRecipient' },
      ctx,
    );
    expect(result!.direction).toBe('OUT');
  });

  it('normalizes self transfer', () => {
    const result = normalizeTransfer(
      { ...base, from: '0xWallet', to: '0xWallet' },
      ctx,
    );
    expect(result!.direction).toBe('SELF');
  });

  it('returns null for unrelated transfers', () => {
    const result = normalizeTransfer(
      { ...base, from: '0xA', to: '0xB' },
      ctx,
    );
    expect(result).toBeNull();
  });

  it('normalizes ERC-20 with rawContract decimals', () => {
    const result = normalizeTransfer(
      {
        ...base,
        category: 'erc20',
        asset: 'USDC',
        rawContract: {
          value: '1000000',
          address: '0xUSDC',
          decimal: '6',
        },
      },
      ctx,
    );
    expect(result!.rawValue).toBe('1000000');
    expect(result!.decimals).toBe(6);
    expect(result!.tokenSymbol).toBe('USDC');
    expect(result!.tokenAddress).toBe('0xusdc');
  });

  it('defaults ERC-20 decimals to 18 when missing', () => {
    const result = normalizeTransfer(
      {
        ...base,
        category: 'erc20',
        asset: 'WEIRD',
        rawContract: { value: '999', address: '0xToken', decimal: null },
      },
      ctx,
    );
    expect(result!.decimals).toBe(18);
  });

  it('is case-insensitive for wallet address matching', () => {
    const result = normalizeTransfer(
      { ...base, to: '0xWALLET' },
      { ...ctx, walletAddress: '0xwallet' },
    );
    expect(result!.direction).toBe('IN');
  });
});

describe('formatAmount', () => {
  it('formats 18-decimal amounts without float errors', () => {
    expect(formatAmount('1500000000000000000', 18)).toBe('1.5');
    expect(formatAmount('1', 18)).toBe('0.000000000000000001');
    expect(formatAmount('0', 18)).toBe('0');
  });

  it('formats 6-decimal USDC amounts', () => {
    expect(formatAmount('1000000', 6)).toBe('1');
    expect(formatAmount('1500000', 6)).toBe('1.5');
    expect(formatAmount('100', 6)).toBe('0.0001');
  });

  it('handles zero-decimal tokens', () => {
    expect(formatAmount('42', 0)).toBe('42');
  });

  it('strips trailing zeros in fractional part', () => {
    expect(formatAmount('1000000000000000000', 18)).toBe('1');
    expect(formatAmount('1100000000000000000', 18)).toBe('1.1');
  });
});
