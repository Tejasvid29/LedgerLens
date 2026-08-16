/**
 * Format raw string amount for display — never uses floats internally.
 *
 * Handles a leading "-": transaction amounts are never negative (the
 * normalizer rejects those), but an aggregated holding balance can be, when
 * stored history is missing an inflow. See holdings.ts.
 */
export function formatAmount(rawValue: string, decimals: number): string {
  const negative = rawValue.startsWith('-');
  const magnitude = negative ? rawValue.slice(1) : rawValue;

  const formatted = formatMagnitude(magnitude, decimals);

  return negative && formatted !== '0' ? `-${formatted}` : formatted;
}

function formatMagnitude(rawValue: string, decimals: number): string {
  if (decimals === 0) return rawValue;
  const padded = rawValue.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const frac = padded.slice(-decimals);
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}
