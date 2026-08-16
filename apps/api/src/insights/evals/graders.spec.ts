import { gradeGrounding, gradeCoverage } from './graders';
import { InsightRequest } from '../insight-provider.interface';

function request(overrides: Partial<InsightRequest> = {}): InsightRequest {
  return {
    walletLabel: 'Main',
    address: '0xabc',
    holdings: [],
    recentTransactions: [],
    ...overrides,
  };
}

describe('gradeGrounding', () => {
  const withOneHolding = request({
    holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1.5' }],
  });

  it('passes a summary that only quotes figures present in the input', () => {
    const result = gradeGrounding(withOneHolding, 'You hold 1.5 ETH on Ethereum.');

    expect(result.grounded).toBe(true);
    expect(result.ungroundedFigures).toEqual([]);
  });

  it('catches an invented figure — the failure this harness exists for', () => {
    const result = gradeGrounding(withOneHolding, 'You hold 1.5 ETH, worth about $4200 today.');

    expect(result.grounded).toBe(false);
    expect(result.ungroundedFigures).toContain('4200');
  });

  it('catches a figure that was rounded rather than quoted exactly', () => {
    const result = gradeGrounding(withOneHolding, 'You hold roughly 2 ETH.');

    expect(result.grounded).toBe(false);
    expect(result.ungroundedFigures).toContain('2');
  });

  it('treats trailing-zero and comma variants as the same figure', () => {
    const req = request({
      holdings: [{ chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '4820.15' }],
    });

    expect(gradeGrounding(req, 'Balance: 4,820.15 USDC.').grounded).toBe(true);
    expect(gradeGrounding(request({
      holdings: [{ chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '1.50' }],
    }), 'Balance: 1.5 USDC.').grounded).toBe(true);
  });

  it('does not treat 1.5 and 15 as the same figure', () => {
    const result = gradeGrounding(withOneHolding, 'You hold 15 ETH.');

    expect(result.grounded).toBe(false);
    expect(result.ungroundedFigures).toContain('15');
  });

  it('allows counts the model can legitimately derive by counting the input', () => {
    const req = request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' },
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '2' },
      ],
    });

    // "2 tokens across 2 chains" — neither 2 is a balance, both are counts.
    expect(gradeGrounding(req, 'You hold 2 tokens across 2 chains.').grounded).toBe(true);
  });

  it('allows quoting a timestamp that appeared in the input', () => {
    const req = request({
      recentTransactions: [
        {
          chainName: 'Ethereum',
          tokenSymbol: 'ETH',
          direction: 'IN',
          displayAmount: '1',
          timestamp: '2024-03-14T00:00:00.000Z',
        },
      ],
    });

    expect(gradeGrounding(req, 'Most recent activity was on 2024-03-14.').grounded).toBe(true);
  });

  it('preserves full 18-decimal precision rather than collapsing it through a float', () => {
    const req = request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '0.000000000000000001' },
      ],
    });

    expect(gradeGrounding(req, 'You hold 0.000000000000000001 ETH.').grounded).toBe(true);
    // A float round-trip would make these two indistinguishable.
    expect(gradeGrounding(req, 'You hold 0.000000000000000002 ETH.').grounded).toBe(false);
  });

  it('grounds a summary with no figures at all — nothing stated, nothing to invent', () => {
    expect(gradeGrounding(withOneHolding, 'This wallet has some activity.').grounded).toBe(true);
  });

  it('does not read digits inside a spam token symbol as a stated figure', () => {
    // Regression: the spam-token eval case caught this. The wallet holds
    // 100000 of a token *named* "$1000-CLAIM" — the 1000 belongs to the
    // identifier, not to any balance.
    const req = request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: '$1000-CLAIM', displayBalance: '100000' }],
    });

    const result = gradeGrounding(req, 'You hold 100000 $1000-CLAIM on Ethereum.');

    expect(result.grounded).toBe(true);
    expect(result.ungroundedFigures).toEqual([]);
  });

  it('does not read the hex digits of the wallet address as stated figures', () => {
    const req = request({
      address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' }],
    });

    const result = gradeGrounding(
      req,
      'Wallet 0xd8da6bf26964af9d7eed9e03e53415d37aa96045 holds 1 ETH.',
    );

    expect(result.grounded).toBe(true);
  });

  it('still catches an invented figure sitting next to a digit-bearing symbol', () => {
    // Redaction must not become a blanket excuse — a real hallucination
    // in the same sentence as a spam symbol is still a hallucination.
    const req = request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: '$1000-CLAIM', displayBalance: '100000' }],
    });

    const result = gradeGrounding(req, 'You hold 100000 $1000-CLAIM, worth $250 today.');

    expect(result.grounded).toBe(false);
    expect(result.ungroundedFigures).toContain('250');
  });
});

describe('gradeCoverage', () => {
  it('scores 1 when every token and chain is mentioned', () => {
    const req = request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' }],
    });

    expect(gradeCoverage(req, 'You hold 1 ETH on Ethereum.').score).toBe(1);
  });

  it('catches a grounded-but-useless summary that says nothing specific', () => {
    const req = request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' }],
    });

    // Perfectly grounded (states no figures), but covers nothing.
    const coverage = gradeCoverage(req, 'You have a wallet with some assets.');

    expect(coverage.score).toBe(0);
    expect(coverage.missing).toEqual(expect.arrayContaining(['ETH', 'Ethereum']));
  });

  it('scores partial coverage proportionally', () => {
    const req = request({
      holdings: [
        { chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' },
        { chainName: 'Base', tokenSymbol: 'USDC', displayBalance: '2' },
      ],
    });

    // Mentions ETH + Ethereum, omits USDC + Base → 2 of 4.
    expect(gradeCoverage(req, 'You hold 1 ETH on Ethereum.').score).toBe(0.5);
  });

  it('is case-insensitive when matching symbols and chain names', () => {
    const req = request({
      holdings: [{ chainName: 'Ethereum', tokenSymbol: 'ETH', displayBalance: '1' }],
    });

    expect(gradeCoverage(req, 'you hold 1 eth on ethereum.').score).toBe(1);
  });

  it('scores an empty wallet 1 rather than punishing a correct empty summary', () => {
    expect(gradeCoverage(request(), 'This wallet has no holdings.').score).toBe(1);
  });
});
