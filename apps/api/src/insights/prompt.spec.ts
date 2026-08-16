import { buildInsightPrompt } from './prompt';
import { InsightRequest } from './insight-provider.interface';

function makeRequest(overrides: Partial<InsightRequest> = {}): InsightRequest {
  return {
    walletLabel: 'Main wallet',
    address: '0xabc123',
    holdings: [],
    recentTransactions: [],
    ...overrides,
  };
}

describe('buildInsightPrompt', () => {
  it('instructs the model to use only figures present in the input', () => {
    const { system } = buildInsightPrompt(makeRequest());

    expect(system).toMatch(/only the figures given to you/i);
    expect(system).toMatch(/never invent, estimate/i);
  });

  it('instructs the model not to fill gaps with guesses', () => {
    const { system } = buildInsightPrompt(makeRequest());

    expect(system).toMatch(/don't mention it/i);
  });

  it('instructs the model to avoid investment advice and fiat valuations it was never given', () => {
    const { system } = buildInsightPrompt(makeRequest());

    expect(system).toMatch(/investment advice/i);
    expect(system).toMatch(/fiat/i);
  });

  it('renders each holding as a line with its exact display balance, chain, and symbol', () => {
    const { user } = buildInsightPrompt(
      makeRequest({
        holdings: [
          { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1.5' },
          { chainName: 'Polygon', tokenSymbol: 'USDC', displayBalance: '250' },
        ],
      }),
    );

    expect(user).toContain('- 1.5 ETH on Ethereum');
    expect(user).toContain('- 250 USDC on Polygon');
  });

  it('renders each transaction as a line with its exact display amount, direction, and timestamp', () => {
    const { user } = buildInsightPrompt(
      makeRequest({
        recentTransactions: [
          {
            chainName: 'Base',
            tokenSymbol: 'ETH',
            direction: 'IN',
            displayAmount: '0.25',
            timestamp: '2024-01-01T00:00:00.000Z',
          },
        ],
      }),
    );

    expect(user).toContain('- 2024-01-01T00:00:00.000Z: IN 0.25 ETH on Base');
  });

  it('says plainly there are no holdings rather than leaving it ambiguous', () => {
    const { user } = buildInsightPrompt(makeRequest({ holdings: [] }));
    expect(user).toContain('(no holdings)');
  });

  it('says plainly there are no recent transactions rather than leaving it ambiguous', () => {
    const { user } = buildInsightPrompt(makeRequest({ recentTransactions: [] }));
    expect(user).toContain('(no recent transactions)');
  });

  it('falls back to "Unnamed" for a null wallet label, matching the rest of the app (e.g. Sidebar.tsx)', () => {
    const { user } = buildInsightPrompt(makeRequest({ walletLabel: null }));
    expect(user).toContain('Wallet: Unnamed');
  });

  it('is a pure function — same input, same output, no hidden state', () => {
    const request = makeRequest({ holdings: [{ chainName: 'Base', tokenSymbol: 'ETH', displayBalance: '1' }] });

    expect(buildInsightPrompt(request)).toEqual(buildInsightPrompt(request));
  });
});
