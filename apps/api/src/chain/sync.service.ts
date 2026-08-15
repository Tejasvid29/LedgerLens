import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AlchemyService } from './alchemy.service';
import { CHAINS } from './chain.config';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly alchemy: AlchemyService,
  ) {}

  async syncWallet(walletId: string, chains?: string[]) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({
      where: { id: walletId },
    });

    const chainKeys = chains ?? Object.keys(CHAINS);
    let totalSynced = 0;

    for (const chainKey of chainKeys) {
      try {
        const txs = await this.alchemy.fetchTransactions(wallet.address, chainKey);

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
          totalSynced++;
        }
      } catch (err) {
        this.logger.error(`Sync failed for ${chainKey}: ${err}`);
      }
    }

    await this.prisma.wallet.update({
      where: { id: walletId },
      data: { lastSyncedAt: new Date() },
    });

    return { walletId, totalSynced, chains: chainKeys };
  }
}
