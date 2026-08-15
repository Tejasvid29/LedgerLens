import { Direction, TxStatus } from './types';

/** Unified transaction shape after normalization — all chains collapse here. */
export interface NormalizedTransaction {
  chainId: number;
  hash: string;
  blockNumber: bigint;
  timestamp: Date;
  direction: Direction;
  rawValue: string;
  decimals: number;
  tokenSymbol: string;
  tokenAddress: string | null;
  gasUsed: string | null;
  gasPriceWei: string | null;
  status: TxStatus;
}

export interface RawAlchemyTransfer {
  hash: string;
  blockNum: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract?: {
    value: string | null;
    address: string | null;
    decimal: string | null;
  };
  metadata?: {
    blockTimestamp: string;
  };
}

export interface RawAlchemyAssetTransfer {
  hash: string;
  blockNum: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155' | 'specialnft';
  rawContract?: {
    value: string | null;
    address: string | null;
    decimal: string | null;
  };
  metadata?: {
    blockTimestamp: string;
  };
}

export interface NormalizerContext {
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  walletAddress: string;
}

/**
 * Collapses chain-specific transfer shapes into one schema.
 * Amounts are always stored as raw strings — never floats.
 */
export function normalizeTransfer(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): NormalizedTransaction | null {
  const walletLower = ctx.walletAddress.toLowerCase();
  const fromLower = raw.from.toLowerCase();
  const toLower = raw.to.toLowerCase();

  let direction: Direction;
  if (fromLower === walletLower && toLower === walletLower) {
    direction = 'SELF';
  } else if (toLower === walletLower) {
    direction = 'IN';
  } else if (fromLower === walletLower) {
    direction = 'OUT';
  } else {
    return null;
  }

  const { rawValue, decimals, tokenSymbol, tokenAddress } = extractAmount(raw, ctx);

  const blockNumber = BigInt(parseInt(raw.blockNum, 16));
  const timestamp = raw.metadata?.blockTimestamp
    ? new Date(raw.metadata.blockTimestamp)
    : new Date();

  return {
    chainId: ctx.chainId,
    hash: raw.hash,
    blockNumber,
    timestamp,
    direction,
    rawValue,
    decimals,
    tokenSymbol,
    tokenAddress,
    gasUsed: null,
    gasPriceWei: null,
    status: 'SUCCESS',
  };
}

function extractAmount(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): { rawValue: string; decimals: number; tokenSymbol: string; tokenAddress: string | null } {
  if (raw.category === 'external' || raw.category === 'internal') {
    const rawValue = raw.rawContract?.value ?? weiFromFloat(raw.value, ctx.nativeDecimals);
    return {
      rawValue: rawValue ?? '0',
      decimals: ctx.nativeDecimals,
      tokenSymbol: ctx.nativeSymbol,
      tokenAddress: null,
    };
  }

  if (raw.category === 'erc20') {
    const decimals = parseDecimals(raw.rawContract?.decimal);
    const rawValue = raw.rawContract?.value ?? '0';
    const tokenSymbol = sanitizeSymbol(raw.asset) ?? 'UNKNOWN';
    return {
      rawValue,
      decimals,
      tokenSymbol,
      tokenAddress: raw.rawContract?.address?.toLowerCase() ?? null,
    };
  }

  return {
    rawValue: '0',
    decimals: 0,
    tokenSymbol: sanitizeSymbol(raw.asset) ?? raw.category.toUpperCase(),
    tokenAddress: raw.rawContract?.address?.toLowerCase() ?? null,
  };
}

function parseDecimals(decimal: string | null | undefined): number {
  if (decimal == null) return 18;
  const parsed = parseInt(decimal, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 18;
}

function sanitizeSymbol(asset: string | null | undefined): string | null {
  if (!asset) return null;
  const trimmed = asset.trim();
  if (trimmed.length === 0 || trimmed.length > 20) return null;
  return trimmed;
}

function weiFromFloat(value: number | null, decimals: number): string | null {
  if (value == null || value === 0) return '0';
  const [whole, frac = ''] = value.toString().split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFrac;
  return combined.replace(/^0+/, '') || '0';
}

/** Format raw string amount for display — never uses floats internally. */
export function formatAmount(rawValue: string, decimals: number): string {
  if (decimals === 0) return rawValue;
  const padded = rawValue.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const frac = padded.slice(-decimals);
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}
