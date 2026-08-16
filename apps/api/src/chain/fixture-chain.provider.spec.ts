import { E2E_FIXTURE_ADDRESS } from '@ledgerlens/shared';
import { FixtureChainProvider } from './fixture-chain.provider';

describe('FixtureChainProvider', () => {
  let provider: FixtureChainProvider;

  beforeEach(() => {
    provider = new FixtureChainProvider();
  });

  it('returns canned transactions for the e2e fixture address', async () => {
    const txs = await provider.fetchTransactions(E2E_FIXTURE_ADDRESS, 'ethereum');
    expect(txs.length).toBeGreaterThan(0);
    expect(txs.every((t) => t.chainId === 1)).toBe(true);
  });

  it('matches the fixture address case-insensitively, like real addresses', async () => {
    const txs = await provider.fetchTransactions(E2E_FIXTURE_ADDRESS.toUpperCase(), 'ethereum');
    expect(txs.length).toBeGreaterThan(0);
  });

  it('returns an empty history for any other address — this is not a general-purpose mock', async () => {
    const txs = await provider.fetchTransactions('0x000000000000000000000000000000000000ab', 'ethereum');
    expect(txs).toEqual([]);
  });

  it('returns an empty history for an unknown chain key', async () => {
    const txs = await provider.fetchTransactions(E2E_FIXTURE_ADDRESS, 'avalanche');
    expect(txs).toEqual([]);
  });

  it('never returns a raw numeric amount — rule 1: amounts are strings', async () => {
    const txs = await provider.fetchTransactions(E2E_FIXTURE_ADDRESS, 'ethereum');
    for (const tx of txs) {
      expect(typeof tx.rawValue).toBe('string');
    }
  });
});
