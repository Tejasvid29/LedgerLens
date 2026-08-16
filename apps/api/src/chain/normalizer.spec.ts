import {
  normalizeTransfer,
  normalizeTransfers,
  NormalizerContext,
  RawAlchemyAssetTransfer,
} from './normalizer';
import { formatAmount } from '@ledgerlens/shared';

const ctx: NormalizerContext = {
  chainId: 1,
  nativeSymbol: 'ETH',
  nativeDecimals: 18,
  walletAddress: '0xwallet',
};

const base: RawAlchemyAssetTransfer = {
  hash: '0xabc',
  blockNum: '0x64',
  from: '0xsender',
  to: '0xwallet',
  value: 1.5,
  asset: 'ETH',
  category: 'external',
  rawContract: { value: '1500000000000000000', address: null, decimal: null },
  metadata: { blockTimestamp: '2024-01-15T12:00:00.000Z' },
};

/** An ERC-20 transfer with overridable rawContract fields. */
function erc20(
  rawContract: Partial<NonNullable<RawAlchemyAssetTransfer['rawContract']>>,
  overrides: Partial<RawAlchemyAssetTransfer> = {},
): RawAlchemyAssetTransfer {
  return {
    ...base,
    category: 'erc20',
    asset: 'USDC',
    rawContract: { value: '1000000', address: '0xUSDC', decimal: '6', ...rawContract },
    ...overrides,
  };
}

describe('normalizeTransfer — direction', () => {
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
    const result = normalizeTransfer({ ...base, from: '0xwallet', to: '0xrecipient' }, ctx);
    expect(result!.direction).toBe('OUT');
  });

  it('normalizes self transfer', () => {
    const result = normalizeTransfer({ ...base, from: '0xwallet', to: '0xwallet' }, ctx);
    expect(result!.direction).toBe('SELF');
  });

  it('returns null for unrelated transfers', () => {
    expect(normalizeTransfer({ ...base, from: '0xa', to: '0xb' }, ctx)).toBeNull();
  });

  it('is case-insensitive for wallet address matching', () => {
    const result = normalizeTransfer({ ...base, to: '0xWALLET' }, ctx);
    expect(result!.direction).toBe('IN');
  });
});

describe('normalizeTransfer — hash storage (rule 6)', () => {
  it('lowercases the hash so the (chainId, hash, walletId) key dedupes', () => {
    const result = normalizeTransfer({ ...base, hash: '0xAbCdEf' }, ctx);
    expect(result!.hash).toBe('0xabcdef');
  });

  it('lowercases the token address', () => {
    const result = normalizeTransfer(erc20({ address: '0xA0B8Ee' }), ctx);
    expect(result!.tokenAddress).toBe('0xa0b8ee');
  });
});

describe('normalizeTransfer — missing decimal metadata', () => {
  it('defaults ERC-20 decimals to 18 when decimal is null', () => {
    const result = normalizeTransfer(erc20({ decimal: null, value: '999' }), ctx);
    expect(result!.decimals).toBe(18);
  });

  it('defaults to 18 when rawContract is absent entirely', () => {
    const raw = { ...base, category: 'erc20' as const, rawContract: undefined };
    const result = normalizeTransfer(raw, ctx);
    expect(result!.decimals).toBe(18);
    expect(result!.rawValue).toBe('0');
  });

  it('does not record an issue for absent decimals — it is common, not corrupt', () => {
    const { issues } = normalizeTransfers([erc20({ decimal: null })], ctx);
    expect(issues).toHaveLength(0);
  });

  it('uses chain native decimals for native transfers regardless of metadata', () => {
    const result = normalizeTransfer(base, { ...ctx, nativeDecimals: 9, nativeSymbol: 'MATIC' });
    expect(result!.decimals).toBe(9);
    expect(result!.tokenSymbol).toBe('MATIC');
  });
});

describe('normalizeTransfer — decimal-as-hex vs decimal-as-int (rule 5)', () => {
  // parseInt("0x12", 10) === 0. The old radix-10 parse turned an 18-decimal
  // token into a 0-decimal one: an 18-orders-of-magnitude error, silent.
  it('parses hex decimals: "0x12" is 18, not 0', () => {
    const result = normalizeTransfer(erc20({ decimal: '0x12' }), ctx);
    expect(result!.decimals).toBe(18);
  });

  it('parses hex decimals: "0x6" is 6', () => {
    const result = normalizeTransfer(erc20({ decimal: '0x6' }), ctx);
    expect(result!.decimals).toBe(6);
  });

  it('parses uppercase hex: "0X12" is 18', () => {
    const result = normalizeTransfer(erc20({ decimal: '0X12' }), ctx);
    expect(result!.decimals).toBe(18);
  });

  it('parses unprefixed digits as decimal: "18" is 18, not 0x18 (24)', () => {
    const result = normalizeTransfer(erc20({ decimal: '18' }), ctx);
    expect(result!.decimals).toBe(18);
  });

  it('parses "6" as 6', () => {
    const result = normalizeTransfer(erc20({ decimal: '6' }), ctx);
    expect(result!.decimals).toBe(6);
  });

  it('accepts a numeric decimal, which Alchemy occasionally sends untyped', () => {
    const result = normalizeTransfer(erc20({ decimal: 8 }), ctx);
    expect(result!.decimals).toBe(8);
  });

  it('tolerates surrounding whitespace', () => {
    expect(normalizeTransfer(erc20({ decimal: ' 0x12 ' }), ctx)!.decimals).toBe(18);
    expect(normalizeTransfer(erc20({ decimal: ' 6 ' }), ctx)!.decimals).toBe(6);
  });

  it('rejects a partially numeric string instead of silently reading its prefix', () => {
    // parseInt("18abc", 10) === 18 — lenient enough to hide corrupt metadata.
    const { transactions, issues } = normalizeTransfers([erc20({ decimal: '18abc' })], ctx);
    expect(transactions[0].decimals).toBe(18);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-decimals', detail: '18abc' }),
    );
  });

  it('rejects decimals above the uint8 bound and records an issue', () => {
    const { transactions, issues } = normalizeTransfers([erc20({ decimal: '256' })], ctx);
    expect(transactions[0].decimals).toBe(18);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-decimals' }),
    );
  });

  it('rejects negative decimals and records an issue', () => {
    const { transactions, issues } = normalizeTransfers([erc20({ decimal: '-5' })], ctx);
    expect(transactions[0].decimals).toBe(18);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-decimals' }),
    );
  });

  it('keeps the transfer when decimals are unparseable — history is not lost', () => {
    const { transactions } = normalizeTransfers([erc20({ decimal: 'garbage' })], ctx);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].rawValue).toBe('1000000');
  });

  it('parses hex base-unit values, which Alchemy also sends prefixed', () => {
    // 0x16345785d8a0000 === 100000000000000000
    const result = normalizeTransfer(erc20({ value: '0x16345785d8a0000', decimal: '0x12' }), ctx);
    expect(result!.rawValue).toBe('100000000000000000');
    expect(result!.decimals).toBe(18);
  });
});

describe('normalizeTransfer — token reporting 0 decimals', () => {
  it('preserves a genuine 0-decimal token rather than defaulting to 18', () => {
    const result = normalizeTransfer(erc20({ decimal: '0', value: '42' }), ctx);
    expect(result!.decimals).toBe(0);
    expect(result!.rawValue).toBe('42');
  });

  it('preserves 0 decimals sent as hex "0x0"', () => {
    const result = normalizeTransfer(erc20({ decimal: '0x0', value: '42' }), ctx);
    expect(result!.decimals).toBe(0);
  });

  it('preserves 0 decimals sent as the number 0', () => {
    const result = normalizeTransfer(erc20({ decimal: 0, value: '42' }), ctx);
    expect(result!.decimals).toBe(0);
  });

  it('records no issue for 0 decimals — it is valid, not missing', () => {
    const { issues } = normalizeTransfers([erc20({ decimal: '0', value: '42' })], ctx);
    expect(issues).toHaveLength(0);
  });

  it('round-trips through formatAmount without a decimal point', () => {
    const result = normalizeTransfer(erc20({ decimal: '0', value: '42' }), ctx);
    expect(formatAmount(result!.rawValue, result!.decimals)).toBe('42');
  });
});

describe('normalizeTransfer — negative and zero values', () => {
  it('keeps a zero-value ERC-20 transfer (approvals and spam are real history)', () => {
    const { transactions, issues } = normalizeTransfers([erc20({ value: '0' })], ctx);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].rawValue).toBe('0');
    expect(issues).toHaveLength(0);
  });

  it('keeps a zero-value native transfer (contract calls carry no value)', () => {
    const raw = { ...base, value: 0, rawContract: { value: '0', address: null, decimal: null } };
    expect(normalizeTransfer(raw, ctx)!.rawValue).toBe('0');
  });

  it('keeps a zero-value native transfer with no rawContract value', () => {
    const raw = { ...base, value: 0, rawContract: undefined };
    expect(normalizeTransfer(raw, ctx)!.rawValue).toBe('0');
  });

  it('drops a negative ERC-20 value and records why', () => {
    // Base units are unsigned; direction carries the sign. A negative here
    // would silently corrupt holdings aggregation.
    const { transactions, issues } = normalizeTransfers([erc20({ value: '-1000000' })], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'negative-value', detail: '-1000000' }),
    );
  });

  it('drops a negative native value rather than emitting a signed base-unit string', () => {
    const raw = { ...base, value: -1.5, rawContract: undefined };
    const { transactions, issues } = normalizeTransfers([raw], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toContainEqual(expect.objectContaining({ reason: 'negative-value' }));
  });

  it('drops a non-numeric value and records why', () => {
    const { transactions, issues } = normalizeTransfers([erc20({ value: 'abc' })], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-value', detail: 'abc' }),
    );
  });

  it('canonicalizes leading zeros so "007" and "7" are one value', () => {
    expect(normalizeTransfer(erc20({ value: '007' }), ctx)!.rawValue).toBe('7');
  });

  it('preserves values beyond Number.MAX_SAFE_INTEGER exactly (rule 1)', () => {
    const huge = '123456789012345678901234567890';
    const result = normalizeTransfer(erc20({ value: huge, decimal: '0x12' }), ctx);
    expect(result!.rawValue).toBe(huge);
    expect(Number(huge).toString()).not.toBe(huge); // float would have lost it
  });

  it('drops a native value that stringifies to exponential notation', () => {
    // (1e21).toString() === "1e+21"; naive splitting emits "1e+21000...".
    const raw = { ...base, value: 1e21, rawContract: undefined };
    const { transactions, issues } = normalizeTransfers([raw], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'unparseable-value', detail: '1e+21' }),
    );
  });

  it('derives base units from the float only when rawContract.value is absent', () => {
    const raw = { ...base, value: 1.5, rawContract: undefined };
    expect(normalizeTransfer(raw, ctx)!.rawValue).toBe('1500000000000000000');
  });
});

describe('normalizeTransfers — reorg duplicates across pages (rule 6)', () => {
  it('drops a transfer repeated verbatim on a later page', () => {
    const { transactions, duplicatesDropped, issues } = normalizeTransfers(
      [base, { ...base }],
      ctx,
    );
    expect(transactions).toHaveLength(1);
    expect(duplicatesDropped).toBe(1);
    expect(issues).toContainEqual(expect.objectContaining({ reason: 'duplicate-hash' }));
  });

  it('dedupes across hash casing, since storage lowercases', () => {
    const { transactions, duplicatesDropped } = normalizeTransfers(
      [base, { ...base, hash: '0xABC' }],
      ctx,
    );
    expect(transactions).toHaveLength(1);
    expect(duplicatesDropped).toBe(1);
  });

  it('dedupes the overlap between the fromAddress and toAddress queries', () => {
    // A self-transfer is returned by both directional queries.
    const self = { ...base, from: '0xwallet', to: '0xwallet' };
    const { transactions, duplicatesDropped } = normalizeTransfers([self, { ...self }], ctx);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].direction).toBe('SELF');
    expect(duplicatesDropped).toBe(1);
  });

  it('keeps the first version and flags a reorg that rewrote the same hash', () => {
    const reorged = { ...base, blockNum: '0x65' };
    const { transactions, duplicatesDropped, issues } = normalizeTransfers(
      [base, reorged],
      ctx,
    );
    expect(transactions).toHaveLength(1);
    expect(transactions[0].blockNumber).toBe(100n);
    expect(duplicatesDropped).toBe(1);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'duplicate-hash-divergent' }),
    );
  });

  it('flags two different transfers sharing one hash as a divergent collision', () => {
    // The (chainId, hash, walletId) unique key cannot hold both legs of a swap.
    const usdcLeg = erc20({ value: '1000000', address: '0xusdc', decimal: '6' });
    const wethLeg = erc20({ value: '500000000000000000', address: '0xweth', decimal: '0x12' }, {
      asset: 'WETH',
    });
    const { transactions, issues } = normalizeTransfers([usdcLeg, wethLeg], ctx);
    expect(transactions).toHaveLength(1);
    expect(issues).toContainEqual(
      expect.objectContaining({ reason: 'duplicate-hash-divergent' }),
    );
  });

  it('keeps distinct hashes distinct', () => {
    const { transactions, duplicatesDropped } = normalizeTransfers(
      [base, { ...base, hash: '0xdef' }],
      ctx,
    );
    expect(transactions).toHaveLength(2);
    expect(duplicatesDropped).toBe(0);
  });

  it('does not dedupe the same hash across different chains', () => {
    const page = [base];
    const eth = normalizeTransfers(page, ctx).transactions;
    const polygon = normalizeTransfers(page, { ...ctx, chainId: 137 }).transactions;
    expect(eth[0].chainId).not.toBe(polygon[0].chainId);
    expect(eth[0].hash).toBe(polygon[0].hash);
  });
});

describe('normalizeTransfers — batch resilience (rule 4)', () => {
  it('never throws on a malformed block number and keeps the rest of the batch', () => {
    const broken = { ...base, hash: '0xbad', blockNum: 'not-a-block' };
    const { transactions, issues } = normalizeTransfers([broken, { ...base, hash: '0xgood' }], ctx);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].hash).toBe('0xgood');
    expect(issues).toContainEqual(
      expect.objectContaining({ hash: '0xbad', reason: 'invalid-block-number' }),
    );
  });

  it('accepts a decimal block number as well as hex', () => {
    expect(normalizeTransfer({ ...base, blockNum: '100' }, ctx)!.blockNumber).toBe(100n);
  });

  it('drops a transfer with an invalid timestamp instead of storing Invalid Date', () => {
    const broken = { ...base, metadata: { blockTimestamp: 'never' } };
    const { transactions, issues } = normalizeTransfers([broken], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toContainEqual(expect.objectContaining({ reason: 'invalid-timestamp' }));
  });

  it('drops a transfer with no timestamp rather than inventing now()', () => {
    const broken = { ...base, metadata: undefined };
    expect(normalizeTransfers([broken], ctx).transactions).toHaveLength(0);
  });

  it('records no issue for an unrelated transfer — filtering is not an error', () => {
    const { transactions, issues } = normalizeTransfers([{ ...base, from: '0xa', to: '0xb' }], ctx);
    expect(transactions).toHaveLength(0);
    expect(issues).toHaveLength(0);
  });

  it('survives a batch where every transfer is malformed', () => {
    const junk = [
      { ...base, hash: '0x1', blockNum: 'x' },
      { ...base, hash: '0x2', metadata: { blockTimestamp: 'x' } },
      erc20({ value: 'x' }, { hash: '0x3' }),
    ];
    expect(() => normalizeTransfers(junk, ctx)).not.toThrow();
    const { transactions, issues } = normalizeTransfers(junk, ctx);
    expect(transactions).toHaveLength(0);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('handles an empty batch', () => {
    expect(normalizeTransfers([], ctx)).toEqual({
      transactions: [],
      issues: [],
      duplicatesDropped: 0,
    });
  });
});

describe('normalizeTransfers — spam token metadata', () => {
  it('falls back to UNKNOWN for an absurdly long symbol', () => {
    const spam = erc20({}, { asset: 'x'.repeat(200) });
    expect(normalizeTransfer(spam, ctx)!.tokenSymbol).toBe('UNKNOWN');
  });

  it('strips control characters from a symbol', () => {
    const spam = erc20({}, { asset: 'US' + String.fromCharCode(0) + 'D' + String.fromCharCode(31) + 'C' });
    expect(normalizeTransfer(spam, ctx)!.tokenSymbol).toBe('USDC');
  });

  it('falls back to UNKNOWN for an empty or whitespace symbol', () => {
    expect(normalizeTransfer(erc20({}, { asset: '   ' }), ctx)!.tokenSymbol).toBe('UNKNOWN');
    expect(normalizeTransfer(erc20({}, { asset: null }), ctx)!.tokenSymbol).toBe('UNKNOWN');
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

  // Transaction amounts are never negative (the normalizer rejects those —
  // see normalizer.spec.ts), but an aggregated holding balance can be when
  // stored history is missing an inflow. See holdings.ts.
  it('formats a negative amount with a leading "-"', () => {
    expect(formatAmount('-1000000', 6)).toBe('-1');
    expect(formatAmount('-1500000', 6)).toBe('-1.5');
  });

  it('does not render negative zero', () => {
    expect(formatAmount('-0', 6)).toBe('0');
  });

  it('handles a negative zero-decimal amount', () => {
    expect(formatAmount('-42', 0)).toBe('-42');
  });
});
