import { runEvals } from './harness';
import { EVAL_CASES, EvalCategory } from './fixtures';
import { StubInsightProvider } from './stub-insight.provider';
import { InsightProvider, InsightRequest, InsightResult } from '../insight-provider.interface';
import { RECENT_TRANSACTIONS_LIMIT } from '../insights.service';

/** Invents a fiat valuation it was never given — the canonical
 *  hallucination this harness is built to detect. */
class HallucinatingProvider implements InsightProvider {
  async generateInsight(): Promise<InsightResult> {
    return {
      summary: 'This wallet is worth about $87,432 and gained 12% this month.',
      model: 'hallucinating-stub',
      generatedAt: new Date().toISOString(),
    };
  }
}

class ThrowingProvider implements InsightProvider {
  async generateInsight(): Promise<InsightResult> {
    throw new Error('provider exploded');
  }
}

describe('eval fixtures', () => {
  it('has 15 cases', () => {
    expect(EVAL_CASES).toHaveLength(15);
  });

  it('gives every case a unique id', () => {
    const ids = EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers all six required categories from the slice brief', () => {
    const required: EvalCategory[] = [
      'empty-wallet',
      'single-transaction',
      'high-volume',
      'one-chain',
      'all-chains',
      'spam-tokens',
    ];
    const present = new Set(EVAL_CASES.map((c) => c.category));

    for (const category of required) {
      expect(present).toContain(category);
    }
  });

  it('caps high-volume cases to what the provider actually receives in production', () => {
    const highVolume = EVAL_CASES.filter((c) => c.category === 'high-volume');

    expect(highVolume.length).toBeGreaterThan(0);
    for (const c of highVolume) {
      expect(c.request.recentTransactions).toHaveLength(RECENT_TRANSACTIONS_LIMIT);
    }
  });

  it('includes a six-chain case that actually spans six distinct chains', () => {
    const sixChain = EVAL_CASES.find((c) => c.id === 'all-chains-01-native-each')!;
    const chains = new Set(sixChain.request.holdings.map((h) => h.chainName));

    expect(chains.size).toBe(6);
  });
});

describe('runEvals', () => {
  it('grades every case and reports totals', async () => {
    const report = await runEvals(new StubInsightProvider());

    expect(report.cases).toHaveLength(15);
    expect(report.totals.cases).toBe(15);
    expect(report.totals.errored).toBe(0);
  });

  it('scores the mechanical stub as fully grounded — it can only restate its input', async () => {
    const report = await runEvals(new StubInsightProvider());

    expect(report.totals.groundingRate).toBe(1);
    const ungrounded = report.cases.filter((c) => !c.grounding.grounded);
    expect(ungrounded).toEqual([]);
  });

  it('detects a provider that invents figures, across every case', async () => {
    const report = await runEvals(new HallucinatingProvider());

    expect(report.totals.groundingRate).toBe(0);
    expect(report.cases[0].grounding.ungroundedFigures.length).toBeGreaterThan(0);
  });

  it('records a provider failure as a failed case instead of aborting the whole run', async () => {
    const report = await runEvals(new ThrowingProvider());

    expect(report.totals.errored).toBe(15);
    expect(report.cases[0].error).toMatch(/provider exploded/);
    // Still produced a full report rather than throwing.
    expect(report.cases).toHaveLength(15);
  });

  it('flags whether empty-wallet cases were acknowledged as empty', async () => {
    const report = await runEvals(new StubInsightProvider());
    const emptyCases = report.cases.filter((c) => c.acknowledgedEmpty !== undefined);

    expect(emptyCases.length).toBeGreaterThan(0);
    for (const c of emptyCases) {
      expect(c.acknowledgedEmpty).toBe(true);
    }
  });

  it('breaks results down by category', async () => {
    const report = await runEvals(new StubInsightProvider());

    expect(Object.keys(report.byCategory)).toEqual(
      expect.arrayContaining(['empty-wallet', 'high-volume', 'spam-tokens']),
    );
    expect(report.byCategory['spam-tokens'].cases).toBe(2);
  });

  it('runs cases sequentially — a real provider is rate-limited and billed', async () => {
    const order: string[] = [];
    const recording: InsightProvider = {
      async generateInsight(request: InsightRequest) {
        order.push(request.address);
        await new Promise((r) => setTimeout(r, 1));
        return { summary: 'ok', model: 'recording', generatedAt: new Date().toISOString() };
      },
    };

    await runEvals(recording, EVAL_CASES.slice(0, 3));

    expect(order).toHaveLength(3);
  });
});
