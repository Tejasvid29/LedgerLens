/**
 * Same format across all 6 supported EVM chains (Ethereum, Polygon,
 * Arbitrum, Base, Optimism, Avalanche) — one check covers every chain this
 * app supports, not just Ethereum.
 */
const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export function isValidAddress(address: string): boolean {
  return ADDRESS_PATTERN.test(address);
}
