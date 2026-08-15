import { Direction, TxStatus, NormalizedTransaction } from '@ledgerlens/shared';

export type { NormalizedTransaction };

/**
 * ERC-20 `decimals` is a uint8, so anything outside 0-255 is corrupt metadata,
 * not an exotic token.
 */
const MAX_DECIMALS = 255;

/** Fallback when decimals are missing or unparseable. Matches the ERC-20 norm. */
const DEFAULT_DECIMALS = 18;

const DEC_DIGITS = /^\d+$/;
const HEX_DIGITS = /^0x[0-9a-f]+$/i;
/** C0/C1 control characters — spam tokens embed these to break table layouts. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;

export interface RawAlchemyAssetTransfer {
  hash: string;
  blockNum: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155' | 'specialnft';
  rawContract?: {
    /** Base units. Alchemy sends hex (`"0x16345785d8a0000"`) or decimal digits. */
    value: string | null;
    address: string | null;
    /** Hex (`"0x12"` = 18) or decimal (`"18"` = 18), inconsistently. See parseDecimals. */
    decimal: string | number | null;
  };
  metadata?: {
    blockTimestamp: string;
  };
  /** Alchemy's per-transfer identity. Distinguishes multiple transfers in one tx. */
  uniqueId?: string;
}

export interface NormalizerContext {
  chainId: number;
  nativeSymbol: string;
  nativeDecimals: number;
  walletAddress: string;
}

export type IssueReason =
  | 'unrelated-transfer'
  | 'invalid-block-number'
  | 'invalid-timestamp'
  | 'negative-value'
  | 'unparseable-value'
  | 'unparseable-decimals'
  | 'duplicate-hash'
  | 'duplicate-hash-divergent';

export interface NormalizeIssue {
  hash: string;
  reason: IssueReason;
  detail?: string;
}

export interface NormalizeResult {
  transactions: NormalizedTransaction[];
  /** Non-fatal problems. Rule 4: collect, never throw on a batch. */
  issues: NormalizeIssue[];
  /** Transfers dropped because (chainId, hash) was already seen this batch. */
  duplicatesDropped: number;
}

interface SingleResult {
  transaction: NormalizedTransaction | null;
  issues: NormalizeIssue[];
}

/**
 * Normalize a page-spanning batch of raw transfers.
 *
 * Dedupes on (chainId, hash) — the DB unique key minus walletId, which is fixed
 * for a batch. Alchemy returns the same transfer on multiple pages after a
 * reorg, and the `fromAddress`/`toAddress` queries overlap on self-transfers.
 *
 * Never throws. A malformed transfer costs that transfer and an entry in
 * `issues`; the rest of the batch survives.
 */
export function normalizeTransfers(
  raws: RawAlchemyAssetTransfer[],
  ctx: NormalizerContext,
): NormalizeResult {
  const transactions: NormalizedTransaction[] = [];
  const issues: NormalizeIssue[] = [];
  const seen = new Map<string, NormalizedTransaction>();
  let duplicatesDropped = 0;

  for (const raw of raws) {
    let result: SingleResult;
    try {
      result = normalizeOne(raw, ctx);
    } catch (err) {
      // Defensive: nothing below should throw, but one bad transfer must never
      // cost the user the rest of their history.
      issues.push({
        hash: safeHash(raw),
        reason: 'unparseable-value',
        detail: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    issues.push(...result.issues);
    const tx = result.transaction;
    if (!tx) continue;

    const key = `${tx.chainId}:${tx.hash}`;
    const existing = seen.get(key);
    if (existing) {
      duplicatesDropped++;
      if (divergent(existing, tx)) {
        // Same hash, different content across pages. Either a reorg rewrote the
        // tx or one tx carries several transfers the (chainId, hash, walletId)
        // unique key cannot represent. Keep the first, surface the collision.
        issues.push({
          hash: tx.hash,
          reason: 'duplicate-hash-divergent',
          detail: `kept ${existing.tokenSymbol} ${existing.rawValue}, dropped ${tx.tokenSymbol} ${tx.rawValue}`,
        });
      } else {
        issues.push({ hash: tx.hash, reason: 'duplicate-hash' });
      }
      continue;
    }

    seen.set(key, tx);
    transactions.push(tx);
  }

  return { transactions, issues, duplicatesDropped };
}

/**
 * Normalize a single transfer. Returns null when the transfer does not involve
 * the wallet or is malformed beyond recovery.
 */
export function normalizeTransfer(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): NormalizedTransaction | null {
  return normalizeOne(raw, ctx).transaction;
}

function normalizeOne(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): SingleResult {
  const issues: NormalizeIssue[] = [];
  const hash = safeHash(raw);

  const direction = resolveDirection(raw, ctx);
  if (!direction) {
    return { transaction: null, issues };
  }

  const blockNumber = parseBlockNumber(raw.blockNum);
  if (blockNumber == null) {
    issues.push({ hash, reason: 'invalid-block-number', detail: String(raw.blockNum) });
    return { transaction: null, issues };
  }

  const timestamp = parseTimestamp(raw.metadata?.blockTimestamp);
  if (!timestamp) {
    issues.push({
      hash,
      reason: 'invalid-timestamp',
      detail: String(raw.metadata?.blockTimestamp),
    });
    return { transaction: null, issues };
  }

  const amount = extractAmount(raw, ctx);
  issues.push(...amount.issues.map((i) => ({ ...i, hash })));
  if (amount.rawValue == null) {
    return { transaction: null, issues };
  }

  return {
    transaction: {
      chainId: ctx.chainId,
      // Rule 6: hashes are lowercased before storage. The dedupe key is
      // (chainId, hash, walletId) — mixed casing silently creates a second row.
      hash,
      blockNumber,
      timestamp,
      direction,
      rawValue: amount.rawValue,
      decimals: amount.decimals,
      tokenSymbol: amount.tokenSymbol,
      tokenAddress: amount.tokenAddress,
      gasUsed: null,
      gasPriceWei: null,
      status: 'SUCCESS' satisfies TxStatus,
    },
    issues,
  };
}

function resolveDirection(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): Direction | null {
  const wallet = ctx.walletAddress.toLowerCase();
  const from = (raw.from ?? '').toLowerCase();
  const to = (raw.to ?? '').toLowerCase();

  if (from === wallet && to === wallet) return 'SELF';
  if (to === wallet) return 'IN';
  if (from === wallet) return 'OUT';
  return null;
}

interface AmountResult {
  /** null means the transfer is unusable and should be dropped. */
  rawValue: string | null;
  decimals: number;
  tokenSymbol: string;
  tokenAddress: string | null;
  issues: Omit<NormalizeIssue, 'hash'>[];
}

function extractAmount(
  raw: RawAlchemyAssetTransfer,
  ctx: NormalizerContext,
): AmountResult {
  const issues: Omit<NormalizeIssue, 'hash'>[] = [];
  const tokenAddress = raw.rawContract?.address?.toLowerCase() ?? null;

  if (raw.category === 'external' || raw.category === 'internal') {
    const fromRaw = parseBaseUnits(raw.rawContract?.value);
    if (fromRaw.issue) issues.push(fromRaw.issue);

    let rawValue = fromRaw.value;
    if (rawValue == null && fromRaw.issue == null) {
      const fromFloat = baseUnitsFromFloat(raw.value, ctx.nativeDecimals);
      if (fromFloat.issue) issues.push(fromFloat.issue);
      rawValue = fromFloat.value;
    }

    return {
      rawValue,
      decimals: ctx.nativeDecimals,
      tokenSymbol: ctx.nativeSymbol,
      tokenAddress: null,
      issues,
    };
  }

  if (raw.category === 'erc20') {
    const decimals = parseDecimals(raw.rawContract?.decimal);
    if (decimals.issue) issues.push(decimals.issue);

    const parsed = parseBaseUnits(raw.rawContract?.value);
    if (parsed.issue) issues.push(parsed.issue);

    return {
      // A missing ERC-20 value is a legitimate zero-value transfer (approvals,
      // spam), not a parse failure. Only an unparseable one drops the transfer.
      rawValue: parsed.issue ? null : (parsed.value ?? '0'),
      decimals: decimals.value,
      tokenSymbol: sanitizeSymbol(raw.asset) ?? 'UNKNOWN',
      tokenAddress,
      issues,
    };
  }

  // NFTs: quantity lives outside rawContract.value and is not modeled yet.
  return {
    rawValue: '0',
    decimals: 0,
    tokenSymbol: sanitizeSymbol(raw.asset) ?? raw.category.toUpperCase(),
    tokenAddress,
    issues,
  };
}

/**
 * Alchemy reports `rawContract.decimal` as a hex string (`"0x12"` = 18) or as
 * decimal digits (`"18"` = 18), inconsistently, and occasionally as a number.
 *
 * The `0x` prefix disambiguates: hex is always prefixed, so unprefixed digits
 * are decimal. `parseInt(decimal, 10)` on `"0x12"` returns 0 — a silent
 * 18-orders-of-magnitude error, not a crash.
 */
function parseDecimals(decimal: string | number | null | undefined): {
  value: number;
  issue?: Omit<NormalizeIssue, 'hash'>;
} {
  if (decimal == null) {
    // Absent metadata is common and not an error; 18 is the ERC-20 default.
    return { value: DEFAULT_DECIMALS };
  }

  if (typeof decimal === 'number') {
    return Number.isInteger(decimal) && decimal >= 0 && decimal <= MAX_DECIMALS
      ? { value: decimal }
      : {
          value: DEFAULT_DECIMALS,
          issue: { reason: 'unparseable-decimals', detail: String(decimal) },
        };
  }

  const trimmed = decimal.trim();
  let parsed: number;

  if (HEX_DIGITS.test(trimmed)) {
    parsed = parseInt(trimmed.slice(2), 16);
  } else if (DEC_DIGITS.test(trimmed)) {
    // Full-string match, so "18abc" is rejected rather than silently read as 18.
    parsed = parseInt(trimmed, 10);
  } else {
    return {
      value: DEFAULT_DECIMALS,
      issue: { reason: 'unparseable-decimals', detail: trimmed },
    };
  }

  if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_DECIMALS) {
    return {
      value: DEFAULT_DECIMALS,
      issue: { reason: 'unparseable-decimals', detail: trimmed },
    };
  }

  return { value: parsed };
}

/**
 * Parse a base-unit amount. Accepts hex (`"0x..."`) or decimal digits, both of
 * which Alchemy emits. Stays a string throughout — 18-decimal values exceed
 * Number.MAX_SAFE_INTEGER.
 */
function parseBaseUnits(value: string | null | undefined): {
  value: string | null;
  issue?: Omit<NormalizeIssue, 'hash'>;
} {
  if (value == null) return { value: null };

  const trimmed = value.trim();
  if (trimmed === '') return { value: null };

  if (trimmed.startsWith('-')) {
    // Base units are unsigned; direction carries the sign. A negative here
    // would corrupt holdings aggregation downstream.
    return { value: null, issue: { reason: 'negative-value', detail: trimmed } };
  }

  if (HEX_DIGITS.test(trimmed)) {
    return { value: BigInt(trimmed).toString() };
  }

  if (DEC_DIGITS.test(trimmed)) {
    // Strip leading zeros so "007" and "7" dedupe to one canonical form.
    return { value: BigInt(trimmed).toString() };
  }

  return { value: null, issue: { reason: 'unparseable-value', detail: trimmed } };
}

/**
 * Fallback for native transfers with no rawContract.value. Alchemy's `value` is
 * a float, so this is lossy by construction — used only when the exact base-unit
 * string is absent.
 */
function baseUnitsFromFloat(
  value: number | null,
  decimals: number,
): { value: string | null; issue?: Omit<NormalizeIssue, 'hash'> } {
  if (value == null) return { value: '0' };
  if (!Number.isFinite(value)) {
    return { value: null, issue: { reason: 'unparseable-value', detail: String(value) } };
  }
  if (value < 0) {
    return { value: null, issue: { reason: 'negative-value', detail: String(value) } };
  }
  if (value === 0) return { value: '0' };

  const asString = value.toString();
  if (asString.includes('e') || asString.includes('E')) {
    // toString() switched to exponential (>=1e21 or <1e-6). Naive splitting
    // would emit "1e+21000..." as a base-unit string.
    return { value: null, issue: { reason: 'unparseable-value', detail: asString } };
  }

  const [whole, frac = ''] = asString.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  const combined = `${whole}${paddedFrac}`.replace(/^0+/, '');
  return { value: combined || '0' };
}

function parseBlockNumber(blockNum: string | null | undefined): bigint | null {
  if (blockNum == null) return null;
  const trimmed = String(blockNum).trim();

  try {
    if (HEX_DIGITS.test(trimmed)) return BigInt(trimmed);
    if (DEC_DIGITS.test(trimmed)) return BigInt(trimmed);
  } catch {
    return null;
  }
  return null;
}

function parseTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  // An Invalid Date survives until Prisma rejects it, far from the cause.
  return Number.isNaN(date.getTime()) ? null : date;
}

function sanitizeSymbol(asset: string | null | undefined): string | null {
  if (!asset) return null;
  const cleaned = asset.replace(CONTROL_CHARS, '').trim();
  if (cleaned.length === 0 || cleaned.length > 20) return null;
  return cleaned;
}

function safeHash(raw: RawAlchemyAssetTransfer): string {
  return (raw?.hash ?? '').toLowerCase();
}

function divergent(a: NormalizedTransaction, b: NormalizedTransaction): boolean {
  return (
    a.rawValue !== b.rawValue ||
    a.decimals !== b.decimals ||
    a.tokenSymbol !== b.tokenSymbol ||
    a.tokenAddress !== b.tokenAddress ||
    a.direction !== b.direction ||
    a.blockNumber !== b.blockNumber
  );
}
