import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Alchemy, AssetTransfersCategory } from 'alchemy-sdk';
import { NormalizedTransaction } from '@ledgerlens/shared';
import { CHAINS, ChainConfig } from './chain.config';
import { normalizeTransfers, RawAlchemyAssetTransfer } from './normalizer';

@Injectable()
export class AlchemyService {
  private readonly logger = new Logger(AlchemyService.name);
  private readonly clients = new Map<number, Alchemy>();

  constructor(private readonly config: ConfigService) {}

  private getClient(chain: ChainConfig): Alchemy {
    let client = this.clients.get(chain.chainId);
    if (!client) {
      const apiKey = this.config.getOrThrow<string>('ALCHEMY_API_KEY');
      client = new Alchemy({ apiKey, network: chain.network });
      this.clients.set(chain.chainId, client);
    }
    return client;
  }

  async fetchTransactions(
    walletAddress: string,
    chainKey: string,
  ): Promise<NormalizedTransaction[]> {
    const chain = CHAINS[chainKey];
    if (!chain) {
      throw new Error(`Unknown chain: ${chainKey}`);
    }

    const alchemy = this.getClient(chain);
    const address = walletAddress.toLowerCase();

    const [incoming, outgoing] = await Promise.all([
      this.fetchDirection(alchemy, address, 'toAddress'),
      this.fetchDirection(alchemy, address, 'fromAddress'),
    ]);

    const { transactions, issues, duplicatesDropped } = normalizeTransfers(
      [...incoming, ...outgoing],
      {
        chainId: chain.chainId,
        nativeSymbol: chain.nativeSymbol,
        nativeDecimals: chain.nativeDecimals,
        walletAddress: address,
      },
    );

    if (issues.length > 0) {
      const counts = issues.reduce<Record<string, number>>((acc, issue) => {
        acc[issue.reason] = (acc[issue.reason] ?? 0) + 1;
        return acc;
      }, {});
      this.logger.warn(
        `${chainKey}: normalized ${transactions.length} transfers, ` +
          `${duplicatesDropped} duplicates dropped, issues ${JSON.stringify(counts)}`,
      );
    }

    const normalized = [...transactions];
    normalized.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return normalized;
  }

  private async fetchDirection(
    alchemy: Alchemy,
    address: string,
    direction: 'fromAddress' | 'toAddress',
  ): Promise<RawAlchemyAssetTransfer[]> {
    const transfers: RawAlchemyAssetTransfer[] = [];
    let pageKey: string | undefined;

    do {
      const response = await this.withBackoff(() =>
        alchemy.core.getAssetTransfers({
          [direction]: address,
          category: [
            AssetTransfersCategory.EXTERNAL,
            AssetTransfersCategory.INTERNAL,
            AssetTransfersCategory.ERC20,
          ],
          withMetadata: true,
          maxCount: 100,
          pageKey,
        }),
      );

      transfers.push(...(response.transfers as RawAlchemyAssetTransfer[]));
      pageKey = response.pageKey;
    } while (pageKey);

    return transfers;
  }

  private async withBackoff<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= 4) throw err;
      const delay = Math.pow(2, attempt) * 500;
      this.logger.warn(`Alchemy rate limit, retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise((r) => setTimeout(r, delay));
      return this.withBackoff(fn, attempt + 1);
    }
  }

  getSupportedChains(): ChainConfig[] {
    return Object.values(CHAINS);
  }
}
