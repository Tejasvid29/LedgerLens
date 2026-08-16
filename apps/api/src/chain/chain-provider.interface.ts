import { NormalizedTransaction } from '@ledgerlens/shared';

/**
 * Same provider-behind-an-interface shape as insights/insight-provider
 * .interface.ts (S13) — SyncService depends on this, never on
 * AlchemyService directly, so a second implementation (FixtureChainProvider,
 * added for e2e) is a DI wiring change in chain.module.ts, not a change to
 * SyncService's code or its tests.
 */
export interface ChainProvider {
  fetchTransactions(walletAddress: string, chainKey: string): Promise<NormalizedTransaction[]>;
}

export const CHAIN_PROVIDER = Symbol('CHAIN_PROVIDER');
