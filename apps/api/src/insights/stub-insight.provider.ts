import { InsightProvider, InsightRequest, InsightResult, TokenUsage } from './insight-provider.interface';
import { buildInsightPrompt } from './prompt';

/**
 * ~4 characters per token is OpenAI's own commonly-cited rule of thumb for
 * English text — not exact, but close enough to make the stub's usage
 * figures a believable stand-in for a real provider's, which is the whole
 * point: the spend-measurement script (evals/measure-spend.ts) needs
 * *some* number to sum per request when running for free, and an estimate
 * that scales with actual prompt/summary length is far more honest than a
 * flat constant would be. Always labeled "estimated", never presented as
 * a real billed figure.
 */
const CHARS_PER_TOKEN = 4;

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

/**
 * A deterministic, offline InsightProvider that costs nothing to run.
 *
 * It is NOT a language model and doesn't pretend to be — it assembles a
 * summary mechanically from the input, which by construction only ever
 * states figures it was given. That makes it the control case for the eval
 * harness: a perfectly grounded provider. If the graders ever report an
 * ungrounded figure against this stub, the bug is in the graders, not the
 * model.
 *
 * Lives at insights/ rather than insights/evals/ — S17 promoted it from
 * "only for the eval harness" to a real LLM_PROVIDER=stub option
 * (insights.module.ts), the insight-generation counterpart to
 * CHAIN_PROVIDER=fixture (chain/fixture-chain.provider.ts). Both exist so
 * apps/e2e's Playwright suite can exercise the full "sync → see
 * transactions → generate an insight" flow with zero external calls and
 * zero spend, not just so `npm test`/the eval harness can run for free.
 */
export class StubInsightProvider implements InsightProvider {
  async generateInsight(request: InsightRequest): Promise<InsightResult> {
    const summary = this.buildSummary(request);

    return {
      summary,
      model: 'stub',
      generatedAt: new Date().toISOString(),
      usage: this.estimateUsage(request, summary),
    };
  }

  /** Estimated from the same prompt buildInsightPrompt would actually
   *  send to a real model — not from the (much shorter) mechanical
   *  summary text alone, since a real prompt's token cost is dominated by
   *  the input data, not the output. */
  private estimateUsage(request: InsightRequest, summary: string): TokenUsage {
    const { system, user } = buildInsightPrompt(request);
    const promptTokens = estimateTokens(system) + estimateTokens(user);
    const completionTokens = estimateTokens(summary);
    return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
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
