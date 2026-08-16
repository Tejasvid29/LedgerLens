import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CHAIN_PROVIDER, ChainProvider } from './chain-provider.interface';
import { CHAINS } from './chain.config';

/**
 * How many chains sync concurrently. All chains share one Alchemy API key
 * (see AlchemyService.getClient), so this is a rate-limit budget as much as
 * a concurrency knob — 6 chains fully in parallel would multiply the chance
 * of tripping Alchemy's per-key rate limit on a fresh wallet's first sync.
 */
const SYNC_CONCURRENCY = 3;

export interface ChainSyncError {
  chain: string;
  message: string;
}

export interface SyncResult {
  walletId: string;
  totalSynced: number;
  chains: string[];
  /** One chain failing must not fail the sync. Rule 4's spirit, applied per chain. */
  errors: ChainSyncError[];
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAIN_PROVIDER) private readonly chainProvider: ChainProvider,
  ) {}

  async syncWallet(walletId: string, chains?: string[]): Promise<SyncResult> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
    });

    const chainKeys = chains ?? Object.keys(CHAINS);
    const errors: ChainSyncError[] = [];

    const perChainCounts = await runWithConcurrency(
      chainKeys,
      SYNC_CONCURRENCY,
      (chainKey) => this.syncChain(wallet.address, walletId, chainKey, errors),
    );

    const totalSynced = perChainCounts.reduce((sum, n) => sum + n, 0);

    // Reflects that a sync was attempted, even a partially failed one — the
    // dashboard shouldn't claim data is older than it is because Optimism
    // happened to time out.
    await this.prisma.wallet.update({
      where: { id: walletId },
      data: { lastSyncedAt: new Date() },
    });

    return { walletId, totalSynced, chains: chainKeys, errors };
  }

  /** Syncs one chain. Never throws — a failure is recorded in `errors` instead. */
  private async syncChain(
    walletAddress: string,
    walletId: string,
    chainKey: string,
    errors: ChainSyncError[],
  ): Promise<number> {
    try {
      const txs = await this.chainProvider.fetchTransactions(walletAddress, chainKey);

      for (const tx of txs) {
        await this.prisma.transaction.upsert({
          where: {
            chainId_hash_walletId: {
              chainId: tx.chainId,
              hash: tx.hash,
              walletId,
            },
          },
          create: { ...tx, walletId },
          update: {
            blockNumber: tx.blockNumber,
            timestamp: tx.timestamp,
            direction: tx.direction,
            rawValue: tx.rawValue,
            decimals: tx.decimals,
            tokenSymbol: tx.tokenSymbol,
            tokenAddress: tx.tokenAddress,
            gasUsed: tx.gasUsed,
            gasPriceWei: tx.gasPriceWei,
            status: tx.status,
          },
        });
      }

      return txs.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Sync failed for ${chainKey}: ${message}`);
      errors.push({ chain: chainKey, message });
      return 0;
    }
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight at once.
 *
 * A fixed-size pool of workers each pull the next item off a shared cursor,
 * so a fast chain doesn't wait on a slow one before picking up new work —
 * unlike chunking into batches of `limit`, which stalls a whole batch on
 * its slowest member.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runNext(): Promise<void> {
    const index = cursor++;
    if (index >= items.length) return;
    results[index] = await worker(items[index]);
    return runNext();
  }

  const poolSize = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: poolSize }, () => runNext()));

  return results;
}
