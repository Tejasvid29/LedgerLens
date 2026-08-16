/**
 * The data an insight is allowed to be generated from — deliberately
 * narrow (display strings, not raw base units or DB rows) so a provider
 * implementation physically cannot reach past what's given here to invent
 * a figure from somewhere else. See prompt.ts for how this becomes the
 * actual model input.
 */
export interface InsightRequest {
  walletLabel: string | null;
  address: string;
  holdings: {
    chainName: string;
    tokenSymbol: string;
    /** Already-formatted (formatAmount) — never a raw base-unit string or
     *  a JS number. Rule 1: token amounts are strings, never numbers. */
    displayBalance: string;
  }[];
  recentTransactions: {
    chainName: string;
    tokenSymbol: string;
    direction: 'IN' | 'OUT' | 'SELF';
    displayAmount: string;
    timestamp: string;
  }[];
}

export interface InsightResult {
  summary: string;
  model: string;
  generatedAt: string;
}

/**
 * The abstraction InsightsService depends on. Concrete implementations
 * (OpenAIInsightProvider, or anything added later) are wired in only by
 * insights.module.ts's factory provider — InsightsService never imports a
 * concrete provider class, so swapping LLM_PROVIDER never touches it.
 */
export interface InsightProvider {
  generateInsight(request: InsightRequest): Promise<InsightResult>;
}

/** DI token — interfaces don't exist at runtime, so Nest needs a concrete
 *  symbol to bind the factory's output to and for InsightsService to
 *  @Inject() by. */
export const INSIGHT_PROVIDER = Symbol('INSIGHT_PROVIDER');
