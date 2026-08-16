interface LedgerAmountProps {
  /** A pre-formatted amount string from formatAmount(), e.g. "1.5", "-1000000", "0.000000000000000001". */
  value: string;
  /**
   * A glyph placed immediately before the whole part, inside the same
   * right-aligned span — e.g. a direction's "+"/"−". Transaction amounts are
   * never negative (the normalizer rejects those), so this is the sign
   * source for transactions; `value`'s own leading "-" is what a negative
   * holding balance uses instead. The two are mutually exclusive in
   * practice, and both just render before the whole digits either way.
   */
  prefix?: string;
  className?: string;
}

/**
 * Renders an amount with the decimal point aligned down a column.
 *
 * Right-aligning the raw string doesn't align decimal points once amounts
 * have different digit counts on either side of them ("1.5" under
 * "1500.25" lands its "5" under nothing meaningful). This splits whole and
 * fractional parts into two spans: the whole part right-aligns into the
 * flexible remainder of the cell, the fractional part left-aligns into a
 * fixed-width column — so every row's decimal point sits at the same
 * horizontal position regardless of magnitude.
 *
 * The fixed width (7ch: a dot plus six digits) covers ordinary display
 * amounts. A rawValue at full 18-decimal precision with no trailing zeros
 * to strip (dust amounts near the smallest possible unit) can exceed it —
 * that row overflows its column rather than staying pinned, which is an
 * acceptable trade for keeping the common case honestly aligned rather than
 * truncating precision to force every row to fit.
 */
export function LedgerAmount({ value, prefix, className = '' }: LedgerAmountProps) {
  const negative = value.startsWith('-');
  const magnitude = negative ? value.slice(1) : value;
  const [whole, frac] = magnitude.split('.');

  return (
    <span className={`tabular-amount inline-flex w-full font-mono ${className}`}>
      <span className="flex-1 text-right">
        {prefix}
        {negative && '−'}
        {whole}
      </span>
      <span className="w-[7ch] shrink-0 text-left text-ink/50">{frac ? `.${frac}` : ''}</span>
    </span>
  );
}
