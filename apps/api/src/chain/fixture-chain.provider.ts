import { Injectable } from '@nestjs/common';
import { E2E_FIXTURE_ADDRESS, NormalizedTransaction } from '@ledgerlens/shared';
import { ChainProvider } from './chain-provider.interface';

/**
 * Deterministic, offline stand-in for AlchemyService — selected via
 * CHAIN_PROVIDER=fixture (see chain.module.ts), the chain-side counterpart
 * to StubInsightProvider (LLM_PROVIDER=stub). Exists so apps/e2e's
 * Playwright suite can exercise "add wallet → sync → see transactions →
 * generate an insight" without a real Alchemy key, a real on-chain
 * address, or non-deterministic live chain data that would make
 * transaction-content assertions flaky.
 *
 * Only ever answers for E2E_FIXTURE_ADDRESS — every other address gets an
 * empty history, same as a real wallet with no on-chain activity would.
 * That keeps this provider useless for anything except the one address the
 * e2e suite actually uses, so it can't accidentally mask a real bug in
 * non-e2e testing/dev flows.
 */
@Injectable()
export class FixtureChainProvider implements ChainProvider {
  async fetchTransactions(
    walletAddress: string,
    chainKey: string,
  ): Promise<NormalizedTransaction[]> {
    if (walletAddress.toLowerCase() !== E2E_FIXTURE_ADDRESS.toLowerCase()) {
      return [];
    }
    return FIXTURE_TRANSACTIONS[chainKey] ?? [];
  }
}

const FIXTURE_TRANSACTIONS: Record<string, NormalizedTransaction[]> = {
  ethereum: [
    {
      chainId: 1,
      hash: '0xe2e000000000000000000000000000000000000000000000000000000001',
      blockNumber: 20_500_001n,
      timestamp: new Date('2026-08-10T14:30:00.000Z'),
      direction: 'IN',
      rawValue: '2500000000000000000', // 2.5 ETH
      decimals: 18,
      tokenSymbol: 'ETH',
      tokenAddress: null,
      gasUsed: null,
      gasPriceWei: null,
      status: 'SUCCESS',
    },
    {
      chainId: 1,
      hash: '0xe2e000000000000000000000000000000000000000000000000000000002',
      blockNumber: 20_500_204n,
      timestamp: new Date('2026-08-12T09:05:00.000Z'),
      direction: 'OUT',
      rawValue: '500000000', // 500 USDC (6 decimals)
      decimals: 6,
      tokenSymbol: 'USDC',
      tokenAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      gasUsed: '21000',
      gasPriceWei: '25000000000',
      status: 'SUCCESS',
    },
  ],
  polygon: [
    {
      chainId: 137,
      hash: '0xe2e000000000000000000000000000000000000000000000000000000003',
      blockNumber: 58_100_010n,
      timestamp: new Date('2026-08-13T18:45:00.000Z'),
      direction: 'IN',
      rawValue: '100000000000000000000', // 100 MATIC
      decimals: 18,
      tokenSymbol: 'MATIC',
      tokenAddress: null,
      gasUsed: null,
      gasPriceWei: null,
      status: 'SUCCESS',
    },
    {
      chainId: 137,
      hash: '0xe2e000000000000000000000000000000000000000000000000000000004',
      blockNumber: 58_100_512n,
      timestamp: new Date('2026-08-14T11:20:00.000Z'),
      direction: 'OUT',
      rawValue: '250000000', // 250 USDC (6 decimals)
      decimals: 6,
      tokenSymbol: 'USDC',
      tokenAddress: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
      gasUsed: '65000',
      gasPriceWei: '30000000000',
      status: 'SUCCESS',
    },
  ],
};
