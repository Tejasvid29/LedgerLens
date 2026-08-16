import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { formatAmount, SerializedHolding, SerializedTransaction } from '@ledgerlens/shared';
import { getChainConfig } from '../chain/chain.config';
import { AggregatedHolding, aggregateHoldings, HoldingIssue } from './holdings';
import {
  CACHE_POLICIES,
  walletDerivedKeys,
  walletHoldingsKey,
  walletTransactionsKey,
} from '../cache/cache.policy';

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Clears every read model derived from this wallet's transactions.
   *
   * Holdings and transactions are two views of the same rows — dropping one
   * without the other lets the UI show a transfer that the balance above it
   * doesn't include. walletDerivedKeys() is the single source of that list.
   */
  async invalidateCache(walletId: string) {
    await this.cache.del(...walletDerivedKeys(walletId));
  }

  async list() {
    return this.prisma.wallet.findMany({
      orderBy: { id: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async create(address: string, label?: string) {
    const normalized = address.toLowerCase();

    let user = await this.prisma.user.findFirst();
    if (!user) {
      user = await this.prisma.user.create({
        data: { email: 'demo@ledgerlens.app' },
      });
    }

    return this.prisma.wallet.upsert({
      where: { userId_address: { userId: user.id, address: normalized } },
      create: { address: normalized, label, userId: user.id },
      update: { label: label ?? undefined },
    });
  }

  async findById(id: string) {
    return this.prisma.wallet.findUnique({
      where: { id },
      include: { _count: { select: { transactions: true, holdings: true } } },
    });
  }

  async getTransactions(
    walletId: string,
    options?: { skipCache?: boolean },
  ): Promise<SerializedTransaction[]> {
    const load = async () => {
      const txs = await this.prisma.transaction.findMany({
        where: { walletId },
        orderBy: { timestamp: 'desc' },
        take: 500,
      });
      return txs.map((tx) => this.serializeTx(tx));
    };

    // skipCache is the baseline-measurement path (see docs/benchmarks) and the
    // explicit ?nocache=true escape hatch — it must not read *or* write, or a
    // baseline run would warm the cache it is supposed to be measuring without.
    if (options?.skipCache) {
      return load();
    }

    return this.cache.swr<SerializedTransaction[]>(
      walletTransactionsKey(walletId),
      CACHE_POLICIES.walletTransactions,
      load,
    );
  }

  /**
   * Current per-token, per-chain balances, computed from stored transactions
   * (not a cached snapshot — see holdings.ts for why this reads straight
   * from the ledger every time rather than a materialized Holding row).
   */
  async getHoldings(
    walletId: string,
  ): Promise<{ holdings: SerializedHolding[]; issues: HoldingIssue[] }> {
    const load = async () => {
      const txs = await this.prisma.transaction.findMany({
        where: { walletId },
        select: {
          chainId: true,
          tokenAddress: true,
          tokenSymbol: true,
          rawValue: true,
          decimals: true,
          direction: true,
          status: true,
          timestamp: true,
        },
      });

      const { holdings, issues } = aggregateHoldings(
        txs.map((tx) => ({
          ...tx,
          direction: tx.direction as SerializedTransaction['direction'],
          status: tx.status as SerializedTransaction['status'],
        })),
      );

      return { holdings: holdings.map((h) => this.serializeHolding(h)), issues };
    };

    return this.cache.swr(walletHoldingsKey(walletId), CACHE_POLICIES.walletHoldings, load);
  }

  private serializeHolding(h: AggregatedHolding): SerializedHolding {
    const chain = getChainConfig(h.chainId);
    return {
      chainId: h.chainId,
      chainName: chain?.name ?? `Chain ${h.chainId}`,
      tokenAddress: h.tokenAddress,
      tokenSymbol: h.tokenSymbol,
      rawBalance: h.rawBalance,
      decimals: h.decimals,
      displayBalance: formatAmount(h.rawBalance, h.decimals),
    };
  }

  private serializeTx(tx: {
    id: string;
    chainId: number;
    hash: string;
    blockNumber: bigint;
    timestamp: Date;
    direction: string;
    rawValue: string;
    decimals: number;
    tokenSymbol: string;
    tokenAddress: string | null;
    status: string;
  }): SerializedTransaction {
    const chain = getChainConfig(tx.chainId);
    return {
      id: tx.id,
      chainId: tx.chainId,
      chainName: chain?.name ?? `Chain ${tx.chainId}`,
      hash: tx.hash,
      blockNumber: tx.blockNumber.toString(),
      timestamp: tx.timestamp.toISOString(),
      direction: tx.direction as SerializedTransaction['direction'],
      rawValue: tx.rawValue,
      decimals: tx.decimals,
      displayAmount: formatAmount(tx.rawValue, tx.decimals),
      tokenSymbol: tx.tokenSymbol,
      tokenAddress: tx.tokenAddress,
      status: tx.status as SerializedTransaction['status'],
    };
  }
}
