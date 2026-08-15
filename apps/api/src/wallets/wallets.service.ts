import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { formatAmount } from '../chain/normalizer';
import { getChainConfig } from '../chain/chain.config';

const CACHE_TTL = 300; // 5 minutes — baseline measurement uses refresh=true to bypass

@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

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

  async getTransactions(walletId: string) {
    const cacheKey = `wallet:${walletId}:transactions`;

    const cached = await this.cache.get<ReturnType<typeof this.serializeTx>[]>(cacheKey);
    if (cached) return cached;

    const txs = await this.prisma.transaction.findMany({
      where: { walletId },
      orderBy: { timestamp: 'desc' },
      take: 500,
    });

    const serialized = txs.map((tx) => this.serializeTx(tx));
    await this.cache.set(cacheKey, serialized, CACHE_TTL);
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
  }) {
    const chain = getChainConfig(tx.chainId);
    return {
      id: tx.id,
      chainId: tx.chainId,
      chainName: chain?.name ?? `Chain ${tx.chainId}`,
      hash: tx.hash,
      blockNumber: tx.blockNumber.toString(),
      timestamp: tx.timestamp.toISOString(),
      direction: tx.direction,
      rawValue: tx.rawValue,
      decimals: tx.decimals,
      displayAmount: formatAmount(tx.rawValue, tx.decimals),
      tokenSymbol: tx.tokenSymbol,
      tokenAddress: tx.tokenAddress,
      status: tx.status,
    };
  }
}
