import { InsightProvider, InsightRequest, InsightResult } from '../insight-provider.interface';

/**
 * A deterministic, offline InsightProvider that costs nothing to run.
 *
 * It is NOT a language model and doesn't pretend to be — it assembles a
 * summary mechanically from the input, which by construction only ever
 * states figures it was given. That makes it the control case for the
 * harness: a perfectly grounded provider. If the graders ever report an
 * ungrounded figure against this stub, the bug is in the graders, not the
 * model.
 *
 * It's also what makes the eval suite runnable in `npm test` and in CI
 * with no API key and no spend.
 */
export class StubInsightProvider implements InsightProvider {
  async generateInsight(request: InsightRequest): Promise<InsightResult> {
    return {
      summary: this.buildSummary(request),
      model: 'stub',
      generatedAt: new Date().toISOString(),
    };
  }

  private buildSummary(request: InsightRequest): string {
    const { holdings, recentTransactions } = request;

    if (holdings.length === 0 && recentTransactions.length === 0) {
      return 'This wallet has no holdings and no recent transactions.';
    }

    if (holdings.length === 0) {
      return `This wallet has no holdings — every synced balance nets to zero across ${recentTransactions.length} recent transactions.`;
    }

    const chains = Array.from(new Set(holdings.map((h) => h.chainName)));
    const holdingsList = holdings
      .map((h) => `${h.displayBalance} ${h.tokenSymbol} on ${h.chainName}`)
      .join(', ');

    const activity =
      recentTransactions.length === 0
        ? 'There are no recent transactions.'
        : `The most recent activity covers ${recentTransactions.length} transactions.`;

    return `This wallet holds ${holdingsList}, across ${chains.length} chains. ${activity}`;
  }
}
