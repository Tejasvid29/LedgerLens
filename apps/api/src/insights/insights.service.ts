import { Inject, Injectable } from '@nestjs/common';
import { WalletsService } from '../wallets/wallets.service';
import { INSIGHT_PROVIDER, InsightProvider, InsightResult } from './insight-provider.interface';

/** Bounding this keeps the prompt (and the token spend) predictable
 *  regardless of how much history a wallet has accumulated — an insight
 *  is meant to summarize recent activity, not the entire ledger.
 *
 *  Exported so the eval fixtures (evals/fixtures.ts) cap their inputs the
 *  same way production does — a "200+ transactions" eval case must grade
 *  what the provider actually receives, not a wallet-sized list the
 *  provider would never see. Changing this here changes the evals too. */
export const RECENT_TRANSACTIONS_LIMIT = 20;

@Injectable()
export class InsightsService {
  constructor(
    private readonly wallets: WalletsService,
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
  ): Promise<InsightResult> {
    const [{ holdings }, transactions] = await Promise.all([
      this.wallets.getHoldings(walletId),
      this.wallets.getTransactions(walletId),
    ]);

    return this.provider.generateInsight({
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
    });
  }
}
