'use client';

import { signIn } from 'next-auth/react';

/** signIn() works standalone — it doesn't need a SessionProvider wrapping
 *  the app, so this stays a small, self-contained client island rather
 *  than requiring app-wide client-side session plumbing. */
export function GoogleSignInButton() {
  return (
    <button
      onClick={() => signIn('google', { callbackUrl: '/' })}
      className="w-full border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-ink/90"
    >
      Continue with Google
    </button>
  );
}
