import { Inject, Injectable, Logger } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';
import { CacheService } from '../cache/cache.service';
import {
  INSIGHT_PROVIDER,
  InsightProvider,
  InsightRequest,
  InsightResult,
} from './insight-provider.interface';
import { generateCachedInsight } from './insight-cache';

/** Bounding this keeps the prompt (and the token spend) predictable
 *  regardless of how much history a wallet has accumulated — an insight
 *  is meant to summarize recent activity, not the entire ledger.
 *
 *  Exported so the eval fixtures (evals/fixtures.ts) cap their inputs the
 *  same way production does — a "200+ transactions" eval case must grade
 *  what the provider actually receives, not a wallet-sized list the
 *  provider would never see. Changing this here changes the evals too. */
export const RECENT_TRANSACTIONS_LIMIT = 20;

/** What generateForWallet returns — InsightResult plus whether this
 *  specific call cost anything. `cached` is a service-level fact
 *  (whether the semantic cache had it), not something a provider knows
 *  about itself, so it isn't part of InsightResult. */
export interface InsightResponse extends InsightResult {
  cached: boolean;
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly wallets: WalletsService,
    private readonly cache: CacheService,
    @Inject(INSIGHT_PROVIDER) private readonly provider: InsightProvider,
  ) {}

  /**
   * Caller (InsightsController) has already resolved and ownership-checked
   * the wallet via WalletsService.findById — same pattern S12 established
   * for holdings/transactions, so this only needs the id and the fields it
   * actually renders into the prompt.
   */
  async generateForWallet(
    walletId: string,
    wallet: { label: string | null; address: string },
  ): Promise<InsightResponse> {
    const request = await this.buildRequest(walletId, wallet);
    const { result, cached } = await generateCachedInsight(this.cache, this.provider, request);

    this.logUsage(walletId, result, cached);
    return { ...result, cached };
  }

  private async buildRequest(
    walletId: string,
    wallet: { label: string | null; address: string },
  ): Promise<InsightRequest> {
    const [{ holdings }, transactions] = await Promise.all([
      this.wallets.getHoldings(walletId),
      this.wallets.getTransactions(walletId),
    ]);

    return {
      walletLabel: wallet.label,
      address: wallet.address,
      holdings: holdings.map((h) => ({
        chainName: h.chainName,
        tokenSymbol: h.tokenSymbol,
        displayBalance: h.displayBalance,
      })),
      recentTransactions: transactions.slice(0, RECENT_TRANSACTIONS_LIMIT).map((t) => ({
        chainName: t.chainName,
        tokenSymbol: t.tokenSymbol,
        direction: t.direction,
        displayAmount: t.displayAmount,
        timestamp: t.timestamp,
      })),
    };
  }

  /**
   * "Log token usage per request" (S15) — every call logs a line, whether
   * it spent tokens or not. A cache hit logs the figures the *original*
   * generation cost, explicitly marked as not billed again this time, so
   * reading the logs answers both "what did this cost" and "what did
   * caching save" without cross-referencing anything else.
   */
  private logUsage(walletId: string, result: InsightResult, cached: boolean): void {
    const { promptTokens, completionTokens, totalTokens } = result.usage;
    if (cached) {
      this.logger.log(
        `insight wallet=${walletId} cache=HIT spent=0 tokens (would have cost ${totalTokens}: prompt=${promptTokens} completion=${completionTokens})`,
      );
    } else {
      this.logger.log(
        `insight wallet=${walletId} cache=MISS model=${result.model} spent=${totalTokens} tokens (prompt=${promptTokens} completion=${completionTokens})`,
      );
    }
  }
}
