import { getServerSession } from 'next-auth';
import { signServiceToken } from '@ledgerlens/shared';
import { authOptions } from './auth';

export interface AuthedSession {
  email: string;
  /** Short-lived (60s) — see packages/shared/src/serviceToken.ts. Mint a
   *  fresh one per call site rather than caching/reusing this value. */
  token: string;
}

/**
 * Server-only. Resolves the current NextAuth session and, if present,
 * mints a fresh service token for the one apps/api call about to happen.
 * Callers decide what "no session" means for them: page.tsx redirects to
 * /login; Server Actions do the same, since a mutation attempted without a
 * valid session has nowhere else useful to go.
 */
export async function getAuthedSession(): Promise<AuthedSession | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const secret = process.env.API_AUTH_SECRET;
  if (!secret) {
    // A misconfigured deploy, not a user-facing error — fail loudly rather
    // than silently sending unauthenticated requests to apps/api.
    throw new Error('API_AUTH_SECRET is not set — see apps/web/.env.local');
  }

  return { email, token: signServiceToken({ sub: email, email }, secret) };
}
