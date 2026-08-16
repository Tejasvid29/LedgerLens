'use client';

import { signOut } from 'next-auth/react';

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: '/login' })} className="text-xs text-ink/40 hover:text-ink/60">
      Sign out
    </button>
  );
}
