import { PrismaClient } from '@prisma/client';

/**
 * Deletes every Wallet (and its Transaction/Holding rows) belonging to the
 * e2e test user. Children before parent — Transaction and Holding both
 * have a required FK on Wallet with no cascade configured in
 * schema.prisma, so `wallet.deleteMany()` alone 500s with a foreign key
 * violation the moment a synced wallet has any transaction rows (as this
 * suite's fixture wallet always will by the time teardown runs).
 *
 * Shared by global-setup.ts (clears a previous local run before starting)
 * and global-teardown.ts (best-effort cleanup after) — same operation,
 * two different callers.
 */
export async function deleteE2eWalletData(prisma: PrismaClient, email: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return;

  const wallets = await prisma.wallet.findMany({
    where: { userId: user.id },
    select: { id: true },
  });
  const walletIds = wallets.map((w) => w.id);
  if (walletIds.length === 0) return;

  await prisma.transaction.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.holding.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
}
