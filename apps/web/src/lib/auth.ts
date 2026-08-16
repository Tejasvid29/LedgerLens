import type { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

/**
 * JWT sessions, no database adapter (S12 decision — see conversation: apps/web
 * and apps/api are separate services, apps/api never touches this session
 * directly). Google only for now; email magic link deferred until an email
 * sender is chosen.
 */
export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
};
