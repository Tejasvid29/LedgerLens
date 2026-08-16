import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { encode } from 'next-auth/jwt';
import { PrismaClient } from '@prisma/client';
import { E2E_TEST_EMAIL } from '@ledgerlens/shared';
import { deleteE2eWalletData } from './cleanup';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../web/.env.local') });

const STORAGE_STATE_DIR = path.resolve(__dirname, '.auth');
const STORAGE_STATE_PATH = path.join(STORAGE_STATE_DIR, 'storageState.json');

// Generous relative to a single test run, short relative to NextAuth's own
// 30-day default — this cookie only ever needs to survive one `playwright
// test` invocation.
const SESSION_MAX_AGE_SECONDS = 60 * 60;

/**
 * Two jobs, both about making the test run start from a clean, known
 * state without touching real infrastructure:
 *
 * 1. Delete any wallets left over from a previous local run of this suite
 *    (idempotent re-runs — CI gets a fresh Postgres per run and never
 *    needs this, but a developer running `npm run test:e2e` twice in a
 *    row against their own docker-compose Postgres does).
 *
 * 2. Mint a real NextAuth session cookie directly — via the same encode()
 *    function apps/web/src/app/api/auth/[...nextauth]/route.ts uses
 *    internally — and hand it to Playwright as storageState. This
 *    bypasses the actual Google OAuth redirect entirely; nothing here is
 *    a backdoor apps/web's production code knows about, it's just
 *    Playwright's browser context arriving with a cookie a real sign-in
 *    would have produced.
 */
export default async function globalSetup(): Promise<void> {
  await cleanupPriorRuns();
  await writeAuthedStorageState();
}

async function cleanupPriorRuns(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await deleteE2eWalletData(prisma, E2E_TEST_EMAIL);
  } finally {
    await prisma.$disconnect();
  }
}

async function writeAuthedStorageState(): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET not found. apps/web/.env.local must be populated (same file the real ' +
        'Google sign-in flow needs) before running the e2e suite.',
    );
  }

  const token = await encode({
    token: {
      name: 'LedgerLens E2E',
      email: E2E_TEST_EMAIL,
      picture: null,
      sub: E2E_TEST_EMAIL,
    },
    secret,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });
  fs.writeFileSync(
    STORAGE_STATE_PATH,
    JSON.stringify({
      cookies: [
        {
          // Unprefixed name: NEXTAUTH_URL is http://, not https://, so
          // NextAuth issues the non-secure cookie name. See
          // apps/web/src/lib/auth.ts.
          name: 'next-auth.session-token',
          value: token,
          domain: 'localhost',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  );
}
