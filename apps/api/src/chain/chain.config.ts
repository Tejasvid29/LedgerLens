import { Network } from 'alchemy-sdk';

export interface ChainConfig {
  chainId: number;
  name: string;
  network: Network;
  nativeSymbol: string;
  nativeDecimals: number;
}

export const CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    network: Network.ETH_MAINNET,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    network: Network.MATIC_MAINNET,
    nativeSymbol: 'MATIC',
    nativeDecimals: 18,
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum',
    network: Network.ARB_MAINNET,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
  },
  base: {
    chainId: 8453,
    name: 'Base',
    network: Network.BASE_MAINNET,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    network: Network.OPT_MAINNET,
    nativeSymbol: 'ETH',
    nativeDecimals: 18,
  },
  avalanche: {
    chainId: 43114,
    name: 'Avalanche',
    network: Network.AVAX_MAINNET,
    nativeSymbol: 'AVAX',
    nativeDecimals: 18,
  },
};

export const CHAIN_BY_ID = Object.fromEntries(
  Object.values(CHAINS).map((c) => [c.chainId, c]),
);

export function getChainConfig(chainId: number): ChainConfig | undefined {
  return CHAIN_BY_ID[chainId];
}
