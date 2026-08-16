import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { formatAmount, isValidAddress, SerializedHolding, SerializedTransaction } from '@ledgerlens/shared';
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

  async list(userId: string) {
    return this.prisma.wallet.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      include: { _count: { select: { transactions: true } } },
    });
  }

  async create(userId: string, address: string, label?: string) {
    // Validate before lowercasing/storage — same 0x+40-hex format across all
    // 6 supported chains, so one check covers every chain, not just
    // Ethereum. The client validates too, but this must not trust that: a
    // direct API call bypasses the browser form entirely.
    if (!isValidAddress(address)) {
      throw new BadRequestException('Address must be a 0x-prefixed, 40-character hex string.');
    }

    const normalized = address.toLowerCase();

    // userId comes from ServiceAuthGuard, which has already resolved (and
    // if needed, created) the User row for this session — no more
    // find-or-create-a-demo-user fallback here.
    return this.prisma.wallet.upsert({
      where: { userId_address: { userId, address: normalized } },
      create: { address: normalized, label, userId },
      update: { label: label ?? undefined },
    });
  }

  /**
   * Deletes a wallet and everything derived from it. Transaction and
   * Holding rows FK to Wallet without an onDelete cascade (see
   * schema.prisma), so they're deleted first, in one transaction, to avoid
   * an FK violation and to avoid ever leaving orphaned rows if this fails
   * partway through.
   *
   * Unlike the other wallet-scoped methods, this one has no earlier
   * findById(id, userId) call in the controller to lean on for the
   * ownership check — it does its own.
   */
  async remove(id: string, userId: string) {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    // Same NotFoundException whether the wallet doesn't exist or belongs to
    // someone else — distinguishing the two would confirm to a caller that
    // a given wallet id exists at all, just not theirs.
    if (!wallet || wallet.userId !== userId) throw new NotFoundException('Wallet not found');

    await this.prisma.$transaction([
      this.prisma.transaction.deleteMany({ where: { walletId: id } }),
      this.prisma.holding.deleteMany({ where: { walletId: id } }),
      this.prisma.wallet.delete({ where: { id } }),
    ]);

    await this.invalidateCache(id);
  }

  /**
   * The sole ownership gate: every controller route that operates on an
   * existing wallet id calls this first and 404s if it comes back null,
   * then trusts `id` for the rest of that request — see getHoldings/
   * getTransactions below, which don't re-check userId themselves.
   */
  async findById(id: string, userId: string) {
    return this.prisma.wallet.findFirst({
      where: { id, userId },
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
