/** Format raw string amount for display — never uses floats internally. */
export function formatAmount(rawValue: string, decimals: number): string {
  if (decimals === 0) return rawValue;
  const padded = rawValue.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals) || '0';
  const frac = padded.slice(-decimals);
  const trimmedFrac = frac.replace(/0+$/, '');
  return trimmedFrac ? `${whole}.${trimmedFrac}` : whole;
}
