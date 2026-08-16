import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { formatAmount, SerializedTransaction } from '@ledgerlens/shared';
import { getChainConfig } from '../chain/chain.config';

const CACHE_TTL = 300;

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  private cacheKey(walletId: string) {
    return `wallet:${walletId}:transactions`;
  }

  async invalidateCache(walletId: string) {
    await this.cache.del(this.cacheKey(walletId));
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
    const key = this.cacheKey(walletId);

    if (!options?.skipCache) {
      const cached = await this.cache.get<SerializedTransaction[]>(key);
      if (cached) return cached;
    }

    const txs = await this.prisma.transaction.findMany({
      where: { walletId },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    const serialized = txs.map((tx) => this.serializeTx(tx));

    if (!options?.skipCache) {
      await this.cache.set(key, serialized, CACHE_TTL);
    }

    return serialized;
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
