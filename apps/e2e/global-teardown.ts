import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { E2E_TEST_EMAIL } from '@ledgerlens/shared';
import { deleteE2eWalletData } from './cleanup';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Best-effort cleanup, not a required step — a teardown failure shouldn't
 * mask whatever the tests themselves already reported. Leaves the e2e
 * User row in place (harmless, and global-setup already deletes its
 * wallets on the next run) rather than deleting it, since Prisma's
 * cascade behavior on User isn't something this script should have
 * opinions about.
 */
export default async function globalTeardown(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await deleteE2eWalletData(prisma, E2E_TEST_EMAIL);
  } catch (err) {
    console.warn('e2e teardown: cleanup failed (non-fatal):', err);
  } finally {
    await prisma.$disconnect();
  }
}
